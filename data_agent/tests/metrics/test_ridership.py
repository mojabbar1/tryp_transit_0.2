"""P4a task 4: NTD ridership metrics (monthly, rolling 12 months, year over year) from synthetic rows."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import Connection, Engine, text

from tda.connectors.base import rollback_run
from tda.metrics import ridership
from tda.metrics.registry import METRICS, MetricRegistry
from tda.store.observations import insert_observations
from tda.store.sources import upsert_source
from tests.support.db import rows
from tests.support.factories import APPROVAL, make_source

NTD = "40110"


def _month(index: int) -> date:
    """Month ``index`` counting from January 2025."""
    return date(2025 + index // 12, index % 12 + 1, 1)


def _row(mode: str, tos: str, month: date, upt: int | None) -> dict[str, Any]:
    return {
        "ntd_id": NTD,
        "mode": mode,
        "tos": tos,
        "month": month,
        "agency": "Synthetic Transit",
        "mode_status": "Active",
        "upt": upt,
        "vrm": None,
        "vrh": None,
        "voms": None,
    }


def _load(connection: Connection, data: list[dict[str, Any]]) -> int:
    upsert_source(connection, make_source(id="ntd-monthly", **APPROVAL))
    run = connection.execute(
        text(
            "INSERT INTO tda.fetch_run (source_id, acquisition, status, finished_at) "
            "VALUES ('ntd-monthly', 'http', 'success', clock_timestamp()) RETURNING id"
        )
    ).scalar_one()
    insert_observations(connection, "ridership_monthly", data, run)
    return run


# Synthetic: MB (DO + PT) January 2025 to January 2026, then a February with PT unknown; DR (DO) June 2025 to
# January 2026, with September unknown.
MB = [_row("MB", "DO", _month(i), 1000 + 10 * i) for i in range(13)] + [
    _row("MB", "PT", _month(i), 100) for i in range(13)
]
INCOMPLETE = [_row("MB", "DO", _month(13), 1500), _row("MB", "PT", _month(13), None)]
DR = [_row("DR", "DO", _month(i), None if i == 8 else 50) for i in range(5, 13)]


def _current(engine: Engine) -> dict[tuple[str, str, str], tuple[Any, list[int]]]:
    return {
        (r.metric_key, r.dims["mode"], r.dims["month"]): (r.value, r.input_run_ids)
        for r in rows(
            engine,
            "SELECT metric_key, dims, value, input_run_ids FROM tda.current_metric_value "
            "WHERE metric_key LIKE 'ridership.%'",
        )
    }


def test_monthly_rolling_and_year_over_year_values(writer_engine: Engine) -> None:
    with writer_engine.begin() as connection:
        run = _load(connection, MB + INCOMPLETE + DR)
        assert ridership.record_ridership(connection, NTD) == 23
    got = _current(writer_engine)
    # MB: 13 complete months (1100 + 10i); February 2026 is incomplete, so nothing for it.
    assert got[("ridership.upt.monthly", "MB", "2026-01-01")] == (Decimal(1220), [run])
    assert ("ridership.upt.monthly", "MB", "2026-02-01") not in got
    # The 12 months ending January 2026 are i = 1..12: 12 x 1100 + 10 x 78.
    assert got[("ridership.upt.rolling_12m", "MB", "2026-01-01")] == (Decimal(13980), [run])
    assert got[("ridership.upt.rolling_12m", "MB", "2025-12-01")] == (Decimal(13860), [run])
    assert ("ridership.upt.rolling_12m", "MB", "2025-11-01") not in got, "only 11 months of data by then"
    # (1220 / 1100 - 1) x 100 = 10.909..., rounded to 0.01.
    assert got[("ridership.upt.yoy_pct", "MB", "2026-01-01")] == (Decimal("10.91"), [run])
    # DR: complete months only (September is unknown), and too short for a rolling total or a comparison.
    assert sorted(m for (k, mode, m) in got if mode == "DR") == [
        "2025-06-01",
        "2025-07-01",
        "2025-08-01",
        "2025-10-01",
        "2025-11-01",
        "2025-12-01",
        "2026-01-01",
    ]
    assert {k for (k, mode, _) in got if mode == "DR"} == {"ridership.upt.monthly"}
    with writer_engine.begin() as connection:
        assert ridership.record_ridership(connection, NTD) == 0, "unchanged values aren't rewritten"


def test_a_correction_rewrites_what_changed_and_withdraws_what_it_breaks(writer_engine: Engine) -> None:
    with writer_engine.begin() as connection:
        first = _load(connection, MB + DR)
        ridership.record_ridership(connection, NTD)
    with writer_engine.begin() as connection:
        # January 2026 PT becomes 150, and DR December becomes unknown.
        second = _load(connection, [_row("MB", "PT", _month(12), 150), _row("DR", "DO", _month(11), None)])
        assert ridership.record_ridership(connection, NTD) == 4
    got = _current(writer_engine)
    assert got[("ridership.upt.monthly", "MB", "2026-01-01")] == (Decimal(1270), [first, second])
    assert got[("ridership.upt.rolling_12m", "MB", "2026-01-01")] == (Decimal(14030), [first, second])
    assert got[("ridership.upt.yoy_pct", "MB", "2026-01-01")] == (Decimal("15.45"), [first, second])
    assert got[("ridership.upt.monthly", "DR", "2025-12-01")] == (None, [])
    assert got[("ridership.upt.monthly", "MB", "2025-12-01")] == (Decimal(1210), [first]), "untouched"


def test_rolling_back_the_correction_recomputes_from_the_earlier_rows(writer_engine: Engine) -> None:
    registry = MetricRegistry()
    ridership.register(registry)
    with writer_engine.begin() as connection:
        first = _load(connection, MB)
        ridership.record_ridership(connection, NTD)
    with writer_engine.begin() as connection:
        second = _load(connection, [_row("MB", "PT", _month(12), 150)])
        ridership.record_ridership(connection, NTD)
    plan = rollback_run(
        writer_engine,
        second,
        owned_tables=("ridership_monthly",),
        dry_run=False,
        metrics=registry,
        source_id="ntd-monthly",
    )
    assert {change.action for change in plan.metrics} == {"recompute"} and len(plan.metrics) == 3
    got = _current(writer_engine)
    assert got[("ridership.upt.monthly", "MB", "2026-01-01")] == (Decimal(1220), [first])
    assert got[("ridership.upt.rolling_12m", "MB", "2026-01-01")] == (Decimal(13980), [first])


def test_the_ridership_definitions_are_registered() -> None:
    assert set(ridership.KEYS) <= set(METRICS.definitions)
