"""EIA weekly retail gasoline price, Lower Atlantic (PADD 1C) (P3.4, catalog S-11, source ``eia-gas``).

Fetched from EIA's official keyless bulk file of the series, ``EMM_EPMR_PTE_R1Z_DPGw.xls``: the acquisition
change the maintainer accepted in 05 §6, because API v2 needs a registered key. It's a polite conditional GET;
EIA publishes on Tuesdays, and prices are dated Mondays.

Data-quality checks. Any failure marks the run ``failed`` and loads nothing:
- the body is an .xls workbook whose "Data 1" sheet is the expected series (Sourcekey EMM_EPMR_PTE_R1Z_DPG);
- every row has a date and a numeric price;
- the weeks are continuous: Mondays, each 7 days after the last, with no gaps or repeats;
- every price is below $10, and every week since 2002 is within P3's sane range of $1–$10. Before 2002 the
  floor is $0.50, because the series has genuine sub-$1 prices until December 2001 (its minimum is $0.854);
  a unit or scale error still fails either way.

Facts (``tda/facts/rules/eia_gas.py``): ``fuel.gasoline.regular.padd1c.usd_per_gal``, the latest week's price,
auto-published because EIA data is public domain.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import structlog
import xlrd
from sqlalchemy import Connection

from tda.connectors.base import Connector, FetchResult, LoadStats, PriorRun, Row, ValidationFailed
from tda.connectors.registry import register
from tda.facts.rules import eia_gas as rules
from tda.http.polite_client import NotModified, RequestBudget
from tda.store.observations import insert_observations

log = structlog.get_logger(__name__)

SERIES = "EMM_EPMR_PTE_R1Z_DPG"
SHEET = "Data 1"
FIRST_DATA_ROW = 3
MAX_PRICE = Decimal(10)
SANE_MIN = Decimal(1)
# Every week since has been at least $1 (the series' last sub-$1 week is 2001-12-17).
SANE_FROM = date(2002, 1, 1)
HISTORICAL_MIN = Decimal("0.50")


def parse_workbook(raw: bytes) -> list[tuple[date, Decimal]]:
    """(week, price) pairs from EIA's bulk .xls, in file order. Raises ValidationFailed."""
    try:
        book = xlrd.open_workbook(file_contents=raw)
    except Exception as error:  # xlrd raises many types for a body that isn't a workbook
        raise ValidationFailed(f"the body is not a readable .xls workbook ({type(error).__name__})") from None
    try:
        sheet = book.sheet_by_name(SHEET)
    except xlrd.XLRDError:
        raise ValidationFailed(f"the workbook has no {SHEET!r} sheet") from None
    if sheet.nrows <= FIRST_DATA_ROW or sheet.ncols < 2:
        raise ValidationFailed(f"the {SHEET!r} sheet has no prices")
    sourcekey = (sheet.cell_value(1, 0), sheet.cell_value(1, 1))
    if sourcekey != ("Sourcekey", SERIES):
        raise ValidationFailed(f"the {SHEET!r} sheet is {sourcekey[1]!r}, not series {SERIES}")
    prices = []
    for r in range(FIRST_DATA_ROW, sheet.nrows):
        when, value = sheet.cell(r, 0), sheet.cell(r, 1)
        if when.ctype not in (xlrd.XL_CELL_DATE, xlrd.XL_CELL_NUMBER):
            raise ValidationFailed(f"{SHEET} row {r + 1}: the date is not a date")
        if value.ctype != xlrd.XL_CELL_NUMBER:
            raise ValidationFailed(f"{SHEET} row {r + 1}: the price is not a number")
        try:
            week = xlrd.xldate_as_datetime(when.value, book.datemode).date()
        except (xlrd.xldate.XLDateError, ValueError, OverflowError):
            raise ValidationFailed(f"{SHEET} row {r + 1}: the date is out of range") from None
        prices.append((week, Decimal(str(value.value)).quantize(Decimal("0.001"))))
    return prices


def validate(prices: list[tuple[date, Decimal]]) -> list[dict[str, Any]]:
    """The weekly-continuity and price-range checks; returns ``fuel_price_weekly`` rows."""
    if not prices:
        raise ValidationFailed("there are no prices")
    for i, (week, price) in enumerate(prices):
        if week.weekday() != 0:
            raise ValidationFailed(f"{week} is not a Monday")
        if i and week != prices[i - 1][0] + timedelta(days=7):
            raise ValidationFailed(f"weeks are not continuous: {prices[i - 1][0]} is followed by {week}")
        floor = SANE_MIN if week >= SANE_FROM else HISTORICAL_MIN
        if not floor <= price < MAX_PRICE:
            raise ValidationFailed(f"{week}: ${price} is outside ${floor}–${MAX_PRICE}")
    return [{"series_id": SERIES, "week": week, "usd_per_gal": price} for week, price in prices]


@register
class EiaGasConnector(Connector):
    """EIA's weekly PADD 1C regular gasoline price, from the series' keyless bulk file."""

    source_id = "eia-gas"
    owned_tables = ("fuel_price_weekly",)

    def fetch(self, prior: PriorRun | None, budget: RequestBudget | None) -> FetchResult | NotModified:
        return self.http_get(prior, budget, ext="xls")

    def normalize(self, raw: bytes) -> Iterable[Row]:
        yield from validate(parse_workbook(raw))

    def load(self, connection: Connection, rows: list[Row], run_id: int) -> LoadStats:
        return LoadStats(
            {"fuel_price_weekly": insert_observations(connection, "fuel_price_weekly", rows, run_id)}
        )

    def publish(self, connection: Connection, run_id: int) -> None:
        written = rules.publish(connection, run_id=run_id, source_id=self.source.id, series=SERIES)
        log.info("eia.facts_published", run_id=run_id, facts=len(written))
