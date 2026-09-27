"""SQLAlchemy 2 models for schema ``tda`` (02 §6). The baseline migration is the DDL of record."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, MetaData, Numeric, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SCHEMA = "tda"


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA)


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class SourceRow(Base):
    """Mirror of one ``sources.yaml`` entry (the YAML is the source of truth)."""

    __tablename__ = "source"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)
    license: Mapped[str | None] = mapped_column(Text)
    terms_url: Mapped[str | None] = mapped_column(Text)
    robots_required: Mapped[bool] = mapped_column(Boolean)
    store_policy: Mapped[str] = mapped_column(Text)
    cadence: Mapped[str | None] = mapped_column(Text)
    stale_after_hours: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text)
    owner: Mapped[str] = mapped_column(Text)
    attribution_text: Mapped[str | None] = mapped_column(Text)
    allowed_hosts: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    rate_limit_per_min: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = _now()


class FetchRun(Base):
    """One acquisition attempt (HTTP or inbox). Never deleted; a finished run changes only to rolled_back."""

    __tablename__ = "fetch_run"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("source.id"))
    acquisition: Mapped[str] = mapped_column(Text)
    supplied_by: Mapped[str | None] = mapped_column(Text)
    original_url: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = _now()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text)
    http_status: Mapped[int | None] = mapped_column(Integer)
    bytes: Mapped[int | None] = mapped_column(BigInteger)
    sha256: Mapped[str | None] = mapped_column(Text)
    raw_uri: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    etag: Mapped[str | None] = mapped_column(Text)
    last_modified: Mapped[str | None] = mapped_column(Text)


class Fact(Base):
    """The citable unit (02 §6.3). Immutable per version; only its status moves."""

    __tablename__ = "fact"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)
    supersedes_id: Mapped[int | None] = mapped_column(ForeignKey("fact.id"))
    derived_from: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    value_num: Mapped[Decimal | None] = mapped_column(Numeric)
    value_text: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(Text)
    geography: Mapped[str | None] = mapped_column(Text)
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    method: Mapped[str | None] = mapped_column(Text)
    source_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    confidence: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(Text)
    reviewed_by: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    valid_until: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = _now()


class MetricValue(Base):
    """A computed metric with lineage. Append-only; readers use ``current_metric_value``."""

    __tablename__ = "metric_value"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    metric_key: Mapped[str] = mapped_column(Text)
    dims: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    value: Mapped[Decimal | None] = mapped_column(Numeric)
    unit: Mapped[str | None] = mapped_column(Text)
    computed_at: Mapped[datetime] = _now()
    method_version: Mapped[str] = mapped_column(Text)
    input_run_ids: Mapped[list[int]] = mapped_column(ARRAY(BigInteger), server_default="{}")


class ReviewItem(Base):
    """One entry in the HITL queue (02 §7.4). Decided once; never deleted."""

    __tablename__ = "review_item"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    ref_id: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    status: Mapped[str] = mapped_column(Text)
    requested_by: Mapped[str] = mapped_column(Text)
    decided_by: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()


class AgentRun(Base):
    """Audit and cost record for an agent task (filled from P5)."""

    __tablename__ = "agent_run"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    task: Mapped[str] = mapped_column(Text)
    provider: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    prompt_version: Mapped[str | None] = mapped_column(Text)
    tools_called: Mapped[list[Any]] = mapped_column(JSONB, server_default="[]")
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    status: Mapped[str] = mapped_column(Text)
    guardrail_violations: Mapped[list[Any]] = mapped_column(JSONB, server_default="[]")
    output_ref: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = _now()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
