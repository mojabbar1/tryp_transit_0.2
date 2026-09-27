"""The read API (P2 T8). It connects as ``tda_reader`` in read-only sessions and serves approved data only."""

from __future__ import annotations

import base64
import binascii
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from datetime import UTC
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import DBAPIError

from tda import __version__
from tda.api.schemas import FactOut, FactPage, FactSource, Health, Period, SourceFreshness, SourceOut
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
    return app


def _read_only(engine: Engine) -> Engine:
    """Every session is READ ONLY on top of the reader role's grants (defense in depth)."""
    return engine.execution_options(postgresql_readonly=True)


def _connection(request: Request) -> Iterator[Connection]:
    with request.app.state.engine.connect() as connection:
        yield connection


DB = Annotated[Connection, Depends(_connection)]


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
            "SELECT f.id, f.key, f.version, f.supersedes_id, f.value_num, f.value_text, f.unit, f.geography, "
            "f.period_start, f.period_end, f.method, f.source_ids, f.derived_from, f.evidence, f.status, "
            "f.confidence, f.valid_until FROM tda.fact f "
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
    cited = sorted({source_id for row in page for source_id in row.source_ids})
    attribution = {
        row.id: row.attribution_text
        for row in connection.execute(
            text("SELECT id, attribution_text FROM tda.source WHERE id = ANY(:ids)"), {"ids": cited}
        )
    }
    retrieved = {
        (row.fact_id, row.source_id): row.retrieved_at.astimezone(UTC).date()
        for row in connection.execute(
            text(
                "SELECT fact_id, source_id, retrieved_at FROM tda.fact_source_retrieval "
                "WHERE fact_id = ANY(:ids)"
            ),
            {"ids": [row.id for row in page]},
        )
    }
    items = [
        FactOut(
            id=row.id,
            key=row.key,
            version=row.version,
            supersedes_id=row.supersedes_id,
            value_num=row.value_num,
            value_text=row.value_text,
            unit=row.unit,
            geography=row.geography,
            period=Period(start=row.period_start, end=row.period_end),
            method=row.method,
            sources=[
                FactSource(source_id=s, attribution=attribution.get(s), retrieved=retrieved.get((row.id, s)))
                for s in row.source_ids
            ],
            derived_from=row.derived_from,
            evidence=row.evidence,
            status=row.status,
            confidence=row.confidence,
            valid_until=row.valid_until,
        )
        for row in page
    ]
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
