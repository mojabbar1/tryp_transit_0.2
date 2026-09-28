"""NTD monthly ridership facts (P3.2), auto-published because NTD is official public-domain data.

Per mode, types of service summed:
- ``<agency>.ridership.upt.monthly.<mode>``: UPT in the latest month that has data.
- ``<agency>.ridership.upt.monthly.<mode>.yoy_pct``: the percent change from the same month a year earlier,
  only when that month exists and is above zero.

Everything comes from ``current_ridership_monthly``. A fact is re-published only when its value or period
changes, so re-loading the same numbers doesn't churn versions.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import Connection, text

from tda.facts.versions import FactDraft, write_fact

RULE = "ntd_monthly.v1"
DATASET = "https://data.transportation.gov/resource/8bui-9xvu"
# NTD mode codes (NTD glossary). Unlisted codes use their lowercase code.
MODE_NAMES = {
    "MB": "bus",
    "CB": "commuter_bus",
    "DR": "demand_response",
    "RB": "bus_rapid_transit",
    "VP": "vanpool",
}


def _month_end(month: date) -> date:
    return month.replace(day=calendar.monthrange(month.year, month.month)[1])


def publish(connection: Connection, *, run_id: int, source_id: str, agency: str, ntd_id: str) -> list[int]:
    """Write the latest-month and year-over-year facts for every mode; returns the new fact ids."""
    totals: dict[str, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    services: dict[str, set[str]] = defaultdict(set)
    for row in connection.execute(
        text(
            "SELECT mode, tos, month, upt FROM tda.current_ridership_monthly "
            "WHERE ntd_id = :n AND upt IS NOT NULL"
        ),
        {"n": ntd_id},
    ):
        totals[row.mode][row.month] += row.upt
        services[row.mode].add(row.tos)
    written = []
    for mode, by_month in sorted(totals.items()):
        name = MODE_NAMES.get(mode, mode.lower())
        latest = max(by_month)
        common = {
            "source_ids": [source_id],
            "geography": f"agency:ntd:{ntd_id}",
            "period_start": latest,
            "period_end": _month_end(latest),
            "confidence": "official",
            "created_by": "connector",
        }
        evidence = {"dataset": DATASET, "ntd_id": ntd_id, "mode": mode, "tos": sorted(services[mode])}
        key = f"{agency}.ridership.upt.monthly.{name}"
        drafts = [
            FactDraft(
                key=key,
                value_num=by_month[latest],
                unit=f"unlinked passenger trips (UPT), {name.replace('_', ' ')}, month",
                method=f"NTD monthly ridership (8bui-9xvu), mode={mode}, all types of service; {RULE}",
                derived_from={"input_run_ids": [run_id], "rule": RULE},
                evidence={**evidence, "month": latest.isoformat()},
                **common,
            )
        ]
        prior = latest.replace(year=latest.year - 1)
        if by_month.get(prior, 0) > 0:
            change = (Decimal(by_month[latest]) / Decimal(by_month[prior]) - 1) * 100
            drafts.append(
                FactDraft(
                    key=f"{key}.yoy_pct",
                    value_num=change.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN),
                    unit=f"percent change in UPT vs the same month a year earlier, {name.replace('_', ' ')}",
                    method=f"(UPT {latest:%Y-%m} / UPT {prior:%Y-%m} - 1) x 100, rounded to 0.01; {RULE}",
                    derived_from={"input_run_ids": [run_id], "rule": RULE},
                    evidence={**evidence, "month": latest.isoformat(), "compared_with": prior.isoformat()},
                    **common,
                )
            )
        for draft in drafts:
            if not _unchanged(connection, draft):
                written.append(write_fact(connection, draft, auto_publish=True))
    return written


def _unchanged(connection: Connection, draft: FactDraft) -> bool:
    current = connection.execute(
        text("SELECT value_num, period_start, unit FROM tda.fact WHERE key = :k AND status = 'approved'"),
        {"k": draft.key},
    ).one_or_none()
    return current is not None and (current.value_num, current.period_start, current.unit) == (
        Decimal(draft.value_num),
        draft.period_start,
        draft.unit,
    )
