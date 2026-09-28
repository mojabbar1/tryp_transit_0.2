"""NTD monthly connector (P3.2): data-quality checks, paging, the app token, loads, facts, and rollback."""

from __future__ import annotations

import json
from collections.abc import Iterator
from decimal import ROUND_HALF_EVEN, Decimal
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import respx
import structlog
from pydantic import SecretStr
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from tda.config.settings import Settings
from tda.connectors import ntd_monthly
from tda.connectors.base import ValidationFailed
from tda.connectors.ntd_monthly import NtdMonthlyConnector, parse_rows
from tda.connectors.registry import connector_class
from tda.http.polite_client import PoliteClient
from tda.store.raw_store import RawStore
from tests.conftest import DbUrls
from tests.support.db import rows
from tests.support.factories import APPROVAL, make_source

URL = "https://data.transportation.gov/resource/8bui-9xvu.json"
SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "ntd-monthly" / "sample.json"


def sample() -> list[dict[str, Any]]:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


def body(data: list[dict[str, Any]]) -> bytes:
    return json.dumps(data).encode()


def _upt(data: list[dict[str, Any]], mode: str, month: str) -> int:
    return sum(int(r["upt"]) for r in data if r["mode"] == mode and r["date"].startswith(month))


# Data-quality checks (no database)


def test_the_real_sample_parses() -> None:
    parsed = parse_rows(body(sample()), "40110")
    assert len(parsed) == 56
    july_bus = next(r for r in parsed if (r["mode"], r["tos"], str(r["month"])) == ("MB", "PT", "2026-07-01"))
    assert july_bus["upt"] == 224397, "the published July 2026 bus figure (05 §2a, 02 §6.3)"


def _edited(**changes: Any) -> bytes:
    data = sample()
    data[0] = {**data[0], **changes}
    return body(data)


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (b"<html>", "not JSON"),
        (b"{}", "not a list"),
        (b"[]", "no rows for ntd_id 40110"),
        (body([*sample(), 3]), "is not an object"),
        (_edited(ntd_id="40111"), "ntd_id '40111' is not '40110'"),
        (_edited(mode=""), "mode and tos are required"),
        (_edited(date="2025/06/01"), "is not a Socrata calendar date"),
        (_edited(date="2025-02-30T00:00:00.000"), "is not a real date"),
        (_edited(date="2025-06-15T00:00:00.000"), "is not the first of a month"),
        (_edited(upt="-5"), "must be a non-negative number"),
        (_edited(upt="12.5"), "must be a whole number"),
        (_edited(vrm="lots"), "is not a number"),
        (body([*sample(), sample()[0]]), "duplicate (ntd_id, mode, tos, month)"),
    ],
)
def test_invalid_rows_are_rejected(raw: bytes, message: str) -> None:
    with pytest.raises(ValidationFailed, match=message.replace("(", r"\(").replace(")", r"\)")):
        parse_rows(raw, "40110")


def test_month_gaps_are_reported_not_fatal() -> None:
    data = [r for r in sample() if not (r["mode"] == "CB" and r["date"].startswith("2026-03"))]
    with structlog.testing.capture_logs() as logs:
        assert len(parse_rows(body(data), "40110")) == 55
    gaps = [entry for entry in logs if entry["event"] == "ntd.month_gaps"]
    assert [(g["mode"], g["tos"], g["missing"]) for g in gaps] == [("CB", "PT", 1)]


# Loading and facts (Postgres)


@pytest.fixture
def ntd(db: DbUrls, writer_engine: Engine, tmp_path: Path) -> Iterator[Any]:
    """``make(settings=None)`` builds the connector; ``serve(data)`` answers Socrata queries page by page."""
    clients = []
    with respx.mock(assert_all_called=False) as router:
        state: dict[str, Any] = {"data": sample(), "requests": []}

        def answer(request: httpx.Request) -> httpx.Response:
            query = parse_qs(urlsplit(str(request.url)).query)
            state["requests"].append(request)
            assert query["$where"] == ["ntd_id='40110'"]
            offset, limit = int(query["$offset"][0]), int(query["$limit"][0])
            return httpx.Response(200, json=state["data"][offset : offset + limit])

        router.get(url__startswith=URL).mock(side_effect=answer)

        def make(settings: Settings | None = None) -> NtdMonthlyConnector:
            settings = settings or Settings()
            client = PoliteClient(settings, sleep=lambda _s: None)
            clients.append(client)
            source = make_source(id="ntd-monthly", kind="socrata", url=URL, **APPROVAL)
            return NtdMonthlyConnector(
                source,
                engine=writer_engine,
                store=RawStore(tmp_path / "raw"),
                client=client,
                settings=settings,
            )

        yield make, state
    for client in clients:
        client.close()


