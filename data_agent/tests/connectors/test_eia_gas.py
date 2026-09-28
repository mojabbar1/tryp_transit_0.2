"""EIA weekly gasoline connector (P3.4): parsing the bulk .xls, DQ checks, loads, the fact, and rollback."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from tda.config.settings import Settings
from tda.connectors import eia_gas
from tda.connectors.base import ValidationFailed
from tda.connectors.eia_gas import EiaGasConnector, parse_workbook, validate
from tda.connectors.registry import connector_class
from tda.http.polite_client import PoliteClient
from tda.store.raw_store import RawStore
from tests.conftest import DbUrls
from tests.support.db import rows
from tests.support.factories import APPROVAL, make_source

URL = "https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_R1Z_DPGw.xls"
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "eia-gas" / "EMM_EPMR_PTE_R1Z_DPGw.xls"
KEY = "fuel.gasoline.regular.padd1c.usd_per_gal"


def _weeks(prices: list[str], start: date = date(2024, 1, 1)) -> list[tuple[date, Decimal]]:
    return [(start + timedelta(weeks=i), Decimal(p)) for i, p in enumerate(prices)]


# Parsing and data-quality checks (no database)


def test_the_real_bulk_file_parses() -> None:
    prices = parse_workbook(FIXTURE.read_bytes())
    assert len(prices) == 1747
    assert prices[0] == (date(1993, 4, 5), Decimal("1.023"))
    assert prices[-1] == (date(2026, 9, 21), Decimal("4.163"))
    rows_ = validate(prices)
    assert rows_[-1] == {
        "series_id": "EMM_EPMR_PTE_R1Z_DPG",
        "week": date(2026, 9, 21),
        "usd_per_gal": Decimal("4.163"),
    }


def test_sub_dollar_prices_are_real_before_2002_but_not_since() -> None:
    history = _weeks(["0.954"] * 5 + ["1.250"] * 3, start=date(2001, 12, 3))
    assert len(validate(history)) == 8, "EIA's genuine sub-$1 weeks end in December 2001"
    with pytest.raises(ValidationFailed, match="2002-01-07: \\$0.954 is outside \\$1–\\$10"):
        validate(_weeks(["0.954"], start=date(2002, 1, 7)))
    with pytest.raises(ValidationFailed, match="1999-03-29: \\$0.300 is outside \\$0.50–\\$10"):
        validate(_weeks(["0.300"], start=date(1999, 3, 29)))
    with pytest.raises(ValidationFailed, match="2025-09-15: \\$0.001 is outside \\$1–\\$10"):
        validate(_weeks(["0.001"], start=date(2025, 9, 15)))


@pytest.mark.parametrize(
    ("prices", "message"),
    [
        ([], "there are no prices"),
        ([(date(2024, 1, 2), Decimal("3.1"))], "2024-01-02 is not a Monday"),
        (_weeks(["3.1", "3.2"])[:1] + [(date(2024, 1, 15), Decimal("3.2"))], "weeks are not continuous"),
        (_weeks(["3.1"]) * 2, "weeks are not continuous"),
        (_weeks(["0"]), "is outside \\$1–\\$10"),
        (_weeks(["10.000"]), "is outside \\$1–\\$10"),
    ],
)
def test_invalid_prices_are_rejected(prices: list[tuple[date, Decimal]], message: str) -> None:
    with pytest.raises(ValidationFailed, match=message):
        validate(prices)


def test_other_files_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationFailed, match="not a readable .xls workbook"):
        parse_workbook(b"<html>maintenance</html>")
    monkeypatch.setattr(eia_gas, "SERIES", "EMM_EPMR_PTE_NUS_DPG")
    with pytest.raises(ValidationFailed, match="is 'EMM_EPMR_PTE_R1Z_DPG', not series EMM_EPMR_PTE_NUS_DPG"):
        parse_workbook(FIXTURE.read_bytes())
    monkeypatch.setattr(eia_gas, "SHEET", "Data 9")
    with pytest.raises(ValidationFailed, match="has no 'Data 9' sheet"):
        parse_workbook(FIXTURE.read_bytes())


# Loading and the fact (Postgres)


@pytest.fixture
def eia(
    db: DbUrls, writer_engine: Engine, tmp_path: Path
) -> Iterator[tuple[EiaGasConnector, respx.MockRouter]]:
    client = PoliteClient(Settings(), sleep=lambda _seconds: None)
    source = make_source(id="eia-gas", kind="rest", url=URL, **APPROVAL)
    connector = EiaGasConnector(
        source, engine=writer_engine, store=RawStore(tmp_path / "raw"), client=client, settings=Settings()
    )
    with respx.mock(assert_all_called=False) as router:
        yield connector, router
    client.close()


def _serve(router: respx.MockRouter, body: bytes, etag: str = '"w38"') -> None:
    router.get(URL).mock(return_value=httpx.Response(200, content=body, headers={"ETag": etag}))


def _fact(engine: Engine) -> Any:
    (fact,) = rows(
        engine,
        "SELECT value_num, period_start, period_end, unit, geography, source_ids, derived_from, status, "
        "version FROM tda.fact WHERE key = :k AND status IN ('approved', 'needs_review')",
        k=KEY,
    )
    return fact


def test_a_run_loads_every_week_and_publishes_the_latest_price(eia: Any, writer_engine: Engine) -> None:
    connector, router = eia
    _serve(router, FIXTURE.read_bytes())
    outcome = connector.run(live=True)
    assert (outcome.status, outcome.rows_loaded) == ("success", 1747)
    fact = _fact(writer_engine)
    assert (fact.value_num, str(fact.period_start), str(fact.period_end)) == (
        Decimal("4.163"),
        "2026-09-21",
        "2026-09-21",
    )
    assert (fact.unit, fact.geography, fact.source_ids) == (eia_gas.rules.UNIT, "region:padd-1c", ["eia-gas"])
    assert (fact.status, fact.version, fact.derived_from["input_run_ids"]) == (
        "approved",
        1,
        [outcome.run_id],
    )


def test_an_unchanged_file_is_not_modified(eia: Any, writer_engine: Engine) -> None:
    connector, router = eia
    _serve(router, FIXTURE.read_bytes())
    connector.run(live=True)
    assert connector.run(live=True).status == "not_modified", "the same sha256"
    router.get(URL).respond(304, headers={"ETag": '"w38"'})
    assert connector.run(live=True).status == "not_modified"
    assert rows(writer_engine, "SELECT count(*) FROM tda.fuel_price_weekly")[0][0] == 1747
    assert _fact(writer_engine).version == 1


def _with_a_new_week(monkeypatch: pytest.MonkeyPatch, price: str) -> None:
    real = eia_gas.parse_workbook

    def parse(raw: bytes) -> list[tuple[date, Decimal]]:
        prices = real(FIXTURE.read_bytes())
        return [*prices, (prices[-1][0] + timedelta(weeks=1), Decimal(price))]

    monkeypatch.setattr(eia_gas, "parse_workbook", parse)


def test_a_new_week_publishes_a_new_version_and_rollback_flags_it(
    eia: Any, writer_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    connector, router = eia
    _serve(router, FIXTURE.read_bytes())
    connector.run(live=True)
    _with_a_new_week(monkeypatch, "4.201")
    _serve(router, b"the next week's file", etag='"w39"')
    second = connector.run(live=True)
    assert second.status == "success"
    fact = _fact(writer_engine)
    assert (fact.value_num, str(fact.period_start), fact.version) == (Decimal("4.201"), "2026-09-28", 2)
    connector.rollback(second.run_id, dry_run=False)
    assert _fact(writer_engine).status == "needs_review", "its input run was rolled back"
    latest = rows(writer_engine, "SELECT max(week) FROM tda.current_fuel_price_weekly")[0][0]
    assert str(latest) == "2026-09-21", "the previous file's weeks are current again"


def test_an_invalid_file_fails_the_run_and_loads_nothing(eia: Any, writer_engine: Engine) -> None:
    connector, router = eia
    _serve(router, b"<html>maintenance</html>")
    outcome = connector.run(live=True)
    assert outcome.status == "failed" and "not a readable .xls workbook" in (outcome.message or "")
    assert rows(writer_engine, "SELECT count(*) FROM tda.fuel_price_weekly")[0][0] == 0
    assert rows(writer_engine, "SELECT count(*) FROM tda.fact")[0][0] == 0


def test_prices_are_append_only_and_the_reader_sees_only_the_current_view(
    eia: Any, db: DbUrls, writer_engine: Engine
) -> None:
    connector, router = eia
    _serve(router, FIXTURE.read_bytes())
    connector.run(live=True)
    with writer_engine.connect() as connection:
        with pytest.raises(DBAPIError, match="permission denied"):
            connection.execute(text("UPDATE tda.fuel_price_weekly SET usd_per_gal = 1"))
    reader = db.engine("reader")
    with reader.connect() as connection:
        assert (
            connection.execute(text("SELECT count(*) FROM tda.current_fuel_price_weekly")).scalar_one()
            == 1747
        )
        with pytest.raises(DBAPIError, match="permission denied"):
            connection.execute(text("SELECT 1 FROM tda.fuel_price_weekly"))
    reader.dispose()


def test_the_connector_is_registered() -> None:
    assert connector_class("eia-gas") is EiaGasConnector
