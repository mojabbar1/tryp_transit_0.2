"""``tda metrics compute`` records headways and ridership from the current data (P4a)."""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import text
from typer.testing import CliRunner

from tda.cli import app
from tda.config.settings import get_settings
from tests.conftest import DbUrls
from tests.support.db import rows
from tests.support.feeds import LoadFeed, edited, r1_trip


@pytest.fixture
def invoke(db: DbUrls, monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    monkeypatch.setenv("TDA_DATABASE_URL", db.writer)
    runner = CliRunner()

    def run(*args: str) -> Any:
        get_settings.cache_clear()
        try:
            return runner.invoke(app, list(args), catch_exceptions=False)
        finally:
            get_settings.cache_clear()

    yield run


def test_compute_records_headways_then_only_changes(invoke: Any, load_feed: LoadFeed) -> None:
    feed = load_feed(edited(trips=[r1_trip("A1", "07:15"), r1_trip("A2", "07:30")]))
    first = invoke("metrics", "compute", "--date", "2026-09-01")
    assert first.exit_code == 0
    assert first.stdout.splitlines() == [
        f"headways carta-gtfs (feed version {feed.feed_version_id}): 1 written",
        "ridership carta (NTD 40110): 0 written",
    ]
    again = invoke("metrics", "compute", "--date", "2026-09-01")
    assert f"headways carta-gtfs (feed version {feed.feed_version_id}): 0 written" in again.stdout


def test_compute_without_data_writes_nothing(invoke: Any) -> None:
    result = invoke("metrics", "compute")
    assert result.exit_code == 0 and result.stdout.splitlines() == ["ridership carta (NTD 40110): 0 written"]


def test_a_bad_date_is_a_clean_error(invoke: Any) -> None:
    result = invoke("metrics", "compute", "--date", "2026-13-01")
    # Typer may render usage errors in a colored panel (CI does), so compare the plain words only.
    plain = " ".join(re.sub(r"[│╭╮╰╯─]", " ", re.sub(r"\x1b\[[0-9;]*m", "", result.stderr)).split())
    assert result.exit_code == 2 and "Invalid value" in plain and "--date" in plain


def test_compute_withdraws_headways_of_a_disabled_source(
    invoke: Any, load_feed: LoadFeed, db: DbUrls
) -> None:
    """Review F7: once a source has no active approved feed, its headways are withdrawn, not left current."""
    load_feed(edited(trips=[r1_trip("A1", "07:15"), r1_trip("A2", "07:30")]))
    invoke("metrics", "compute", "--date", "2026-09-01")
    engine = db.engine("writer")
    with engine.begin() as connection:
        connection.execute(text("UPDATE tda.source SET status = 'disabled' WHERE id = 'carta-gtfs'"))
    result = invoke("metrics", "compute", "--date", "2026-09-01")
    assert "headways withdrawn for sources without an active approved feed: 1" in result.stdout
    values = rows(
        engine, "SELECT value FROM tda.current_metric_value WHERE metric_key LIKE 'route.headway_min.%'"
    )
    engine.dispose()
    assert values == [(None,)]
