"""Reference facts (P3.5): human-verified values from ``reference_facts.yaml``, loaded as ``candidate`` facts.

- The agent never fills in a number. The file ships with every value null, and a human enters each verified
  value together with its evidence.
- Data-quality checks: every filled entry has a source URL, a verbatim quote or a page, a retrieval date, and
  who verified it. Null entries are skipped. Keys are unique, and a cited ``source_id`` must exist in
  ``sources.yaml``.
- A loaded fact is a ``candidate`` with a pending review item. It becomes citable only after
  ``tda review approve``.
- Loading is idempotent: an entry whose content matches the key's latest version (in any status, including
  rejected) isn't queued again. A changed entry becomes a new version.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator
from sqlalchemy import Connection, text

from tda.config.models import SourceRegistry
from tda.facts.versions import FactDraft, write_fact
from tda.review.queue import submit
from tda.store.lineage import key_lock
from tda.store.sources import upsert_source

DEFAULT_FILE = Path(__file__).resolve().parent / "reference_facts.yaml"


class ReferenceEntry(BaseModel):
    """One ``facts:`` entry. ``value`` is a number; ``value_text`` is for decisions stated in words."""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(pattern=r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$")
    value: Decimal | None = None
    value_text: str | None = None
    unit: str | None = None
    source_id: str | None = None
    geography: str | None = None
    url: HttpUrl
    page: str | None = None
    quote: str | None = None
    retrieved_at: date | None = None
    verified_by: str | None = None
    period_start: date | None = None
    period_end: date | None = None
    note: str | None = None
    todo: str | None = None

    @field_validator(
        "value_text",
        "unit",
        "source_id",
        "geography",
        "page",
        "quote",
        "verified_by",
        "note",
        "todo",
        mode="before",
    )
    @classmethod
    def _blank_is_missing(cls, value: object) -> object:
        """Blank text is missing, so it can't satisfy an evidence rule; other text stays verbatim."""
        return None if isinstance(value, str) and not value.strip() else value

    @property
    def filled(self) -> bool:
        """Whether a human has entered a value."""
        return self.value is not None or self.value_text is not None

    @model_validator(mode="after")
    def _evidence(self) -> ReferenceEntry:
        if self.value is not None and self.value_text is not None:
            raise ValueError(f"{self.key}: set value or value_text, not both")
        if self.filled:
            missing = [
                name
                for name, present in (
                    ("quote or page", bool(self.quote or self.page)),
                    ("retrieved_at", self.retrieved_at is not None),
                    ("verified_by", bool(self.verified_by)),
                )
                if not present
            ]
            if missing:
                raise ValueError(f"{self.key}: a filled entry needs {', '.join(missing)}")
        if self.period_start and self.period_end and self.period_start > self.period_end:
            raise ValueError(f"{self.key}: period_start is after period_end")
        return self


class ReferenceFile(BaseModel):
    """The whole file."""

    model_config = ConfigDict(extra="forbid")

    facts: list[ReferenceEntry]

    @model_validator(mode="after")
    def _unique(self) -> ReferenceFile:
        keys = [entry.key for entry in self.facts]
        duplicates = sorted({k for k in keys if keys.count(k) > 1})
        if duplicates:
            raise ValueError(f"duplicate keys: {', '.join(duplicates)}")
        return self


@dataclass
class LoadReport:
    """What ``load_reference`` did."""

    loaded: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def read_reference(path: Path = DEFAULT_FILE) -> tuple[ReferenceFile, str]:
    """Parse and validate the file; returns it with its sha256."""
    raw = path.read_bytes()
    return ReferenceFile.model_validate(yaml.safe_load(raw) or {}), hashlib.sha256(raw).hexdigest()


def check_sources(reference: ReferenceFile, registry: SourceRegistry) -> None:
    """Every cited ``source_id`` exists in ``sources.yaml``."""
    known = {source.id for source in registry.sources}
    unknown = sorted({e.source_id for e in reference.facts if e.source_id and e.source_id not in known})
    if unknown:
        raise ValueError(f"unknown source_id in reference facts: {', '.join(unknown)}")


def load_reference(
    connection: Connection, registry: SourceRegistry, path: Path = DEFAULT_FILE, *, requested_by: str
) -> LoadReport:
    """Queue every filled entry that changed as a ``candidate`` fact with a pending review item.

    Each key's latest-content check, write, and queue submission happen under its fact lock, so two loads at
    once can't both queue the same change. All the locks come first, in key order, so they can't deadlock.
    """
    reference, digest = read_reference(path)
    check_sources(reference, registry)
    for key in sorted(entry.key for entry in reference.facts if entry.filled):
        key_lock(connection, "fact", key)
    report = LoadReport()
    for entry in reference.facts:
        if not entry.filled:
            report.skipped.append(entry.key)
            continue
        if entry.source_id:
            upsert_source(connection, registry.get(entry.source_id))
        draft = _draft(entry, digest, path)
        if _same_as_latest(connection, draft):
            report.unchanged.append(entry.key)
            continue
        fact_id = write_fact(connection, draft)
        submit(connection, "fact", str(fact_id), requested_by=requested_by)
        report.loaded.append(entry.key)
    return report


def _draft(entry: ReferenceEntry, digest: str, path: Path) -> FactDraft:
    evidence: dict[str, Any] = {
        "url": str(entry.url),
        "page": entry.page,
        "quote": entry.quote,
        "retrieved_at": entry.retrieved_at.isoformat() if entry.retrieved_at else None,
        "verified_by": entry.verified_by,
        "note": entry.note,
    }
    return FactDraft(
        key=entry.key,
        created_by="human",
        derived_from={"input_run_ids": [], "reference_file": path.name, "reference_sha256": digest},
        value_num=entry.value,
        value_text=entry.value_text,
        unit=entry.unit,
        geography=entry.geography,
        period_start=entry.period_start,
        period_end=entry.period_end,
        method=f"reference fact, verified by {entry.verified_by} ({path.name})",
        source_ids=[entry.source_id] if entry.source_id else [],
        evidence={k: v for k, v in evidence.items() if v is not None},
        confidence="human-verified",
    )


def _same_as_latest(connection: Connection, draft: FactDraft) -> bool:
    latest = connection.execute(
        text(
            "SELECT value_num, value_text, unit, geography, period_start, period_end, source_ids, evidence "
            "FROM tda.fact WHERE key = :k ORDER BY version DESC LIMIT 1"
        ),
        {"k": draft.key},
    ).one_or_none()
    if latest is None:
        return False
    return (
        latest.value_num == (Decimal(draft.value_num) if draft.value_num is not None else None)
        and latest.value_text == draft.value_text
        and (latest.unit, latest.geography, latest.period_start, latest.period_end)
        == (draft.unit, draft.geography, draft.period_start, draft.period_end)
        and list(latest.source_ids) == draft.source_ids
        and latest.evidence == draft.evidence
    )