def _facts(engine: Engine) -> dict[str, tuple[Any, ...]]:
    return {
        r.key: (r.value_num, str(r.period_start), r.status, r.version)
        for r in rows(
            engine,
            "SELECT key, value_num, period_start, status, version FROM tda.fact "
            "WHERE status IN ('approved', 'needs_review') ORDER BY key",
        )
    }


def _yoy(data: list[dict[str, Any]], mode: str, month: str, prior: str) -> Decimal:
    change = (Decimal(_upt(data, mode, month)) / Decimal(_upt(data, mode, prior)) - 1) * 100
    return change.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)


def test_a_run_loads_the_rows_and_auto_publishes_the_facts(ntd: Any, writer_engine: Engine) -> None:
    make, _ = ntd
    outcome = make().run(live=True)
    assert (outcome.status, outcome.rows_loaded) == ("success", 56)
    assert rows(writer_engine, "SELECT count(*) FROM tda.current_ridership_monthly")[0][0] == 56
    data, facts = sample(), _facts(writer_engine)
    expected = {
        "carta.ridership.upt.monthly.bus": (Decimal(224397), "2026-07-01", "approved", 1),
        "carta.ridership.upt.monthly.commuter_bus": (
            Decimal(_upt(data, "CB", "2026-07")),
            "2026-07-01",
            "approved",
            1,
        ),
        # Demand response runs as two types of service (PT and TN); the fact is their sum.
        "carta.ridership.upt.monthly.demand_response": (
            Decimal(_upt(data, "DR", "2026-07")),
            "2026-07-01",
            "approved",
            1,
        ),
    }
    for mode, name in (("MB", "bus"), ("CB", "commuter_bus"), ("DR", "demand_response")):
        expected[f"carta.ridership.upt.monthly.{name}.yoy_pct"] = (
            _yoy(data, mode, "2026-07", "2025-07"),
            "2026-07-01",
            "approved",
            1,
        )
    assert facts == expected
    fact = rows(
        writer_engine,
        "SELECT unit, geography, period_end, source_ids, created_by, reviewed_by, derived_from FROM tda.fact "
        "WHERE key = 'carta.ridership.upt.monthly.bus'",
    )[0]
    assert fact.unit == "unlinked passenger trips (UPT), bus, month"
    assert (fact.geography, str(fact.period_end), fact.source_ids) == (
        "agency:ntd:40110",
        "2026-07-31",
        ["ntd-monthly"],
    )
    assert (fact.created_by, fact.reviewed_by) == ("connector", "rule:auto_publish")
    assert fact.derived_from == {"input_run_ids": [outcome.run_id], "rule": "ntd_monthly.v1"}


