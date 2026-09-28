"""EIA weekly gasoline price fact (P3.4), auto-published because EIA data is public domain.

- ``fuel.gasoline.regular.padd1c.usd_per_gal``: the latest week's price, from ``current_fuel_price_weekly``.
- **Lineage:** the fact cites the run its row came from, locked ``FOR SHARE`` before it's written, so a
  rolled-back input fails the publication (and the load).
- **Serialized:** publication takes a per-source lock before reading, so a slower run can't publish over a
  newer one; an unchanged value, week, and unit gets no new version.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Connection, text

from tda.facts.versions import FactDraft, write_fact
from tda.store.lineage import LineageError, key_lock, lock_input_runs

RULE = "eia_gas.v1"
KEY = "fuel.gasoline.regular.padd1c.usd_per_gal"
DATASET = "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPMR_PTE_R1Z_DPG&f=W"
UNIT = "USD per gallon (weekly regular gasoline, Lower Atlantic PADD 1C)"


def publish(connection: Connection, *, run_id: int, source_id: str, series: str) -> list[int]:
    """Write the latest weekly price as a new fact version when it changed; returns the new fact ids."""
    key_lock(connection, "publish", source_id)
    latest = connection.execute(
        text(
            "SELECT week, usd_per_gal, fetch_run_id FROM tda.current_fuel_price_weekly "
            "WHERE series_id = :s ORDER BY week DESC LIMIT 1"
        ),
        {"s": series},
    ).one_or_none()
    if latest is None:  # not after a successful load, which validated at least one week
        return []
    draft = FactDraft(
        key=KEY,
        created_by="connector",
        derived_from={"input_run_ids": [latest.fetch_run_id], "rule": RULE},
        value_num=latest.usd_per_gal,
        unit=UNIT,
        geography="region:padd-1c",
        period_start=latest.week,
        period_end=latest.week,
        method=f"EIA weekly retail price, series {series}, week of {latest.week}; {RULE}",
        source_ids=[source_id],
        evidence={"dataset": DATASET, "series": series, "week": latest.week.isoformat()},
        confidence="official",
    )
    try:
        lock_input_runs(connection, [latest.fetch_run_id])
    except LineageError as error:
        raise LineageError(f"EIA fact not published: {error}") from None
    current = connection.execute(
        text("SELECT value_num, period_start, unit FROM tda.fact WHERE key = :k AND status = 'approved'"),
        {"k": KEY},
    ).one_or_none()
    if current is not None and (current.value_num, current.period_start, current.unit) == (
        Decimal(latest.usd_per_gal),
        latest.week,
        UNIT,
    ):
        return []
    return [write_fact(connection, draft, auto_publish=True)]
