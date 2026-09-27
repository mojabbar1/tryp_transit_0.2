"""Shared fixtures. DB tests need ``TDA_TEST_DATABASE_URL``: a superuser URL for a disposable database.

The database name must end in ``_test``: every session drops and rebuilds schema ``tda`` from the current
migrations, so a stale local schema can't hide a change. With trust auth the writer and reader connect as
``tda_writer`` / ``tda_reader`` on the same URL; with passwords, set ``TDA_TEST_WRITER_DATABASE_URL`` and
``TDA_TEST_READER_DATABASE_URL`` (same database).

With ``TDA_REQUIRE_DB_TESTS=1`` (CI), a DB test that would skip is reported as a failure instead, so the
grant, role, and append-only tests can't be silently skipped.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
import structlog
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from tda.store.db import sqlalchemy_url


@pytest.fixture(autouse=True)
def _default_logging() -> Iterator[None]:
    """CLI tests configure structlog; put its defaults back so no test logs into another's stream."""
    yield
    structlog.reset_defaults()


DB_URL = os.environ.get("TDA_TEST_DATABASE_URL")
REQUIRE_DB = os.environ.get("TDA_REQUIRE_DB_TESTS") == "1"
DB_TESTS = Path(__file__).parent / "db"


@dataclass(frozen=True)
class DbUrls:
    admin: str
    writer: str
    reader: str

    def engine(self, role: str) -> Engine:
        """A fresh engine for ``admin``, ``writer``, or ``reader``."""
        return create_engine(sqlalchemy_url(getattr(self, role)))


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if DB_TESTS in Path(str(item.fspath)).parents:
            item.add_marker(pytest.mark.db)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo) -> object:
    outcome = yield
    report = outcome.get_result()
    if REQUIRE_DB and report.skipped and item.get_closest_marker("db"):
        report.outcome = "failed"
        report.longrepr = "DB test skipped while TDA_REQUIRE_DB_TESTS=1 (a skip is a failure)"


def _role_url(admin: str, role: str, env_name: str) -> str:
    url = os.environ.get(env_name) or make_url(admin).set(username=role, password=None).render_as_string(
        hide_password=False
    )
    same = ("host", "port", "database")
    if tuple(getattr(make_url(url), f) for f in same) != tuple(getattr(make_url(admin), f) for f in same):
        pytest.fail(f"{env_name} must point at the same database as TDA_TEST_DATABASE_URL")
    return url


def _reset_schema(admin: str) -> None:
    engine = create_engine(sqlalchemy_url(admin))
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA IF EXISTS tda CASCADE"))
    engine.dispose()


@pytest.fixture(scope="session")
def db_urls() -> DbUrls:
    """Bootstrapped and freshly migrated test database URLs (session-wide)."""
    from tda.store.bootstrap import bootstrap, upgrade

    if not DB_URL:
        pytest.skip("set TDA_TEST_DATABASE_URL to run DB tests")
    database = make_url(DB_URL).database or ""
    if not database.endswith("_test"):
        pytest.fail(f"TDA_TEST_DATABASE_URL must name a disposable *_test database, not {database!r}")
    urls = DbUrls(
        DB_URL,
        _role_url(DB_URL, "tda_writer", "TDA_TEST_WRITER_DATABASE_URL"),
        _role_url(DB_URL, "tda_reader", "TDA_TEST_READER_DATABASE_URL"),
    )
    try:
        _reset_schema(urls.admin)
        bootstrap(urls.admin, urls.writer, urls.reader)
        upgrade(urls.admin)
    except OperationalError as error:
        pytest.skip(f"test database unreachable: {type(error).__name__}")
    return urls


TABLES = "tda.source, tda.fetch_run, tda.fact, tda.metric_value, tda.review_item, tda.agent_run"


@pytest.fixture
def db(db_urls: DbUrls) -> DbUrls:
    """An empty schema for each test.

    The guards refuse DELETE and TRUNCATE, so this superuser-only reset runs with triggers off
    (``session_replication_role = replica``). Nothing outside a disposable test database may do this.
    """
    engine = db_urls.engine("admin")
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL session_replication_role = replica"))
        connection.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    engine.dispose()
    return db_urls
