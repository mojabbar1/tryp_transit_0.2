"""Approved facts as the API serves them (02 §6.3), plus ``/v1/assumptions`` and ``/v1/stats`` (P4a).

Only current ``approved`` versions are ever served: never candidate, rejected, needs_review, or superseded.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import UTC
from typing import Any

from sqlalchemy import Connection, text

from tda.api.deps import DB
from tda.api.schemas import (
    AssumptionOut,
    AssumptionsOut,
    Citation,
    FactOut,
    FactSource,
    Period,
    StatOut,
    StatsOut,
)
from tda.facts.rules.eia_gas import KEY as EIA_FUEL_KEY

FACT_COLUMNS = (
    "f.id, f.key, f.version, f.supersedes_id, f.value_num, f.value_text, f.unit, f.geography, "
    "f.period_start, f.period_end, f.method, f.source_ids, f.derived_from, f.evidence, f.status, "
    "f.confidence, f.valid_until"
)

# The assumptions the web cost and CO2 model reads (src/lib/domain/assumptions.ts), each with the fact keys
# that can back it, in order of preference. The fuel price is the weekly EIA fact (P3.4) when there is one.
ASSUMPTIONS: dict[str, tuple[str, ...]] = {
    "cost.basis": ("cost.basis",),
    "drive.fuel_price_usd_per_gal": (EIA_FUEL_KEY, "drive.fuel_price_usd_per_gal"),
    "drive.mpg": ("drive.mpg",),
    "drive.maintenance_usd_per_mile": ("drive.maintenance_usd_per_mile",),
    "drive.total_cost_usd_per_mile": ("drive.total_cost_usd_per_mile",),
    "parking.downtown_usd": ("parking.downtown_usd",),
    "parking.applies_to_stops": ("parking.applies_to_stops",),
    "transit.base_fare_usd": ("transit.base_fare_usd",),
    "transit.access_buffer_min": ("transit.access_buffer_min",),
    "co2.car_g_per_mile": ("co2.car_g_per_mile",),
    "co2.car_occupancy": ("co2.car_occupancy",),
    "co2.bus_g_per_passenger_mile": ("co2.bus_g_per_passenger_mile",),
    "traffic.density_thresholds": ("traffic.density_thresholds",),
    "incentive.policy": ("incentive.policy",),
    "nudge.tone_rules": ("nudge.tone_rules",),
}

# The P3.2 rule's facts: <agency>.ridership.upt.monthly.<mode>, and the same plus .yoy_pct.
RIDERSHIP = re.compile(
    r"^(?P<agency>[a-z][a-z0-9_]*)\.ridership\.upt\.monthly\.(?P<mode>[a-z0-9_]+)(?P<yoy>\.yoy_pct)?$"
)
RIDERSHIP_SQL = r"^[a-z][a-z0-9_]*\.ridership\.upt\.monthly\.[a-z0-9_]+(\.yoy_pct)?$"
CONGESTION = {
    "headline.congestion.level_pct": "Average congestion level",
    "headline.congestion.rush_hour_hours_lost": "Time lost in rush-hour traffic",
}


def fact_outs(connection: Connection, rows: Sequence[Any]) -> list[FactOut]:
    """:class:`FactOut` for fact rows (selected with :data:`FACT_COLUMNS`), with attribution and dates."""
    cited = sorted({source_id for row in rows for source_id in row.source_ids})
    attribution = {
        row.id: row.attribution_text
        for row in connection.execute(
            text("SELECT id, attribution_text FROM tda.source WHERE id = ANY(:ids)"), {"ids": cited}
        )
    }
    retrieved = {
        (row.fact_id, row.source_id): row.retrieved_at.astimezone(UTC).date()
        for row in connection.execute(
            text(
                "SELECT fact_id, source_id, retrieved_at FROM tda.fact_source_retrieval "
                "WHERE fact_id = ANY(:ids)"
            ),
            {"ids": [row.id for row in rows]},
        )
    }
    return [
        FactOut(
            id=row.id,
            key=row.key,
            version=row.version,
            supersedes_id=row.supersedes_id,
            value_num=row.value_num,
            value_text=row.value_text,
            unit=row.unit,
            geography=row.geography,
            period=Period(start=row.period_start, end=row.period_end),
            method=row.method,
            sources=[
                FactSource(source_id=s, attribution=attribution.get(s), retrieved=retrieved.get((row.id, s)))
                for s in row.source_ids
            ],
            derived_from=row.derived_from,
            evidence=row.evidence,
            status=row.status,
            confidence=row.confidence,
            valid_until=row.valid_until,
        )
        for row in rows
    ]


def approved_facts(
    connection: Connection, keys: Sequence[str] | None = None, pattern: str | None = None
) -> list[FactOut]:
    """The current approved version of each key in ``keys``, or of each key matching the regex ``pattern``."""
    rows = connection.execute(
        text(
            f"SELECT {FACT_COLUMNS} FROM tda.fact f WHERE f.status = 'approved' "  # noqa: S608  (fixed columns)
            "AND (CAST(:keys AS text[]) IS NULL OR f.key = ANY(CAST(:keys AS text[]))) "
            "AND (CAST(:pattern AS text) IS NULL OR f.key ~ :pattern) ORDER BY f.key"
        ),
        {"keys": list(keys) if keys is not None else None, "pattern": pattern},
    ).all()
    return fact_outs(connection, rows)


def citations(fact: FactOut) -> list[Citation]:
    """One citation per source of ``fact``, or one naming only the fact when it has no source (a decision)."""
    if not fact.sources:
        return [Citation(source_id=None, attribution=None, fact_id=fact.id, fact_key=fact.key)]
    return [
        Citation(
            source_id=s.source_id,
            attribution=s.attribution,
            retrieved=s.retrieved,
            fact_id=fact.id,
            fact_key=fact.key,
        )
        for s in fact.sources
    ]


def assumptions(connection: DB) -> AssumptionsOut:
    """The approved facts behind the web cost and CO2 model, with IDs and attribution; missing ones listed."""
    wanted = sorted({key for keys in ASSUMPTIONS.values() for key in keys})
    by_key = {fact.key: fact for fact in approved_facts(connection, wanted)}
    items, missing = [], []
    for name, keys in ASSUMPTIONS.items():
        fact = next((by_key[k] for k in keys if k in by_key), None)
        if fact is None:
            missing.append(name)
        else:
            items.append(AssumptionOut(key=name, fact=fact))
    return AssumptionsOut(items=items, missing=missing)


def stats(connection: DB) -> StatsOut:
    """Headline stats from approved facts: ridership (NTD, P3.2) and the congestion headline (05 §2).

    Mode share (Census, P3.3), a traffic-volume headline (P3.6), and an example CO2 per trip (it needs a trip
    distance, which no approved fact provides) wait for their data, so they're absent.
    """
    items = []
    for fact in approved_facts(connection, pattern=RIDERSHIP_SQL):
        match = RIDERSHIP.match(fact.key)
        assert match is not None
        mode = match["mode"].replace("_", " ")
        agency = match["agency"].upper()
        if match["yoy"]:
            stat_id, label = (
                f"ridership.{match['mode']}.yoy_pct",
                f"{agency} ridership, {mode}: change vs a year earlier",
            )
        else:
            stat_id, label = (
                f"ridership.{match['mode']}.latest_month",
                f"{agency} ridership, {mode} (latest month)",
            )
        items.append(_stat(stat_id, label, fact))
    for fact in approved_facts(connection, sorted(CONGESTION)):
        items.append(_stat(f"congestion.{fact.key.rsplit('.', 1)[-1]}", CONGESTION[fact.key], fact))
    return StatsOut(items=sorted(items, key=lambda item: item.id))


def _stat(stat_id: str, label: str, fact: FactOut) -> StatOut:
    return StatOut(
        id=stat_id,
        label=label,
        value_num=fact.value_num,
        value_text=fact.value_text,
        unit=fact.unit,
        period=fact.period,
        citations=citations(fact),
    )
