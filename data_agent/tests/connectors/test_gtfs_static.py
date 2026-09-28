"""GTFS static connector (P3.1): data-quality checks, loads, idempotency, versions, activation, rollback."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError
from typer.testing import CliRunner

from tda.cli import app
from tda.config.settings import Settings, get_settings
from tda.connectors import gtfs_static
from tda.connectors.base import ValidationFailed
from tda.connectors.gtfs_static import GtfsStaticConnector, parse_feed
from tda.connectors.registry import connector_class
from tda.http.polite_client import PoliteClient
from tda.store.bootstrap import downgrade, upgrade
from tda.store.raw_store import RawStore
from tests.conftest import DbUrls
from tests.connectors.gtfs_feed import append, files, replace, zipped
from tests.support.db import rows
from tests.support.factories import APPROVAL, make_source

URL = "https://data.trilliumtransit.com/gtfs/carta-sc-us/carta-sc-us.zip"
TABLES = (
    "gtfs_feed_version",
    "gtfs_stop",
    "gtfs_route",
    "gtfs_trip",
    "gtfs_stop_time",
    "gtfs_calendar",
    "gtfs_calendar_date",
    "gtfs_shape",
)
FIXTURE_COUNTS = {
    "gtfs_feed_version": 1,
    "gtfs_stop": 10,
    "gtfs_route": 2,
    "gtfs_trip": 4,
    "gtfs_stop_time": 23,
    "gtfs_calendar": 2,
    "gtfs_calendar_date": 2,
    "gtfs_shape": 7,
}


# Data-quality checks (no database)


def test_the_fixture_parses_with_times_past_midnight_and_blank_times() -> None:
    version, tables = parse_feed(zipped())
    assert {table: len(tables[table]) for table in TABLES[1:]} == {
        k: v for k, v in FIXTURE_COUNTS.items() if k != TABLES[0]
    }
    assert (version["feed_label"], str(version["feed_start"]), str(version["feed_end"])) == (
        "fixture-1",
        "2026-01-01",
        "2026-12-31",
    )
    assert version["agency_timezone"] == "America/New_York"
    last = next(st for st in tables["gtfs_stop_time"] if st["trip_id"] == "T4" and st["stop_id"] == "FX10")
    assert (last["arrival_time"], last["arrival_s"]) == ("24:06:00", 24 * 3600 + 6 * 60)
    blank = next(st for st in tables["gtfs_stop_time"] if st["trip_id"] == "T2" and st["stop_sequence"] == 3)
    assert (blank["arrival_time"], blank["arrival_s"]) == (None, None)


def test_feed_dates_come_from_the_calendar_without_feed_info() -> None:
    version, _ = parse_feed(zipped({"feed_info.txt": None}))
    assert (str(version["feed_start"]), str(version["feed_end"])) == ("2026-01-01", "2026-12-31")


@pytest.mark.parametrize(
    ("contents", "message"),
    [
        ({"stops.txt": None}, "required files missing: stops.txt"),
        ({"calendar.txt": None, "calendar_dates.txt": None}, "calendar.txt or calendar_dates.txt"),
        (
            append("stop_times.txt", "TX,08:00:00,08:00:00,FX01,1,0,0,0.0,1"),
            "1 stop_times with an unknown trip_id",
        ),
        (
            append("stop_times.txt", "T1,08:00:00,08:00:00,FX99,9,0,0,0.0,1"),
            "1 stop_times with an unknown stop_id",
        ),
        (append("trips.txt", "R9,WKDY,T9,Nowhere,0,B9,"), "1 trips with an unknown route_id"),
        (replace("stop_times.txt", "07:04:00,07:04:00", "07:61:00,07:61:00"), "'07:61:00' is not H:MM:SS"),
        (replace("calendar.txt", "20260101", "2026-01-01"), "is not a YYYYMMDD date"),
        (replace("calendar.txt", "20260101,20261231", "20261231,20260101"), "start_date is after end_date"),
        (
            replace("feed_info.txt", "20260101,20261231", "20261231,20260101"),
            "starts (2026-12-31) after it ends",
        ),
        ({"stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n"}, "stops.txt has no stops"),
        (append("stops.txt", "FX01,999,Duplicate,32.8,-79.9,,0,,1"), "gtfs_stop: duplicate stop_id"),
        (
            append("stop_times.txt", "T1,09:00:00,09:00:00,FX01,1,0,0,0.0,1"),
            "duplicate trip_id, stop_sequence",
        ),
        (replace("agency.txt", "America/New_York", "Mars/Olympus"), "unknown agency_timezone"),
        (replace("stops.txt", "32.7740", "132.7740"), "out of range"),
        (replace("stops.txt", "32.7740,-79.9370", ","), "stop_lat and stop_lon are required"),
        (
            replace("stop_times.txt", "T1,07:00:00,07:00:00,FX01,1", "T1,07:00:00,07:00:00,FX01,-1"),
            "negative",
        ),
        (
            replace("calendar_dates.txt", "WKDY,20260907,2", "WKDY,20260907,3"),
            "exception_type must be 1 or 2",
        ),
    ],
)
def test_invalid_feeds_are_rejected(contents: dict[str, str | None], message: str) -> None:
    with pytest.raises(ValidationFailed, match=_escape(message)):
        parse_feed(zipped(contents))


def test_non_zips_and_zip_bombs_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationFailed, match="not a zip"):
        parse_feed(b"<html>not a feed</html>")
    monkeypatch.setattr(gtfs_static, "MAX_UNCOMPRESSED", 1000)
    with pytest.raises(ValidationFailed, match="would unpack to"):
        parse_feed(zipped())


def _escape(message: str) -> str:
    return "".join("\\" + c if c in ".()[]*+?^$|{}" else c for c in message)


# Loading (Postgres)


@pytest.fixture
def gtfs(
    db: DbUrls, writer_engine: Engine, tmp_path: Path
) -> Iterator[tuple[GtfsStaticConnector, respx.MockRouter]]:
    client = PoliteClient(Settings(), sleep=lambda _seconds: None)
    source = make_source(id="carta-gtfs", kind="gtfs", url=URL, **APPROVAL)
    connector = GtfsStaticConnector(
        source, engine=writer_engine, store=RawStore(tmp_path / "raw"), client=client, settings=Settings()
    )
    with respx.mock(assert_all_called=False) as router:
        yield connector, router
    client.close()


def _serve(router: respx.MockRouter, body: bytes, etag: str = '"v1"') -> None:
    router.get(URL).mock(return_value=httpx.Response(200, content=body, headers={"ETag": etag}))


def _counts(engine: Engine) -> dict[str, int]:
    return {table: rows(engine, f"SELECT count(*) FROM tda.{table}")[0][0] for table in TABLES}


def _versions(engine: Engine) -> list[tuple[Any, ...]]:
    return [
        tuple(r)
        for r in rows(
            engine, "SELECT id, feed_label, is_active FROM tda.current_gtfs_feed_version ORDER BY id"
        )
    ]


def test_a_feed_loads_every_table_and_becomes_active(gtfs: Any, writer_engine: Engine) -> None:
    connector, router = gtfs
    _serve(router, zipped())
    outcome = connector.run(live=True)
    assert (outcome.status, outcome.rows_loaded) == ("success", sum(FIXTURE_COUNTS.values()))
    assert _counts(writer_engine) == FIXTURE_COUNTS
    version = rows(
        writer_engine,
        "SELECT feed_label, is_active, activated_by, agency_timezone FROM tda.current_gtfs_feed_version",
    )
    assert [tuple(v) for v in version] == [("fixture-1", True, "connector", "America/New_York")]
    # The P3 prompt's live smoke-test DQ queries, through the current_* views:
    active_stops = rows(
        writer_engine,
        "SELECT count(*) FROM tda.current_gtfs_stop s JOIN tda.current_gtfs_feed_version v "
        "ON v.id = s.feed_version_id WHERE v.is_active",
    )
    orphans = rows(
        writer_engine,
        "SELECT count(*) FROM tda.current_gtfs_stop_time st LEFT JOIN tda.current_gtfs_trip t "
        "ON t.trip_id = st.trip_id AND t.feed_version_id = st.feed_version_id WHERE t.trip_id IS NULL",
    )
    assert (active_stops[0][0], orphans[0][0]) == (10, 0)


def test_an_unchanged_feed_is_not_loaded_again(gtfs: Any, writer_engine: Engine) -> None:
    connector, router = gtfs
    _serve(router, zipped())
    connector.run(live=True)
    assert connector.run(live=True).status == "not_modified", "same sha256"
    router.get(URL).respond(304, headers={"ETag": '"v1"'})
    outcome = connector.run(live=True)
    assert outcome.status == "not_modified"
    assert (
        rows(writer_engine, "SELECT http_status FROM tda.fetch_run WHERE id = :i", i=outcome.run_id)[0][0]
        == 304
    )
    assert _counts(writer_engine) == FIXTURE_COUNTS
    assert rows(writer_engine, "SELECT count(*) FROM tda.gtfs_feed_activation")[0][0] == 1


def _second_feed(start: str = "20260101", end: str = "20261231") -> bytes:
    """The fixture plus one stop, labelled fixture-2; optionally with every service date moved."""
    contents = {
        **append("stops.txt", "FX11,111,Fixture Stop 11,32.8150,-79.9050,,0,,1"),
        **replace("feed_info.txt", "fixture-1,20260101,20261231", f"fixture-2,{start},{end}"),
    }
    if (start, end) != ("20260101", "20261231"):
        contents["calendar.txt"] = files()["calendar.txt"].replace("20260101,20261231", f"{start},{end}")
        contents["calendar_dates.txt"] = "service_id,date,exception_type\n"
    return zipped(contents)


def test_a_changed_feed_becomes_a_new_active_version_and_the_old_one_is_kept(
    gtfs: Any, writer_engine: Engine
) -> None:
    connector, router = gtfs
    _serve(router, zipped())
    first = connector.run(live=True).run_id
    _serve(router, _second_feed(), etag='"v2"')
    second = connector.run(live=True)
    assert second.status == "success"
    assert [(label, active) for _, label, active in _versions(writer_engine)] == [
        ("fixture-1", False),
        ("fixture-2", True),
    ]
    assert rows(writer_engine, "SELECT count(*) FROM tda.gtfs_stop")[0][0] == 21, "both versions are kept"
    active = rows(
        writer_engine,
        "SELECT count(*) FROM tda.current_gtfs_stop s JOIN tda.current_gtfs_feed_version v "
        "ON v.id = s.feed_version_id WHERE v.is_active",
    )
    assert active[0][0] == 11
    assert first != second.run_id


def test_a_feed_that_has_not_started_is_loaded_but_not_activated(gtfs: Any, writer_engine: Engine) -> None:
    connector, router = gtfs
    _serve(router, zipped())
    connector.run(live=True)
    _serve(router, _second_feed("20990101", "20991231"), etag='"v2"')
    assert connector.run(live=True).status == "success"
    assert [(label, active) for _, label, active in _versions(writer_engine)] == [
        ("fixture-1", True),
        ("fixture-2", False),
    ]


def test_rolling_back_the_active_feed_restores_the_previous_one(gtfs: Any, writer_engine: Engine) -> None:
    connector, router = gtfs
    _serve(router, zipped())
    connector.run(live=True)
    _serve(router, _second_feed(), etag='"v2"')
    second = connector.run(live=True).run_id
    before = _counts(writer_engine)
    plan = connector.rollback(second, dry_run=True)
    assert plan.observations["gtfs_stop"] == 11 and plan.observations["gtfs_feed_version"] == 1
    connector.rollback(second, dry_run=False)
    assert [(label, active) for _, label, active in _versions(writer_engine)] == [("fixture-1", True)]
    assert _counts(writer_engine) == before, "nothing is deleted"


def test_an_invalid_feed_fails_the_run_and_loads_nothing(
    gtfs: Any, writer_engine: Engine, tmp_path: Path
) -> None:
    connector, router = gtfs
    _serve(router, zipped(append("stop_times.txt", "TX,08:00:00,08:00:00,FX01,1,0,0,0.0,1")))
    outcome = connector.run(live=True)
    assert outcome.status == "failed" and "unknown trip_id" in (outcome.message or "")
    assert _counts(writer_engine) == dict.fromkeys(TABLES, 0)
    raw = rows(writer_engine, "SELECT raw_uri FROM tda.fetch_run WHERE id = :i", i=outcome.run_id)[0][0]
    assert (tmp_path / "raw" / raw.removeprefix("raw://")).exists(), "the evidence is kept"


def test_feed_rows_are_append_only_and_the_reader_sees_only_current_views(
    gtfs: Any, db: DbUrls, writer_engine: Engine
) -> None:
    connector, router = gtfs
    _serve(router, zipped())
    connector.run(live=True)
    with writer_engine.connect() as connection:
        for statement in ("UPDATE tda.gtfs_stop SET stop_name = 'x'", "DELETE FROM tda.gtfs_feed_activation"):
            with pytest.raises(DBAPIError, match="permission denied"):
                connection.execute(text(statement))
            connection.rollback()
    reader = db.engine("reader")
    with reader.connect() as connection:
        for table in TABLES:
            assert connection.execute(text(f"SELECT count(*) FROM tda.current_{table}")).scalar_one() > 0
            with pytest.raises(DBAPIError, match="permission denied"):
                connection.execute(text(f"SELECT 1 FROM tda.{table}"))
            connection.rollback()
        with pytest.raises(DBAPIError, match="permission denied"):
            connection.execute(text("SELECT 1 FROM tda.gtfs_feed_activation"))
    reader.dispose()


def test_the_connector_is_registered() -> None:
    assert connector_class("carta-gtfs") is GtfsStaticConnector


# CLI (Postgres)


@pytest.fixture
def cli(db: DbUrls, monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    monkeypatch.setenv("TDA_DATABASE_URL", db.writer)
    runner = CliRunner()

    def invoke(*args: str) -> Any:
        get_settings.cache_clear()
        try:
            return runner.invoke(app, list(args), catch_exceptions=False)
        finally:
            get_settings.cache_clear()

    yield invoke


def test_versions_and_activate(gtfs: Any, cli: Any, writer_engine: Engine) -> None:
    connector, router = gtfs
    _serve(router, zipped())
    connector.run(live=True)
    _serve(router, _second_feed(), etag='"v2"')
    second = connector.run(live=True).run_id
    (v1, _, _), (v2, _, _) = _versions(writer_engine)
    listing = cli("gtfs", "versions").stdout
    assert f"* {v2:>5}" in listing and f"  {v1:>5}" in listing
    assert "is now active" in cli("gtfs", "activate", str(v1), "--by", "alice").stdout
    assert [(i, active) for i, _, active in _versions(writer_engine)] == [(v1, True), (v2, False)]
    connector.rollback(second, dry_run=False)
    refused = cli("gtfs", "activate", str(v2))
    assert refused.exit_code == 2 and "rolled back" in refused.stderr
    assert cli("gtfs", "activate", "999999").exit_code == 2


# Migration (Postgres)


def test_the_migration_round_trips(db: DbUrls, writer_engine: Engine) -> None:
    downgrade(db.admin, "0001_baseline")
    left = rows(
        writer_engine,
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_schema = 'tda' AND table_name LIKE '%gtfs%'",
    )
    assert left[0][0] == 0
    upgrade(db.admin)
    assert _counts(writer_engine) == dict.fromkeys(TABLES, 0)
