"""NTD monthly ridership facts (P3.2), auto-published because NTD is official public-domain data.

Per mode, types of service summed:
- ``<agency>.ridership.upt.monthly.<mode>``: UPT in the latest complete month, where every type of service
  reported a count. A later month with an unknown (null) count is logged as incomplete and not published.
- ``<agency>.ridership.upt.monthly.<mode>.yoy_pct``: the percent change from the same month a year earlier,
  only when that month is also complete and above zero.

Everything comes from ``current_ridership_monthly``, which can mix rows from several successful runs. So:
- **Lineage:** each fact cites the runs its rows came from (both months for a year-over-year change). Those
  runs are locked ``FOR SHARE`` before anything is written, and a rolled-back one fails the publication (and
  so the load), rather than publishing a stale calculation.
- **Serialized:** publication takes a per-source lock before reading, so the aggregation, the unchanged
  check, and the writes are one step, and a slower run can't publish over a newer one.
- A fact is re-published only when its value, period, or unit changes, so re-loading the same numbers
  doesn't churn versions.
- **Withdrawn when it can't be produced:** if a correction leaves a mode's key without a valid value (say, a
  null count now in the year-earlier month), its approved fact moves to ``needs_review``, as a rollback does.
  The version is kept, and the next complete publication supersedes it.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

import structlog
from sqlalchemy import Connection, text

from tda.facts.versions import FactDraft, write_fact
from tda.store.lineage import LineageError, key_lock, lock_input_runs

log = structlog.get_logger(__name__)

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


def _key(agency: str, mode: str) -> str:
    return f"{agency}.ridership.upt.monthly.{MODE_NAMES.get(mode, mode.lower())}"


@dataclass
class _Month:
    """One mode's month: the UPT sum, whether every type of service reported, and where the rows came from."""

    upt: int = 0
    complete: bool = True
    runs: set[int] = field(default_factory=set)
    tos: set[str] = field(default_factory=set)


def publish(connection: Connection, *, run_id: int, source_id: str, agency: str, ntd_id: str) -> list[int]:
    """Write the latest-month and year-over-year facts for every mode; returns the new fact ids."""
    key_lock(connection, "publish", source_id)
    months: dict[str, dict[date, _Month]] = defaultdict(lambda: defaultdict(_Month))
    for row in connection.execute(
        text(
            "SELECT mode, tos, month, upt, fetch_run_id FROM tda.current_ridership_monthly WHERE ntd_id = :n"
        ),
        {"n": ntd_id},
    ):
        month = months[row.mode][row.month]
        month.runs.add(row.fetch_run_id)
        month.tos.add(row.tos)
        if row.upt is None:
            month.complete = False
        else:
            month.upt += row.upt
    drafts = [
        draft
        for mode, by_month in sorted(months.items())
        for draft in _drafts(mode, by_month, run_id=run_id, source_id=source_id, agency=agency, ntd_id=ntd_id)
    ]
    try:
        lock_input_runs(connection, [r for draft in drafts for r in draft.derived_from["input_run_ids"]])
    except LineageError as error:
        raise LineageError(f"NTD facts not published: {error}") from None
    owned = {key for mode in months for key in (_key(agency, mode), f"{_key(agency, mode)}.yoy_pct")}
    withdrawn = _withdraw(connection, sorted(owned - {draft.key for draft in drafts}))
    if withdrawn:
        log.warning("ntd.facts_withdrawn", run_id=run_id, keys=withdrawn, status="needs_review")
    return [
        write_fact(connection, draft, auto_publish=True)
        for draft in drafts
        if not _unchanged(connection, draft)
    ]


def _withdraw(connection: Connection, keys: list[str]) -> list[str]:
    """Approved facts the rule can no longer produce become ``needs_review``; returns the keys changed."""
    withdrawn = []
    for key in keys:
        key_lock(connection, "fact", key)
        flagged = connection.execute(
            text(
                "UPDATE tda.fact SET status = 'needs_review' "
                "WHERE key = :k AND status = 'approved' RETURNING id"
            ),
            {"k": key},
        ).first()
        if flagged is not None:
            withdrawn.append(key)
    return withdrawn


def _drafts(
    mode: str, by_month: dict[date, _Month], *, run_id: int, source_id: str, agency: str, ntd_id: str
) -> list[FactDraft]:
    name = MODE_NAMES.get(mode, mode.lower())
    complete = [m for m, month in by_month.items() if month.complete]
    if not complete:
        log.warning("ntd.incomplete_period", run_id=run_id, mode=mode, months="all", published=False)
        return []
    latest = max(complete)
    withheld = sorted(m.isoformat() for m, month in by_month.items() if not month.complete and m > latest)
    if withheld:
        log.warning("ntd.incomplete_period", run_id=run_id, mode=mode, months=withheld, published=False)
    current = by_month[latest]
    common = {
        "source_ids": [source_id],
        "geography": f"agency:ntd:{ntd_id}",
        "period_start": latest,
        "period_end": _month_end(latest),
        "confidence": "official",
        "created_by": "connector",
    }
    evidence = {"dataset": DATASET, "ntd_id": ntd_id, "mode": mode, "month": latest.isoformat()}
    key = _key(agency, mode)
    drafts = [
        FactDraft(
            key=key,
            value_num=current.upt,
            unit=f"unlinked passenger trips (UPT), {name.replace('_', ' ')}, month",
            method=f"NTD monthly ridership (8bui-9xvu), mode={mode}, all types of service; {RULE}",
            derived_from={"input_run_ids": sorted(current.runs), "rule": RULE},
            evidence={**evidence, "tos": sorted(current.tos)},
            **common,
        )
    ]
    prior_month = latest.replace(year=latest.year - 1)
    prior = by_month.get(prior_month)
    if prior is not None and not prior.complete:
        log.warning(
            "ntd.incomplete_period",
            run_id=run_id,
            mode=mode,
            months=[prior_month.isoformat()],
            fact="yoy_pct",
        )
    elif prior is not None and prior.upt > 0:
        change = (Decimal(current.upt) / Decimal(prior.upt) - 1) * 100
        drafts.append(
            FactDraft(
                key=f"{key}.yoy_pct",
                value_num=change.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN),
                unit=f"percent change in UPT vs the same month a year earlier, {name.replace('_', ' ')}",
                method=f"(UPT {latest:%Y-%m} / UPT {prior_month:%Y-%m} - 1) x 100, rounded to 0.01; {RULE}",
                derived_from={"input_run_ids": sorted(current.runs | prior.runs), "rule": RULE},
                evidence={
                    **evidence,
                    "tos": sorted(current.tos),
                    "compared_with": prior_month.isoformat(),
                    "compared_tos": sorted(prior.tos),
                },
                **common,
            )
        )
    return drafts


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
