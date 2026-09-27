"""DB-test fixtures: an ``echo_obs`` observation table and an ``EchoConnector`` factory."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, text

from tda.config.settings import Settings
from tda.metrics.registry import MetricRegistry
from tda.store.observations import drop_observation_table_ddl, observation_table_ddl
from tda.store.raw_store import RawStore
from tests.conftest import DbUrls
from tests.support.echo import ECHO_COLUMNS, ECHO_TABLE, EchoConnector
from tests.support.factories import APPROVAL, make_source


def as_owner(db: DbUrls, statements: list[str]) -> None:
    """Run DDL the way a migration does: as tda_owner."""
    engine = db.engine("admin")
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL ROLE tda_owner"))
        for statement in statements:
            connection.execute(text(statement))
    engine.dispose()


def rows(engine: Engine, sql: str, **params: Any) -> list[Any]:
    """All result rows of one query."""
    with engine.connect() as connection:
        return list(connection.execute(text(sql), params))


@pytest.fixture
def writer_engine(db: DbUrls) -> Iterator[Engine]:
    engine = db.engine("writer")
    yield engine
    engine.dispose()


@pytest.fixture
def metrics() -> MetricRegistry:
    return MetricRegistry()


@pytest.fixture
def echo(
    db: DbUrls, writer_engine: Engine, tmp_path: Path, metrics: MetricRegistry
) -> Iterator[Callable[..., EchoConnector]]:
    """``echo(approved=True, payload=..., **source_fields)`` builds an EchoConnector on a fresh echo_obs."""
    as_owner(db, observation_table_ddl(ECHO_TABLE, ECHO_COLUMNS, ["name"]))
    store = RawStore(tmp_path / "raw")

    def make(*, approved: bool = True, payload: Any = None, **fields: Any) -> EchoConnector:
        source = make_source(id="echo", **({**APPROVAL, **fields} if approved else fields))
        return EchoConnector(
            source, engine=writer_engine, store=store, settings=Settings(), metrics=metrics, payload=payload
        )

    try:
        yield make
    finally:
        as_owner(db, drop_observation_table_ddl(ECHO_TABLE))