def test_pages_are_combined_into_one_canonical_body(
    ntd: Any, writer_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    make, state = ntd
    monkeypatch.setattr(ntd_monthly, "PAGE_SIZE", 20)
    first = make().run(live=True)
    offsets = [parse_qs(urlsplit(str(r.url)).query)["$offset"][0] for r in state["requests"]]
    assert offsets == ["0", "20", "40"]
    monkeypatch.setattr(ntd_monthly, "PAGE_SIZE", 1000)
    second = make().run(live=True)
    assert second.status == "not_modified", "the same rows, paged differently, are the same body"
    shas = rows(
        writer_engine,
        "SELECT sha256 FROM tda.fetch_run WHERE id IN (:a, :b)",
        a=first.run_id,
        b=second.run_id,
    )
    assert len({r[0] for r in shas}) == 1


def test_too_many_pages_fail_the_run(ntd: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    make, _ = ntd
    monkeypatch.setattr(ntd_monthly, "PAGE_SIZE", 10)
    monkeypatch.setattr(ntd_monthly, "MAX_PAGES", 3)
    outcome = make().run(live=True)
    assert outcome.status == "failed" and "more than 3 pages" in (outcome.message or "")


def test_the_app_token_is_sent_only_when_configured(ntd: Any) -> None:
    make, state = ntd
    make().run(live=True)
    assert "x-app-token" not in state["requests"][-1].headers
    make(Settings(socrata_app_token=SecretStr("tok-123"))).run(live=True)
    assert state["requests"][-1].headers["x-app-token"] == "tok-123"
    assert "tok-123" not in repr(Settings(socrata_app_token=SecretStr("tok-123")))


def test_an_unchanged_week_is_not_modified_and_publishes_nothing_new(ntd: Any, writer_engine: Engine) -> None:
    make, _ = ntd
    make().run(live=True)
    before = _facts(writer_engine)
    assert make().run(live=True).status == "not_modified"
    assert _facts(writer_engine) == before
    assert rows(writer_engine, "SELECT count(*) FROM tda.ridership_monthly")[0][0] == 56


def _with_august_bus(data: list[dict[str, Any]], upt: str = "230001") -> list[dict[str, Any]]:
    july = next(r for r in data if r["mode"] == "MB" and r["date"].startswith("2026-07"))
    return [*data, {**july, "date": "2026-08-01T00:00:00.000", "upt": upt}]


def test_a_new_month_republishes_only_the_facts_that_changed(ntd: Any, writer_engine: Engine) -> None:
    make, state = ntd
    make().run(live=True)
    state["data"] = _with_august_bus(sample())
    assert make().run(live=True).status == "success"
    facts = _facts(writer_engine)
    assert facts["carta.ridership.upt.monthly.bus"] == (Decimal(230001), "2026-08-01", "approved", 2)
    assert "carta.ridership.upt.monthly.bus.yoy_pct" in facts
    assert facts["carta.ridership.upt.monthly.commuter_bus"][3] == 1, "unchanged, so no new version"
    superseded = rows(
        writer_engine,
        "SELECT status FROM tda.fact WHERE key = 'carta.ridership.upt.monthly.bus' AND version = 1",
    )
    assert superseded[0][0] == "superseded"
    assert rows(writer_engine, "SELECT count(*) FROM tda.ridership_monthly")[0][0] == 56 + 57, "append-only"


def test_rolling_back_a_run_flags_its_facts_and_restores_the_prior_rows(
    ntd: Any, writer_engine: Engine
) -> None:
    make, state = ntd
    make().run(live=True)
    state["data"] = _with_august_bus(sample())
    connector = make()
    second = connector.run(live=True).run_id
    plan = connector.rollback(second, dry_run=False)
    flagged = {f.key for f in plan.facts_to_review}
    assert "carta.ridership.upt.monthly.bus" in flagged
    assert rows(writer_engine, "SELECT count(*) FROM tda.current_ridership_monthly")[0][0] == 56
    assert _facts(writer_engine)["carta.ridership.upt.monthly.bus"][2] == "needs_review"
    assert rows(writer_engine, "SELECT count(*) FROM tda.ridership_monthly")[0][0] == 56 + 57, (
        "nothing deleted"
    )


def test_an_invalid_response_fails_the_run_and_loads_nothing(ntd: Any, writer_engine: Engine) -> None:
    make, state = ntd
    state["data"] = [{**sample()[0], "upt": "-1"}]
    outcome = make().run(live=True)
    assert outcome.status == "failed" and "non-negative" in (outcome.message or "")
    assert rows(writer_engine, "SELECT count(*) FROM tda.ridership_monthly")[0][0] == 0
    assert rows(writer_engine, "SELECT count(*) FROM tda.fact")[0][0] == 0


def test_the_reader_sees_the_current_view_only(ntd: Any, db: DbUrls) -> None:
    make, _ = ntd
    make().run(live=True)
    reader = db.engine("reader")
    with reader.connect() as connection:
        assert (
            connection.execute(text("SELECT count(*) FROM tda.current_ridership_monthly")).scalar_one() == 56
        )
        with pytest.raises(DBAPIError, match="permission denied"):
            connection.execute(text("SELECT 1 FROM tda.ridership_monthly"))
    reader.dispose()


def test_the_connector_is_registered_and_reads_the_region_agency() -> None:
    assert connector_class("ntd-monthly") is NtdMonthlyConnector
    source = make_source(id="ntd-monthly", kind="socrata", url=URL)
    connector = NtdMonthlyConnector(source, engine=None, store=None, settings=Settings())  # type: ignore[arg-type]
    assert (connector.agency().id, connector.agency().ntd_id) == ("carta", "40110")
