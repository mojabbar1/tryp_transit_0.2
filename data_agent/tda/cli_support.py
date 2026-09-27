"""Shared CLI plumbing: logging, and clean exits (code 2) instead of tracebacks for expected errors."""

from __future__ import annotations

import functools
import getpass
import logging
import sys
from collections.abc import Callable
from typing import Any

import structlog
import typer
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from tda.connectors.base import RollbackRefused
from tda.facts.versions import FactStateError
from tda.review.queue import ReviewError
from tda.store.bootstrap import BootstrapError
from tda.store.db import MissingDatabaseURL
from tda.store.lineage import LineageError

EXPECTED = (
    MissingDatabaseURL,
    BootstrapError,
    ReviewError,
    RollbackRefused,
    FactStateError,
    LineageError,
    LookupError,
    FileNotFoundError,
    ValidationError,
    OperationalError,
)


def configure_logging(json_lines: bool) -> None:
    """Structured logs on stderr (stdout stays for command output): JSON in containers, console otherwise."""
    renderer = (
        structlog.processors.JSONRenderer() if json_lines else structlog.dev.ConsoleRenderer(colors=False)
    )
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        # Look stderr up per logger, never bind the stream at configure time (it may be swapped or closed).
        logger_factory=lambda *_: structlog.PrintLogger(file=sys.stderr),
        cache_logger_on_first_use=False,
    )


def cli_errors[F: Callable[..., Any]](fn: F) -> F:
    """Print ``error: ...`` and exit 2 for expected failures (bad config, refused transitions, DB down)."""

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except EXPECTED as error:
            message = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
            if isinstance(error, ValidationError):
                message = _validation_summary(error)
            elif isinstance(error, OperationalError):
                message = f"database unreachable: {message}"
            typer.secho(f"error: {message}", err=True, fg="red")
            raise typer.Exit(2) from None

    return wrapper  # type: ignore[return-value]


def _validation_summary(error: ValidationError, limit: int = 5) -> str:
    """Every reason on one line, e.g. ``sources.3: Value error, source x: html ... robots_required``."""
    details = error.errors(include_url=False, include_input=False)
    parts = [f"{'.'.join(str(p) for p in d['loc']) or error.title}: {d['msg']}" for d in details[:limit]]
    more = f" (+{len(details) - limit} more)" if len(details) > limit else ""
    return f"invalid {error.title}: " + "; ".join(parts) + more


def whoami() -> str:
    """The default reviewer name for review decisions."""
    return getpass.getuser()
