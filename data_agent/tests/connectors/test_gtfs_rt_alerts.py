"""GTFS-realtime alerts connector (P3.7): DQ checks, canonical snapshots, loads, the current view."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
import structlog
from google.transit import gtfs_realtime_pb2 as rt
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from tda.config.settings import Settings
from tda.connectors.base import ValidationFailed
from tda.connectors.gtfs_rt_alerts import GtfsRtAlertsConnector, canonical, parse_alerts
from tda.connectors.gtfs_static import GtfsStaticConnector
from tda.connectors.registry import connector_class
from tda.http.polite_client import PoliteClient
from tda.store.raw_store import RawStore
from tests.conftest import DbUrls
from tests.connectors.gtfs_feed import zipped
from tests.connectors.rt_feed import END, START, detour, feed, open_ended
from tests.support.db import rows
from tests.support.factories import APPROVAL, make_source

URL = "https://gtfs-realtime.trilliumtransit.com/gtfs-realtime/feed/carta-sc-us/service_alerts.proto"
GTFS_URL = "https://data.trilliumtransit.com/gtfs/carta-sc-us/carta-sc-us.zip"


# Data-quality checks (no database)


def test_a_feed_parses_into_one_row_per_alert() -> None:
    a1, a2 = parse_alerts(feed())
    assert (a1["alert_id"], a1["cause"], a1["effect"], a1["severity_level"]) == (
        "A1",
        "CONSTRUCTION",
        "DETOUR",
        None,
    )
    assert (a1["active_from"].timestamp(), a1["active_until"].timestamp()) == (START, END)
    assert json.loads(a1["informed_entities"]) == [{"route_id": "R1"}, {"stop_id": "FX03"}]
    assert json.loads(a1["header_text"]) == [
        {"language": "en", "text": "Route 1 detour"},
        {"language": "es", "text": "Desvío de la ruta 1"},
    ]
    assert (a2["active_from"].timestamp(), a2["active_until"]) == (START, None), "open-ended"
    assert json.loads(a2["informed_entities"]) == [{"trip": {"route_id": "R2", "trip_id": "T3"}}]
    assert json.loads(a2["header_text"]) == [{"language": None, "text": "Fewer trips on route 2"}]
    assert (json.loads(a2["description_text"]), json.loads(a2["url"])) == ([], [])


def test_an_empty_feed_has_no_alerts() -> None:
    assert parse_alerts(feed({})) == []


def test_the_canonical_body_ignores_the_timestamp_and_entity_order() -> None:
    later = feed(timestamp=START + 300)
    reordered = feed({"A2": open_ended, "A1": detour})
    assert canonical(feed()) == canonical(later) == canonical(reordered)
    assert canonical(feed({"A1": detour})) != canonical(feed())
    assert parse_alerts(canonical(later)) == parse_alerts(feed()), "canonical form keeps every alert"


def _set(**fields: Any) -> Callable[[Any], None]:
    def edit(message: Any) -> None:
        for path, value in fields.items():
            target = message
            *parents, name = path.split("__")
            for part in parents:
                target = target[int(part)] if part.isdigit() else getattr(target, part)
            setattr(target, name, value)

    return edit


def _trip_update(message: Any) -> None:
    message.entity.add(id="TU1").trip_update.trip.trip_id = "T1"


def _no_entity(alert: Any) -> None:
    alert.header_text.translation.add(text="Something happened")


def _empty_selector(alert: Any) -> None:
    alert.informed_entity.add()


def _backwards(alert: Any) -> None:
    detour(alert)
    alert.active_period[0].start, alert.active_period[0].end = END, START


def _huge_time(alert: Any) -> None:
    detour(alert)
    alert.active_period[0].end = 2**64 - 1


def _nul(alert: Any) -> None:
    detour(alert)
    alert.header_text.translation.add(text="a\x00b", language="en")


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (b"\xff\xff\xff\xff", "not a GTFS-realtime FeedMessage"),
        (feed(version="3.0"), "unsupported gtfs_realtime_version '3.0'"),
        (feed(edit=_set(header__incrementality=rt.FeedHeader.DIFFERENTIAL)), "only FULL_DATASET"),
        (feed(edit=_set(entity__1__id="A1")), "duplicate entity id 'A1'"),
        (feed(edit=_set(entity__0__id="")), "an entity has no id"),
        (feed(edit=_set(entity__0__is_deleted=True)), "entity 'A1' is deleted"),
        (feed(edit=_trip_update), "entity 'TU1' is not an alert"),
        (feed({"A1": _no_entity}), "alert 'A1' has no informed_entity"),
        (feed({"A1": _empty_selector}), "alert 'A1': an informed_entity selects nothing"),
        (feed({"A1": _backwards}), "alert 'A1': active_period 1 starts after it ends"),
        (feed({"A1": _huge_time}), "alert 'A1': time 18446744073709551615 is out of range"),
        (feed({"A1": _nul}), "alert 'A1' contains a NUL character"),
    ],
)
def test_invalid_feeds_are_rejected(body: bytes, message: str) -> None:
    with pytest.raises(ValidationFailed, match=message.replace("(", r"\(").replace(")", r"\)")):
        parse_alerts(body)


def _periods_open_both_ways(alert: Any) -> None:
    detour(alert)
    del alert.active_period[:]
    alert.active_period.add().start = 2**64 - 1
    alert.active_period.add().end = END


def _empty_period(alert: Any) -> None:
    detour(alert)
    alert.active_period.add()


def _backwards_communication(alert: Any) -> None:
    detour(alert)
    period = alert.communication_period.add()
    period.start, period.end = END, START


def _empty_route(alert: Any) -> None:
    alert.informed_entity.add(route_id="")


def _empty_trip(alert: Any) -> None:
    alert.informed_entity.add().trip.SetInParent()


def _direction_only(alert: Any) -> None:
    alert.informed_entity.add(direction_id=1)


def _with_payload(name: str) -> Callable[[Any], None]:
    def edit(message: Any) -> None:
        getattr(message.entity[0], name).SetInParent()

    return edit


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (feed({"A1": _periods_open_both_ways}), "alert 'A1': time 18446744073709551615 is out of range"),
        (feed({"A1": _empty_period}), "alert 'A1': active_period 2 has neither start nor end"),
        (feed({"A1": _backwards_communication}), "alert 'A1': communication_period 1 starts after it ends"),
        (feed({"A1": _empty_route}), "alert 'A1': an informed_entity selects nothing"),
        (feed({"A1": _empty_trip}), "alert 'A1': an informed_entity selects nothing"),
        (feed({"A1": _direction_only}), "alert 'A1': an informed_entity has a direction_id but no route_id"),
        (feed(edit=_with_payload("shape")), "entity 'A1' is not an alert alone"),
        (feed(edit=_with_payload("stop")), "entity 'A1' is not an alert alone"),
        (feed(edit=_with_payload("trip_modifications")), "entity 'A1' is not an alert alone"),
    ],
)
def test_the_review_round_1_cases_are_rejected(body: bytes, message: str) -> None:
    with pytest.raises(ValidationFailed, match=message.replace("(", r"\(").replace(")", r"\)")):
        parse_alerts(body)


def _windows(
    communication: list[tuple[int, int | None]], impact: tuple[int, int | None]
) -> Callable[[Any], None]:
    def build(alert: Any) -> None:
        detour(alert)
        for start, end in communication:
            period = alert.communication_period.add(start=start)
            if end is not None:
                period.end = end
        period = alert.impact_period.add(start=impact[0])
        if impact[1] is not None:
            period.end = impact[1]

    return build


def _trip_selector(**fields: Any) -> Callable[[Any], None]:
    modified = fields.pop("modified_trip", None)

    def build(alert: Any) -> None:
        trip = alert.informed_entity.add().trip
        for name, value in fields.items():
            setattr(trip, name, value)
        if modified is not None:
            for name, value in modified.items():
                setattr(trip.modified_trip, name, value)

    return build


NOT_WITHIN = "alert 'A1': impact_period 1 is not within a single communication_period"
NEEDS_BOTH = "alert 'A1': a modified_trip needs modifications_id and affected_trip_id"


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (feed({"A1": _windows([(100, 200)], (300, 400))}), NOT_WITHIN),
        (feed({"A1": _windows([(100, 200), (300, 400)], (150, 350))}), NOT_WITHIN),
        (feed({"A1": _windows([(100, 300), (200, 400)], (150, 350))}), NOT_WITHIN),
        (feed({"A1": _windows([(100, 200)], (150, None))}), NOT_WITHIN),
        (feed({"A1": _trip_selector(modified_trip={"start_date": "20260928"})}), NEEDS_BOTH),
        (feed({"A1": _trip_selector(modified_trip={"modifications_id": "M1"})}), NEEDS_BOTH),
        (feed({"A1": _trip_selector(modified_trip={"affected_trip_id": "T1"})}), NEEDS_BOTH),
        (
            feed(
                {
                    "A1": _trip_selector(
                        trip_id="T2", modified_trip={"modifications_id": "M1", "affected_trip_id": "T1"}
                    )
                }
            ),
            "alert 'A1': a trip with a modified_trip also sets trip_id",
        ),
        (
            feed({"A1": _trip_selector(route_id="R1")}),
            "alert 'A1': a trip selector needs a trip_id, or route_id, direction_id, start_time and start_",
        ),
    ],
)
def test_the_review_round_2_cases_are_rejected(body: bytes, message: str) -> None:
    with pytest.raises(ValidationFailed, match=message.replace("(", r"\(").replace(")", r"\)")):
        parse_alerts(body)


def test_every_period_kind_and_selector_is_kept() -> None:
    def rich(alert: Any) -> None:
        period = alert.communication_period.add()
        period.start, period.end = START, END
        impact = alert.impact_period.add()
        impact.start, impact.end = START + 600, END - 600
        alert.communication_period.add().start = END
        alert.impact_period.add().start = END + 60
        alert.informed_entity.add(route_type=0)
        modified = alert.informed_entity.add().trip.modified_trip
        modified.modifications_id, modified.affected_trip_id = "M1", "T1"
        alert.informed_entity.add().trip.CopyFrom(
            rt.TripDescriptor(route_id="R1", direction_id=0, start_time="07:00:00", start_date="20260928")
        )
        alert.tts_header_text.translation.add(text="Route one detour", language="en")
        alert.header_text.translation.add(text=r"a literal \u0000 is not a NUL")

    (row,) = parse_alerts(feed({"A1": rich}))
    assert (row["active_from"], row["active_until"], json.loads(row["active_periods"])) == (None, None, [])
    assert json.loads(row["communication_periods"]) == [
        {"start": START, "end": END},
        {"start": END, "end": None},
    ]
    assert json.loads(row["impact_periods"]) == [
        {"start": START + 600, "end": END - 600},
        {"start": END + 60, "end": None},
    ], "each within one communication period (an open end within an open end)"
    assert json.loads(row["informed_entities"]) == [
        {"route_type": 0},
        {"trip": {"modified_trip": {"affected_trip_id": "T1", "modifications_id": "M1"}}},
        {"trip": {"direction_id": 0, "route_id": "R1", "start_date": "20260928", "start_time": "07:00:00"}},
    ]
    alert = json.loads(row["alert"])
    assert alert["tts_header_text"]["translation"] == [{"text": "Route one detour", "language": "en"}]
    assert json.loads(row["header_text"]) == [{"language": None, "text": r"a literal \u0000 is not a NUL"}]


def _without_version() -> bytes:
    message = rt.FeedMessage()
    message.header.incrementality = rt.FeedHeader.FULL_DATASET
    message.entity.add(id="A1").alert.informed_entity.add(route_id="R1")
    return message.SerializePartialToString()


def _without_translation_text() -> bytes:
    message = rt.FeedMessage()
    message.ParseFromString(feed({"A1": detour}))
    message.entity[0].alert.header_text.translation.add(language="fr")
    return message.SerializePartialToString()


def test_required_fields_are_checked_and_invalid_bodies_are_kept_as_they_came() -> None:
    for body in (_without_version(), _without_translation_text()):
        assert canonical(body) == body, "not canonicalized, so the evidence is the original bytes"
        with pytest.raises(ValidationFailed, match="the feed is missing required fields"):
            parse_alerts(body)


def test_the_canonical_body_keeps_fields_it_does_not_know() -> None:
    unknown_field = b"\x28\x01"  # FeedMessage field 5, varint 1: not in the schema
    assert canonical(feed() + unknown_field) != canonical(feed())
    assert parse_alerts(canonical(feed() + unknown_field)) == parse_alerts(feed())


# Loading (Postgres)


@pytest.fixture
def alerts(
    db: DbUrls, writer_engine: Engine, tmp_path: Path
) -> Iterator[tuple[GtfsRtAlertsConnector, respx.MockRouter, Callable[[], GtfsStaticConnector]]]:
    """The alerts connector, its router, and ``gtfs()``: the static connector on the same router."""
    client = PoliteClient(Settings(), sleep=lambda _seconds: None)
    store = RawStore(tmp_path / "raw")
    source = make_source(id="carta-gtfs-rt-alerts", kind="gtfs_rt", url=URL, **APPROVAL)
    connector = GtfsRtAlertsConnector(
        source, engine=writer_engine, store=store, client=client, settings=Settings()
    )

    def gtfs() -> GtfsStaticConnector:
        static = make_source(id="carta-gtfs", kind="gtfs", url=GTFS_URL, **APPROVAL)
        return GtfsStaticConnector(
            static, engine=writer_engine, store=store, client=client, settings=Settings()
        )

    with respx.mock(assert_all_called=False) as router:
        yield connector, router, gtfs
    client.close()


def _serve(router: respx.MockRouter, body: bytes) -> None:
    router.get(URL).mock(return_value=httpx.Response(200, content=body))


def _current(engine: Engine) -> list[str]:
    return [r[0] for r in rows(engine, "SELECT alert_id FROM tda.current_service_alert ORDER BY alert_id")]


def test_a_snapshot_loads_and_an_unchanged_one_is_not_modified(alerts: Any, writer_engine: Engine) -> None:
    connector, router, _ = alerts
    _serve(router, feed())
    first = connector.run(live=True)
    assert (first.status, first.rows_loaded) == ("success", 2)
    assert _current(writer_engine) == ["A1", "A2"]
    _serve(router, feed(timestamp=START + 300))
    assert connector.run(live=True).status == "not_modified", "only the header timestamp changed"
    assert rows(writer_engine, "SELECT count(*) FROM tda.service_alert")[0][0] == 2


def test_an_alert_that_ends_leaves_the_current_view(alerts: Any, writer_engine: Engine) -> None:
    connector, router, _ = alerts
    _serve(router, feed())
    connector.run(live=True)
    _serve(router, feed({"A1": detour}))
    assert connector.run(live=True).status == "success"
    assert _current(writer_engine) == ["A1"], "A2 ended, so it's gone from the snapshot"
    _serve(router, feed({}))
    outcome = connector.run(live=True)
    assert (outcome.status, outcome.rows_loaded) == ("success", 0)
    assert _current(writer_engine) == []
    assert rows(writer_engine, "SELECT count(*) FROM tda.service_alert")[0][0] == 3, "append-only"


def test_rolling_back_a_snapshot_restores_the_previous_one(alerts: Any, writer_engine: Engine) -> None:
    connector, router, _ = alerts
    _serve(router, feed())
    connector.run(live=True)
    _serve(router, feed({"A1": detour}))
    second = connector.run(live=True).run_id
    plan = connector.rollback(second, dry_run=True)
    assert plan.observations["service_alert"] == 1
    connector.rollback(second, dry_run=False)
    assert _current(writer_engine) == ["A1", "A2"]
    assert rows(writer_engine, "SELECT count(*) FROM tda.service_alert")[0][0] == 3, "nothing deleted"


def test_unknown_references_are_logged_not_fatal(alerts: Any, writer_engine: Engine) -> None:
    connector, router, gtfs = alerts

    def elsewhere(alert: Any) -> None:
        alert.informed_entity.add(route_id="R1")
        alert.informed_entity.add(route_id="R9")
        alert.informed_entity.add(stop_id="ZZ99")

    _serve(router, feed({"A9": elsewhere}))
    with structlog.testing.capture_logs() as logs:
        assert connector.run(live=True).status == "success"
    assert any(e.get("reason") == "no active GTFS feed to check against" for e in logs)
    router.get(GTFS_URL).mock(return_value=httpx.Response(200, content=zipped()))
    assert gtfs().run(live=True).status == "success"
    _serve(router, feed({"A9": elsewhere, "A1": detour}))
    with structlog.testing.capture_logs() as logs:
        assert connector.run(live=True).status == "success"
    (warning,) = [e for e in logs if e["event"] == "gtfs_rt.unknown_references"]
    assert (warning["routes"], warning["stops"]) == (["R9"], ["ZZ99"]), "R1 and FX03 are in the active feed"


def test_an_invalid_feed_fails_the_run_and_loads_nothing(
    alerts: Any, writer_engine: Engine, tmp_path: Path
) -> None:
    connector, router, _ = alerts
    _serve(router, feed({"A1": _backwards}))
    outcome = connector.run(live=True)
    assert outcome.status == "failed" and "starts after it ends" in (outcome.message or "")
    assert rows(writer_engine, "SELECT count(*) FROM tda.service_alert")[0][0] == 0
    raw = rows(writer_engine, "SELECT raw_uri FROM tda.fetch_run WHERE id = :i", i=outcome.run_id)[0][0]
    assert (tmp_path / "raw" / raw.removeprefix("raw://")).exists(), "the evidence is kept"


def test_a_bad_snapshot_fails_and_keeps_the_good_one_current(
    alerts: Any, writer_engine: Engine, tmp_path: Path
) -> None:
    connector, router, _ = alerts
    _serve(router, feed())
    connector.run(live=True)
    for bad in (
        feed({"A1": _periods_open_both_ways}),
        feed({"BAD": _windows([(100, 200)], (300, 400))}),
        feed({"BAD": _trip_selector(route_id="R1")}),
    ):
        _serve(router, bad)
        assert connector.run(live=True).status == "failed"
        assert _current(writer_engine) == ["A1", "A2"], "the previous snapshot is still current"
    _serve(router, _without_version())
    outcome = connector.run(live=True)
    assert outcome.status == "failed" and "missing required fields" in (outcome.message or "")
    run = rows(
        writer_engine, "SELECT raw_uri, http_status, bytes FROM tda.fetch_run WHERE id = :i", i=outcome.run_id
    )[0]
    assert (run.http_status, run.bytes) == (200, len(_without_version()))
    assert (tmp_path / "raw" / run.raw_uri.removeprefix("raw://")).read_bytes() == _without_version()


def test_alerts_are_append_only_and_the_reader_sees_only_the_current_view(
    alerts: Any, db: DbUrls, writer_engine: Engine
) -> None:
    connector, router, _ = alerts
    _serve(router, feed())
    connector.run(live=True)
    with writer_engine.connect() as connection:
        with pytest.raises(DBAPIError, match="permission denied"):
            connection.execute(text("UPDATE tda.service_alert SET cause = 'OTHER_CAUSE'"))
    reader = db.engine("reader")
    with reader.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM tda.current_service_alert")).scalar_one() == 2
        with pytest.raises(DBAPIError, match="permission denied"):
            connection.execute(text("SELECT 1 FROM tda.service_alert"))
    reader.dispose()


def test_the_connector_is_registered() -> None:
    assert connector_class("carta-gtfs-rt-alerts") is GtfsRtAlertsConnector
