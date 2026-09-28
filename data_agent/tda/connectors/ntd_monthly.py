"""NTD Complete Monthly Ridership (P3.2, catalog S-3, source ``ntd-monthly``).

It fetches every monthly row for the region's agency by NTD ID (``ntd_id='40110'`` for CARTA, never the
display name) from the Socrata resource ``8bui-9xvu``:
- It pages with ``$limit``/``$offset`` under a total ``$order``.
- It sends ``X-App-Token`` only when ``TDA_SOCRATA_APP_TOKEN`` is set.
- It combines the pages into one canonical JSON body, so the same data always has the same sha256 and an
  unchanged week is ``not_modified``.

Data-quality checks (any failure marks the run ``failed``, and nothing is loaded):
- there is at least one row;
- every row has the expected ``ntd_id``, a mode, a type of service, and a first-of-month date;
- counts are non-negative (UPT and VOMS are whole numbers);
- (ntd_id, mode, tos, month) is unique.
Month gaps per mode and type of service are logged, not fatal. Facts come from
``tda.facts.rules.ntd_monthly``.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from collections.abc import Iterable
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlencode

import structlog
from sqlalchemy import Connection

from tda.config.models import Agency
from tda.config.registry import load_region
from tda.connectors.base import Connector, FetchResult, LoadStats, PriorRun, Row, ValidationFailed
from tda.connectors.registry import register
from tda.facts.rules import ntd_monthly as rules
from tda.http.polite_client import FetchError, NotModified, RequestBudget
from tda.store.observations import insert_observations

log = structlog.get_logger(__name__)

PAGE_SIZE = 1000
MAX_PAGES = 50
_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?)?$")


def _number(row: dict[str, Any], field: str, index: int, *, whole: bool) -> Decimal | int | None:
    value = row.get(field)
    if value in (None, ""):
        return None
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ValidationFailed(f"row {index}: {field} {value!r} is not a number") from None
    if not number.is_finite() or number < 0:
        raise ValidationFailed(f"row {index}: {field} {value!r} must be a non-negative number")
    if whole:
        if number != number.to_integral_value():
            raise ValidationFailed(f"row {index}: {field} {value!r} must be a whole number")
        return int(number)
    return number


def parse_rows(raw: bytes, ntd_id: str) -> list[dict[str, Any]]:
    """Validate the combined Socrata rows for ``ntd_id``; raises ValidationFailed."""
    try:
        rows = json.loads(raw)
    except ValueError:
        raise ValidationFailed("the response is not JSON") from None
    if not isinstance(rows, list):
        raise ValidationFailed("the response is not a list of rows")
    if not rows:
        raise ValidationFailed(f"no rows for ntd_id {ntd_id}; check the filter and the dataset")
    out = []
    seen: set[tuple[str, str, str, date]] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValidationFailed(f"row {index} is not an object")
        if row.get("ntd_id") != ntd_id:
            raise ValidationFailed(f"row {index}: ntd_id {row.get('ntd_id')!r} is not {ntd_id!r}")
        mode, tos = row.get("mode"), row.get("tos")
        if not mode or not tos:
            raise ValidationFailed(f"row {index}: mode and tos are required")
        match = _DATE.match(str(row.get("date") or ""))
        if not match:
            raise ValidationFailed(f"row {index}: date {row.get('date')!r} is not a Socrata calendar date")
        try:
            month = date(int(match[1]), int(match[2]), int(match[3]))
        except ValueError:
            raise ValidationFailed(f"row {index}: date {row.get('date')!r} is not a real date") from None
        if month.day != 1:
            raise ValidationFailed(f"row {index}: date {month} is not the first of a month")
        key = (ntd_id, mode, tos, month)
        if key in seen:
            raise ValidationFailed(f"duplicate (ntd_id, mode, tos, month) {key}")
        seen.add(key)
        out.append(
            {
                "ntd_id": ntd_id,
                "mode": mode,
                "tos": tos,
                "month": month,
                "agency": row.get("agency"),
                "mode_status": row.get("mode_type_of_service_status"),
                "upt": _number(row, "upt", index, whole=True),
                "vrm": _number(row, "vrm", index, whole=False),
                "vrh": _number(row, "vrh", index, whole=False),
                "voms": _number(row, "voms", index, whole=True),
            }
        )
    _report_gaps(out)
    return out


def _report_gaps(rows: list[dict[str, Any]]) -> None:
    months: dict[tuple[str, str], set[date]] = defaultdict(set)
    for row in rows:
        months[(row["mode"], row["tos"])].add(row["month"])
    for (mode, tos), present in sorted(months.items()):
        first, last = min(present), max(present)
        expected = (last.year - first.year) * 12 + last.month - first.month + 1
        if len(present) < expected:
            log.warning(
                "ntd.month_gaps", mode=mode, tos=tos, missing=expected - len(present), first=str(first)
            )


@register
class NtdMonthlyConnector(Connector):
    """Weekly Socrata pull of the region agency's monthly ridership."""

    source_id = "ntd-monthly"
    owned_tables = ("ridership_monthly",)

    def agency(self) -> Agency:
        """The region's one agency with an NTD ID (``regions/<region>.yaml``)."""
        with_ids = [a for a in load_region(settings=self.settings).agencies if a.ntd_id]
        if len(with_ids) != 1:
            raise ValueError(f"expected exactly one region agency with an ntd_id, found {len(with_ids)}")
        return with_ids[0]

    def fetch(self, prior: PriorRun | None, budget: RequestBudget | None) -> FetchResult | NotModified:
        if self.client is None:
            raise RuntimeError("a live run needs the polite client")
        ntd_id = self.agency().ntd_id
        token = self.settings.socrata_app_token
        headers = {"X-App-Token": token.get_secret_value()} if token else None
        rows: list[Any] = []
        for page in range(MAX_PAGES):
            query = urlencode(
                {
                    "$where": f"ntd_id='{ntd_id}'",
                    "$order": "date,mode,tos,agency_mode_tos_date",
                    "$limit": PAGE_SIZE,
                    "$offset": page * PAGE_SIZE,
                }
            )
            response = self.client.fetch(
                self.source, f"{self.source.url}?{query}", budget=budget, headers=headers
            )
            if isinstance(response, NotModified):
                raise FetchError("got 304 Not Modified to an unconditional request")
            try:
                batch = json.loads(response.body)
            except ValueError:
                raise FetchError(f"page {page + 1} is not JSON") from None
            if not isinstance(batch, list):
                raise FetchError(f"page {page + 1} is not a list of rows")
            rows.extend(batch)
            if len(batch) < PAGE_SIZE:
                break
        else:
            raise FetchError(f"more than {MAX_PAGES} pages of {PAGE_SIZE} rows")
        body = json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        return FetchResult(body, "json", http_status=200)

    def normalize(self, raw: bytes) -> Iterable[Row]:
        ntd_id = self.agency().ntd_id
        assert ntd_id is not None
        return parse_rows(raw, ntd_id)

    def load(self, connection: Connection, rows: list[Row], run_id: int) -> LoadStats:
        return LoadStats(
            {"ridership_monthly": insert_observations(connection, "ridership_monthly", rows, run_id)}
        )

    def publish(self, connection: Connection, run_id: int) -> None:
        agency = self.agency()
        assert agency.ntd_id is not None
        written = rules.publish(
            connection, run_id=run_id, source_id=self.source.id, agency=agency.id, ntd_id=agency.ntd_id
        )
        log.info("ntd.facts_published", run_id=run_id, facts=len(written))
