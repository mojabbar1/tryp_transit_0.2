"""Response models for the read API. The committed OpenAPI snapshot (contracts/) is generated from these."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, PlainSerializer

# JSON has no decimal type: facts carry exact numerics in Postgres and are served as JSON numbers (02 §6.3).
JsonNumber = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


class SourceFreshness(BaseModel):
    """One row of the ``source_freshness`` view: the reader's only view of ingestion status."""

    source_id: str
    status: str
    cadence: str | None
    stale_after_hours: int | None
    last_success: datetime | None
    last_status: str | None
    stale: bool


class Health(BaseModel):
    """``ok``: the database answers and no approved source is stale; ``degraded``: one is stale."""

    status: Literal["ok", "degraded", "unavailable"]
    database: Literal["ok", "unreachable"]
    version: str
    sources: list[SourceFreshness]


class SourceOut(BaseModel):
    """An approved source's public fields, with the attribution clients must show."""

    id: str
    name: str
    kind: str
    url: str | None
    license: str | None
    terms_url: str | None
    attribution_text: str | None
    cadence: str | None


class Period(BaseModel):
    start: date | None
    end: date | None


class FactSource(BaseModel):
    source_id: str
    attribution: str | None


class FactOut(BaseModel):
    """A citable fact: the current approved version of its key (02 §6.3)."""

    id: int
    key: str
    version: int
    supersedes_id: int | None
    value_num: JsonNumber | None
    value_text: str | None
    unit: str | None
    geography: str | None
    period: Period
    method: str | None
    sources: list[FactSource]
    derived_from: dict[str, Any]
    evidence: dict[str, Any]
    status: Literal["approved"]
    confidence: str | None
    valid_until: date | None


class FactPage(BaseModel):
    """One page of facts; pass ``next_cursor`` back as ``cursor`` for the next page."""

    items: list[FactOut]
    next_cursor: str | None
