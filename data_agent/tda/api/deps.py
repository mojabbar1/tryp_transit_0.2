"""Request dependencies shared by the read API's endpoints: a read-only connection, and the clock."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Connection


def _connection(request: Request) -> Iterator[Connection]:
    with request.app.state.engine.connect() as connection:
        yield connection


def clock() -> datetime:
    """The current time; tests override this dependency to fix "now"."""
    return datetime.now(UTC)


DB = Annotated[Connection, Depends(_connection)]
Now = Annotated[datetime, Depends(clock)]
