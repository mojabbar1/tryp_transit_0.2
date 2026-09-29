"""P4a read API, as tda_reader: /v1/assumptions and /v1/stats serve approved facts only (synthetic facts)."""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tda.api.app import create_app
from tda.api.citable import ASSUMPTIONS
from tda.facts.versions import FactDraft, approve_fact, write_fact
from tda.store.sources import upsert_source
from tests.conftest import DbUrls
from tests.support.factories import APPROVAL, make_source

# Synthetic test values, deliberately unlike the 05 §2 numbers.
EIA = "fuel.gasoline.regular.padd1c.usd_per_gal"


@pytest.fixture
def client(db: DbUrls) -> Iterator[TestClient]:
    engine = db.engine("reader")
    with TestClient(create_app(engine=engine)) as test_client:
        yield test_client
    engine.dispose()


def _fact(writer: Engine, key: str, value: Any, status: str = "approved", source: str | None = None) -> int:
    """A synthetic fact in ``status``: approved, candidate, rejected, or needs_review."""
    number = isinstance(value, int | float | Decimal)
    draft = FactDraft(
        key=key,
        value_num=value if number else None,
        value_text=None if number else value,
        unit="synthetic unit",
        created_by="human",
        derived_from={"input_run_ids": []},
        source_ids=[source] if source else [],
    )
    with writer.begin() as connection:
        if source:
            upsert_source(connection, make_source(id=source, **APPROVAL))
        fact = write_fact(connection, draft)
        if status in ("approved", "needs_review"):
            approve_fact(connection, fact, "test-reviewer")
        if status == "needs_review":
            connection.execute(text("UPDATE tda.fact SET status = 'needs_review' WHERE id = :i"), {"i": fact})
        if status == "rejected":
            connection.execute(
                text(
                    "UPDATE tda.fact SET status = 'rejected', reviewed_by = 't', reviewed_at = now() "
                    "WHERE id = :i"
                ),
                {"i": fact},
            )
    return fact


def test_assumptions_are_approved_facts_only_and_list_what_is_missing(
    client: TestClient, writer_engine: Engine
) -> None:
    mpg = _fact(writer_engine, "drive.mpg", 11.1, source="epa-test")
    fare = _fact(writer_engine, "transit.base_fare_usd", 9.99)
    basis = _fact(writer_engine, "cost.basis", "synthetic policy text")
    _fact(writer_engine, "drive.maintenance_usd_per_mile", 0.5, status="candidate")
    _fact(writer_engine, "co2.car_g_per_mile", 999, status="needs_review")
    _fact(writer_engine, "co2.car_occupancy", 3, status="rejected")
    _fact(writer_engine, "unrelated.key", 1)
    body = client.get("/v1/assumptions").json()
    assert [(i["key"], i["fact"]["id"], i["fact"]["status"]) for i in body["items"]] == [
        ("cost.basis", basis, "approved"),
        ("drive.mpg", mpg, "approved"),
        ("transit.base_fare_usd", fare, "approved"),
    ]
    mpg_item = body["items"][1]["fact"]
    assert (mpg_item["value_num"], mpg_item["sources"][0]["attribution"]) == (
        11.1,
        APPROVAL["attribution_text"],
    )
    assert body["items"][0]["fact"]["value_text"] == "synthetic policy text"
    assert body["missing"] == [
        k for k in ASSUMPTIONS if k not in {"cost.basis", "drive.mpg", "transit.base_fare_usd"}
    ]
    assert "parking.applies_to_stops" in body["missing"]


def test_the_fuel_price_prefers_the_weekly_eia_fact(client: TestClient, writer_engine: Engine) -> None:
    manual = _fact(writer_engine, "drive.fuel_price_usd_per_gal", 1.23)

    def fuel() -> dict[str, Any]:
        items = client.get("/v1/assumptions").json()["items"]
        return next(i["fact"] for i in items if i["key"] == "drive.fuel_price_usd_per_gal")

    assert fuel()["id"] == manual
    weekly = _fact(writer_engine, EIA, 4.56, source="eia-test")
    assert (fuel()["id"], fuel()["key"]) == (weekly, EIA)


def test_stats_come_from_approved_facts_with_citations(client: TestClient, writer_engine: Engine) -> None:
    upt = _fact(writer_engine, "carta.ridership.upt.monthly.bus", 12345, source="ntd-test")
    yoy = _fact(writer_engine, "carta.ridership.upt.monthly.bus.yoy_pct", 1.5, source="ntd-test")
    _fact(
        writer_engine,
        "carta.ridership.upt.monthly.demand_response",
        99,
        status="candidate",
        source="ntd-test",
    )
    level = _fact(writer_engine, "headline.congestion.level_pct", 12.5, source="tomtom-test")
    _fact(
        writer_engine,
        "headline.congestion.rush_hour_hours_lost",
        7,
        status="needs_review",
        source="tomtom-test",
    )
    _fact(writer_engine, "carta.ridership.upt.monthly", 1)  # not a mode key
    body = client.get("/v1/stats").json()
    assert [(s["id"], s["value_num"]) for s in body["items"]] == [
        ("congestion.level_pct", 12.5),
        ("ridership.bus.latest_month", 12345.0),
        ("ridership.bus.yoy_pct", 1.5),
    ]
    by_id = {s["id"]: s for s in body["items"]}
    assert by_id["ridership.bus.latest_month"]["label"] == "CARTA ridership, bus (latest month)"
    assert by_id["ridership.bus.yoy_pct"]["label"] == "CARTA ridership, bus: change vs a year earlier"
    assert by_id["congestion.level_pct"]["label"] == "Average congestion level"
    assert by_id["ridership.bus.yoy_pct"]["citations"] == [
        {
            "source_id": "ntd-test",
            "attribution": APPROVAL["attribution_text"],
            "retrieved": None,
            "fact_id": yoy,
            "fact_key": "carta.ridership.upt.monthly.bus.yoy_pct",
        }
    ]
    assert by_id["ridership.bus.latest_month"]["citations"][0]["fact_id"] == upt
    assert by_id["congestion.level_pct"]["citations"][0]["fact_id"] == level


def test_stats_and_assumptions_are_empty_without_approved_facts(
    client: TestClient, writer_engine: Engine
) -> None:
    _fact(writer_engine, "carta.ridership.upt.monthly.bus", 1, status="candidate")
    _fact(writer_engine, "drive.mpg", 1, status="candidate")
    assert client.get("/v1/stats").json() == {"items": []}
    body = client.get("/v1/assumptions").json()
    assert body["items"] == [] and body["missing"] == list(ASSUMPTIONS)
