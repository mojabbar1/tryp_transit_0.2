"""NTD monthly ridership metrics (P4a task 4), from ``current_ridership_monthly``.

Per agency and mode, summed over types of service, each month is **complete** only when every type of service
reported a count (as in the P3.2 rule). Only complete months produce values:
- ``ridership.upt.monthly``: the month's UPT;
- ``ridership.upt.rolling_12m``: the 12 months ending with it, when all 12 are complete;
- ``ridership.upt.yoy_pct``: the percent change from the same month a year earlier, when that month is also
  complete and above zero (rounded to 0.01, like the rule's fact).

Dims are ``ntd_id``, ``mode`` (the NTD code), and ``month`` (its first day). Each value's lineage is the runs
its months' rows came from. A value is recorded only when it or its lineage changes, and one that can no
longer be computed gets NULL (withdrawn) **with the lineage of the rows it would need**, so rolling back the
run that made it uncomputable finds it and recomputes it. The facts stay with the P3.2 rule
(``tda.facts.rules.ntd_monthly``), which auto-publishes the latest month and its year-over-year change; this
module adds no fact.
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal
from functools import partial
from typing import Any

import structlog
from sqlalchemy import Connection, text

from tda.metrics.registry import MetricDefinition, MetricRegistry, MetricResult, record_metric

log = structlog.get_logger(__name__)

METHOD = "ridership.v1"
MONTHLY = "ridership.upt.monthly"
ROLLING = "ridership.upt.rolling_12m"
YOY = "ridership.upt.yoy_pct"
KEYS = (MONTHLY, ROLLING, YOY)
UNITS = {MONTHLY: "UPT", ROLLING: "UPT", YOY: "percent"}


@dataclass
class Month:
    """One mode's month: the UPT sum, whether every type of service reported, and the runs it came from."""

    upt: int = 0
    complete: bool = True
    runs: set[int] = field(default_factory=set)


def monthly_series(connection: Connection, ntd_id: str) -> dict[str, dict[date, Month]]:
    """mode -> month -> :class:`Month`, from the current rows."""
    series: dict[str, dict[date, Month]] = defaultdict(lambda: defaultdict(Month))
    for row in connection.execute(
        text("SELECT mode, month, upt, fetch_run_id FROM tda.current_ridership_monthly WHERE ntd_id = :n"),
        {"n": ntd_id},
    ):
        month = series[row.mode][row.month]
        month.runs.add(row.fetch_run_id)
        if row.upt is None:
            month.complete = False
        else:
            month.upt += row.upt
    return series


def _shift(month: date, months: int) -> date:
    index = month.year * 12 + month.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def values(by_month: Mapping[date, Month]) -> dict[tuple[str, date], MetricResult]:
    """Every computable (metric key, month) for one mode."""
    result: dict[tuple[str, date], MetricResult] = {}
    for month, current in by_month.items():
        if not current.complete:
            continue
        result[(MONTHLY, month)] = MetricResult(Decimal(current.upt), sorted(current.runs), UNITS[MONTHLY])
        window = [by_month.get(_shift(month, -k)) for k in range(12)]
        if all(m is not None and m.complete for m in window):
            runs = sorted({r for m in window if m is not None for r in m.runs})
            total = sum(m.upt for m in window if m is not None)
            result[(ROLLING, month)] = MetricResult(Decimal(total), runs, UNITS[ROLLING])
        prior = by_month.get(_shift(month, -12))
        if prior is not None and prior.complete and prior.upt > 0:
            change = (Decimal(current.upt) / Decimal(prior.upt) - 1) * 100
            result[(YOY, month)] = MetricResult(
                change.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN),
                sorted(current.runs | prior.runs),
                UNITS[YOY],
            )
    return result


def _window(key: str, month: date) -> list[date]:
    """The months a key's value for ``month`` is computed from."""
    if key == ROLLING:
        return [_shift(month, -k) for k in range(12)]
    if key == YOY:
        return [month, _shift(month, -12)]
    return [month]


def lineage(by_month: Mapping[date, Month], key: str, month: date) -> list[int]:
    """The runs of the current rows a key's value for ``month`` depends on (for a withdrawal's lineage)."""
    return sorted({run for m in _window(key, month) if m in by_month for run in by_month[m].runs})


def _dims(ntd_id: str, mode: str, month: date) -> dict[str, Any]:
    return {"month": month.isoformat(), "mode": mode, "ntd_id": ntd_id}


def record_ridership(connection: Connection, ntd_id: str) -> int:
    """Record changed ridership metrics for one agency and withdraw stale ones; returns rows written."""
    wanted: dict[tuple[str, str], MetricResult] = {}
    series = monthly_series(connection, ntd_id)
    for mode, by_month in series.items():
        for (key, month), result in values(by_month).items():
            wanted[(key, json.dumps(_dims(ntd_id, mode, month), sort_keys=True))] = result
    current = {
        (row.metric_key, json.dumps(row.dims, sort_keys=True)): row
        for row in connection.execute(
            text(
                "SELECT metric_key, dims, value, unit, input_run_ids FROM tda.current_metric_value "
                "WHERE metric_key = ANY(:keys) AND dims ->> 'ntd_id' = :n"
            ),
            {"keys": list(KEYS), "n": ntd_id},
        )
    }
    written = 0
    for (key, dims), result in sorted(wanted.items()):
        row = current.get((key, dims))
        if row is None or (row.value, row.unit, sorted(row.input_run_ids)) != (
            result.value,
            result.unit,
            result.input_run_ids,
        ):
            record_metric(connection, key, json.loads(dims), result, METHOD)
            written += 1
    for (key, dims), row in sorted(current.items()):
        if (key, dims) not in wanted and row.value is not None:
            parsed = json.loads(dims)
            runs = lineage(series.get(parsed["mode"], {}), key, date.fromisoformat(parsed["month"]))
            record_metric(connection, key, parsed, MetricResult(None, runs, UNITS[key]), METHOD)
            written += 1
    log.info("metrics.ridership", ntd_id=ntd_id, written=written)
    return written


def _recompute(key: str, connection: Connection, dims: Mapping[str, Any]) -> MetricResult:
    """Rollback's recompute of one value from the current rows (None when it can't be computed now)."""
    by_month = monthly_series(connection, str(dims["ntd_id"])).get(str(dims["mode"]), {})
    month = date.fromisoformat(str(dims["month"]))
    return values(by_month).get((key, month), MetricResult(None, lineage(by_month, key, month), UNITS[key]))


def register(registry: MetricRegistry) -> None:
    """Add the ridership definitions (used by rollback to recompute a value)."""
    for key in KEYS:
        registry.register(MetricDefinition(key, METHOD, partial(_recompute, key)))
