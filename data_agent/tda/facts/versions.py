"""Fact versions (02 §6.3): a fact is never edited; a correction is a new version superseding the last.

One version per key is current: approving a version supersedes every other approved (or ``needs_review``)
version of that key, and an older version can't be approved over a newer approved one.

Concurrency: every version change takes a per-key advisory lock first, so the checks and the change happen
as one step (a partial unique index backs this up: one ``approved`` row per key). Publishing also locks the
fact's input runs (``tda.store.lineage``), so a concurrent rollback either sees the published fact or
blocks it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import Connection, text

from tda.store.lineage import LineageError, key_lock, lock_input_runs

CreatedBy = Literal["connector", "metric", "agent", "human"]
AUTO_PUBLISH_REVIEWER = "rule:auto_publish"


class FactStateError(Exception):
    """The fact can't make this transition (02 §7.4)."""


@dataclass(frozen=True)
class FactDraft:
    """The content of a new fact version. ``derived_from`` must list ``input_run_ids`` (lineage)."""

    key: str
    created_by: CreatedBy
    derived_from: dict[str, Any]
    value_num: Decimal | int | float | None = None
    value_text: str | None = None
    unit: str | None = None
    geography: str | None = None
    period_start: date | None = None
    period_end: date | None = None
    method: str | None = None
    source_ids: list[str] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    confidence: str | None = None
    valid_until: date | None = None

    def __post_init__(self) -> None:
        runs = self.derived_from.get("input_run_ids")
        if not isinstance(runs, list) or not all(isinstance(r, int) for r in runs):
            raise ValueError("derived_from.input_run_ids must be a list of fetch_run ids (it can be empty)")
        if self.value_num is None and self.value_text is None:
            raise ValueError("a fact needs value_num or value_text")


def write_fact(connection: Connection, draft: FactDraft, *, auto_publish: bool = False) -> int:
    """Insert the next version of ``draft.key``: ``candidate``, or ``approved`` when a rule auto-publishes."""
    key_lock(connection, "fact", draft.key)
    if auto_publish:
        _lock_inputs(connection, draft.key, draft.derived_from["input_run_ids"])
        _supersede_others(connection, draft.key, keep_id=None)
    latest = connection.execute(
        text("SELECT id, version FROM tda.fact WHERE key = :k ORDER BY version DESC LIMIT 1"),
        {"k": draft.key},
    ).one_or_none()
    fact_id = connection.execute(
        text(
            "INSERT INTO tda.fact (key, version, supersedes_id, derived_from, value_num, value_text, unit, "
            "geography, period_start, period_end, method, source_ids, evidence, confidence, status, "
            "created_by, reviewed_by, reviewed_at, valid_until) "
            "VALUES (:key, :version, :supersedes, CAST(:derived AS jsonb), :value_num, :value_text, :unit, "
            ":geography, :period_start, :period_end, :method, :source_ids, CAST(:evidence AS jsonb), "
            ":confidence, :status, :created_by, :reviewed_by, "
            "CASE WHEN CAST(:reviewed_by AS text) IS NULL THEN NULL ELSE now() END, :valid_until) "
            "RETURNING id"
        ),
        {
            "key": draft.key,
            "version": latest.version + 1 if latest else 1,
            "supersedes": latest.id if latest else None,
            "derived": json.dumps(draft.derived_from),
            "value_num": draft.value_num,
            "value_text": draft.value_text,
            "unit": draft.unit,
            "geography": draft.geography,
            "period_start": draft.period_start,
            "period_end": draft.period_end,
            "method": draft.method,
            "source_ids": draft.source_ids,
            "evidence": json.dumps(draft.evidence),
            "confidence": draft.confidence,
            "status": "approved" if auto_publish else "candidate",
            "created_by": draft.created_by,
            "reviewed_by": AUTO_PUBLISH_REVIEWER if auto_publish else None,
            "valid_until": draft.valid_until,
        },
    ).scalar_one()
    return fact_id


def approve_fact(connection: Connection, fact_id: int, reviewer: str) -> None:
    """``candidate`` or ``needs_review`` -> ``approved``; other versions of the key become ``superseded``."""
    fact = _locked(connection, fact_id, lock_inputs=True)
    if fact.status not in ("candidate", "needs_review"):
        raise FactStateError(
            f"fact #{fact_id} is {fact.status}; only candidate or needs_review can be approved"
        )
    newer = connection.execute(
        text(
            "SELECT max(version) FROM tda.fact WHERE key = :k AND version > :v "
            "AND status IN ('approved', 'needs_review')"
        ),
        {"k": fact.key, "v": fact.version},
    ).scalar_one()
    if newer is not None:
        raise FactStateError(
            f"{fact.key} v{newer} is newer and already published; v{fact.version} can't replace it"
        )
    _supersede_others(connection, fact.key, keep_id=fact_id)
    connection.execute(
        text("UPDATE tda.fact SET status = 'approved', reviewed_by = :r, reviewed_at = now() WHERE id = :i"),
        {"i": fact_id, "r": reviewer},
    )


def reject_fact(connection: Connection, fact_id: int, reviewer: str) -> None:
    """``candidate`` or ``needs_review`` -> ``rejected``."""
    fact = _locked(connection, fact_id)
    if fact.status not in ("candidate", "needs_review"):
        raise FactStateError(
            f"fact #{fact_id} is {fact.status}; only candidate or needs_review can be rejected"
        )
    connection.execute(
        text("UPDATE tda.fact SET status = 'rejected', reviewed_by = :r, reviewed_at = now() WHERE id = :i"),
        {"i": fact_id, "r": reviewer},
    )


def _locked(connection: Connection, fact_id: int, *, lock_inputs: bool = False) -> Any:
    """Per-key lock, then (for publishing) the input runs, then the fact row: always in that order."""
    key = connection.execute(
        text("SELECT key FROM tda.fact WHERE id = :i"), {"i": fact_id}
    ).scalar_one_or_none()
    if key is None:
        raise FactStateError(f"no fact #{fact_id}")
    key_lock(connection, "fact", key)
    if lock_inputs:
        derived = connection.execute(
            text("SELECT derived_from FROM tda.fact WHERE id = :i"), {"i": fact_id}
        ).scalar_one()
        runs = derived.get("input_run_ids", []) if isinstance(derived, dict) else []
        _lock_inputs(connection, key, [int(r) for r in runs])
    return connection.execute(
        text("SELECT id, key, version, status FROM tda.fact WHERE id = :i FOR UPDATE"), {"i": fact_id}
    ).one()


def _lock_inputs(connection: Connection, key: str, run_ids: list[int]) -> None:
    try:
        lock_input_runs(connection, run_ids)
    except LineageError as error:
        raise FactStateError(f"{key} can't be published: {error}") from None


def _supersede_others(connection: Connection, key: str, keep_id: int | None) -> None:
    connection.execute(
        text(
            "UPDATE tda.fact SET status = 'superseded' WHERE key = :k "
            "AND (CAST(:keep AS bigint) IS NULL OR id <> :keep) AND status IN ('approved', 'needs_review')"
        ),
        {"k": key, "keep": keep_id},
    )
