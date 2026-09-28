"""Helpers for DB-backed tests."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Engine, text

from tests.conftest import DbUrls


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
