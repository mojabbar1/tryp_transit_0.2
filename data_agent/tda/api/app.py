"""The read API (P2 T8). It connects as ``tda_reader`` in read-only sessions and serves approved data only."""

from __future__ import annotations

import base64
import binascii
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from tda import __version__
from tda.api import citable, transit
from tda.api.citable import FACT_COLUMNS, fact_outs
from tda.api.deps import DB
from tda.api.schemas import (
    AlertPage,
    AssumptionsOut,
    CompareOut,
    FactPage,
    Health,
    NearbyStopPage,
    SourceFreshness,
    SourceOut,
    StatsOut,
    StopPage,
)
from tda.config.settings import Settings, get_settings
from tda.store.db import reader_engine

MAX_LIMIT = 500


def create_app(engine: Engine | None = None, settings: Settings | None = None) -> FastAPI:
    """Build the app. Without ``engine`` it connects at startup with ``TDA_READER_DATABASE_URL``."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        owned = app.state.engine is None
        if owned:
            app.state.engine = _read_only(reader_engine(settings or get_settings()))
        yield
        if owned:
            app.state.engine.dispose()

    app = FastAPI(
        title="Tryp Transit data agent",
        version=__version__,
        description="Read-only API over approved sources and facts, plus source freshness (see 02 §6).",
        lifespan=lifespan,
    )
    app.state.engine = _read_only(engine) if engine is not None else None
    app.get("/v1/health", response_model=Health, tags=["health"])(health)
    app.get("/v1/sources", response_model=list[SourceOut], tags=["sources"])(sources)
    app.get("/v1/facts", response_model=FactPage, tags=["facts"])(facts)
    # P4a: only endpoints whose connector is merged (3.1 GTFS, 3.2 NTD, 3.5 reference facts, 3.7 alerts).
    # Nothing for 3.3 or 3.6 (mode share, corridors), and no /v1/series/* (P6): those paths are 404, not
    # empty stubs.
    no_feed = {503: {"description": "No approved GTFS source has an active feed."}}
    app.get("/v1/stops", response_model=StopPage, tags=["transit"], responses=no_feed)(transit.stops)
    app.get("/v1/stops/nearest", response_model=NearbyStopPage, tags=["transit"], responses=no_feed)(
        transit.nearest
    )
    app.get(
        "/v1/compare",
        response_model=CompareOut,
        tags=["transit"],
        responses={
            503: {"description": "No active GTFS feed, or no approved transit.access_buffer_min fact."}
        },
    )(transit.compare_trips)
    app.get("/v1/alerts", response_model=AlertPage, tags=["transit"])(transit.alerts)
    app.get("/v1/assumptions", response_model=AssumptionsOut, tags=["facts"])(citable.assumptions)
    app.get("/v1/stats", response_model=StatsOut, tags=["facts"])(citable.stats)
    return app


def _read_only(engine: Engine) -> Engine:
    """Every session is READ ONLY on top of the reader role's grants (defense in depth)."""
    return engine.execution_options(postgresql_readonly=True)


def health(request: Request) -> Health | JSONResponse:
    """Database ping plus per-source freshness from the ``source_freshness`` view."""
    try:
        with request.app.state.engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT source_id, source_status AS status, cadence, stale_after_hours, last_success, "
                    "last_status, stale FROM tda.source_freshness ORDER BY source_id"
                )
            ).mappings()
            freshness = [SourceFreshness.model_validate(dict(row)) for row in rows]
    except DBAPIError:
        body = Health(status="unavailable", database="unreachable", version=__version__, sources=[])
        return JSONResponse(status_code=503, content=body.model_dump(mode="json"))
    status = "degraded" if any(s.stale for s in freshness) else "ok"
    return Health(status=status, database="ok", version=__version__, sources=freshness)


def sources(connection: DB) -> list[SourceOut]:
    """Approved sources only, with their attribution text."""
    rows = connection.execute(
        text(
            "SELECT id, name, kind, url, license, terms_url, attribution_text, cadence FROM tda.source "
            "WHERE status = 'approved' ORDER BY id"
        )
    ).mappings()
    return [SourceOut.model_validate(dict(row)) for row in rows]


def facts(
    connection: DB,
    key_prefix: Annotated[str | None, Query(max_length=200)] = None,
    geography: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 100,
    cursor: str | None = None,
) -> FactPage:
    """Current approved facts only, ordered by id; never candidate, rejected, needs_review, or superseded."""
    after = _decode_cursor(cursor) if cursor else 0
    prefix = None
    if key_prefix is not None:
        prefix = key_prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = connection.execute(
        text(
            f"SELECT {FACT_COLUMNS} FROM tda.fact f "  # noqa: S608  (fixed columns)
            "WHERE f.status = 'approved' AND f.id > :after "
            "AND NOT EXISTS (SELECT 1 FROM tda.fact n WHERE n.key = f.key AND n.version > f.version "
            "AND n.status = 'approved') "
            "AND (CAST(:prefix AS text) IS NULL OR f.key LIKE :prefix ESCAPE '\\') "
            "AND (CAST(:geo AS text) IS NULL OR f.geography = :geo) "
            "ORDER BY f.id LIMIT :limit"
        ),
        {"after": after, "prefix": prefix, "geo": geography, "limit": limit + 1},
    ).all()
    page, more = rows[:limit], len(rows) > limit
    items = fact_outs(connection, page)
    return FactPage(items=items, next_cursor=_encode_cursor(page[-1].id) if more else None)


def _encode_cursor(fact_id: int) -> str:
    return base64.urlsafe_b64encode(f"after:{fact_id}".encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> int:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="invalid cursor") from None
    label, _, value = raw.partition(":")
    if label != "after" or not value.isdigit():
        raise HTTPException(status_code=400, detail="invalid cursor")
    return int(value)
