"""The HITL review queue (02 §7.4, D-8): submit, approve, reject, list, show.

- An item is decided once: ``pending`` -> ``approved`` | ``rejected`` (the table's guard enforces it too).
- A ``fact`` item moves its fact (see ``tda.facts.versions``): approval sets ``reviewed_by``/``reviewed_at``
  and supersedes the key's other published versions.
- **Sources are approved only by a PR to ``sources.yaml``.** Approving a ``source`` item only writes a
  suggested entry to ``proposals/sources/<id>.yaml``; nothing is enabled.
- ``report`` and ``campaign`` items are decided here; publishing them comes later (P5/P6).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import yaml
from sqlalchemy import Connection, text

from tda.config.models import Source
from tda.facts.versions import FactStateError, approve_fact, reject_fact

Kind = Literal["source", "fact", "report", "campaign"]
KINDS: tuple[Kind, ...] = ("source", "fact", "report", "campaign")


class ReviewError(Exception):
    """The request breaks the review state machine; the message says why."""


@dataclass(frozen=True)
class ReviewItem:
    """One queue entry."""

    id: int
    kind: str
    ref_id: str
    payload: dict[str, Any]
    status: str
    requested_by: str
    decided_by: str | None
    decided_at: datetime | None
    notes: str | None
    created_at: datetime


_SELECT = (
    "SELECT id, kind, ref_id, payload, status, requested_by, decided_by, decided_at, notes, created_at "
    "FROM tda.review_item"
)


def submit(
    connection: Connection, kind: Kind, ref_id: str, requested_by: str, payload: dict[str, Any] | None = None
) -> int:
    """Queue an item for review. A fact must be reviewable; a source proposal must be a valid entry."""
    if kind not in KINDS:
        raise ReviewError(f"unknown kind {kind!r}")
    payload = payload or {}
    if kind == "fact":
        if not ref_id.isdigit():
            raise ReviewError(f"a fact item's ref_id is the fact id, not {ref_id!r}")
        status = connection.execute(
            text("SELECT status FROM tda.fact WHERE id = CAST(:i AS bigint)"), {"i": ref_id}
        ).scalar_one_or_none()
        if status not in ("candidate", "needs_review"):
            raise ReviewError(
                f"fact #{ref_id} is {status or 'missing'}; only candidate or needs_review is reviewed"
            )
    if kind == "source":
        proposal = Source.model_validate({**payload, "status": "proposed"})
        if proposal.id != ref_id:
            raise ReviewError(f"the proposal is for {proposal.id}, not {ref_id}")
    duplicate = connection.execute(
        text("SELECT id FROM tda.review_item WHERE kind = :k AND ref_id = :r AND status = 'pending'"),
        {"k": kind, "r": ref_id},
    ).scalar_one_or_none()
    if duplicate is not None:
        raise ReviewError(f"{kind} {ref_id} already has pending item #{duplicate}")
    return connection.execute(
        text(
            "INSERT INTO tda.review_item (kind, ref_id, payload, status, requested_by) "
            "VALUES (:k, :r, CAST(:p AS jsonb), 'pending', :by) RETURNING id"
        ),
        {"k": kind, "r": ref_id, "p": json.dumps(payload, default=str), "by": requested_by},
    ).scalar_one()


def approve(
    connection: Connection, item_id: int, decided_by: str, *, proposals_dir: Path, notes: str | None = None
) -> ReviewItem:
    """Approve a pending item and apply its effect (see the module docstring)."""
    item = _pending(connection, item_id)
    proposal = _proposal_path(proposals_dir, item) if item.kind == "source" else None
    if item.kind == "fact":
        _move_fact(approve_fact, connection, item, decided_by)
    _decide(connection, item_id, "approved", decided_by, notes)
    if proposal is not None:
        _write_proposal(proposal, item, decided_by)
    return show(connection, item_id)


def reject(connection: Connection, item_id: int, decided_by: str, *, notes: str) -> ReviewItem:
    """Reject a pending item; a reason is required. A fact item's fact becomes ``rejected``."""
    if not notes.strip():
        raise ReviewError("a rejection needs a reason (notes)")
    item = _pending(connection, item_id)
    if item.kind == "fact":
        _move_fact(reject_fact, connection, item, decided_by)
    _decide(connection, item_id, "rejected", decided_by, notes)
    return show(connection, item_id)


def list_items(
    connection: Connection, *, status: str | None = "pending", kind: str | None = None
) -> list[ReviewItem]:
    """Items, oldest first; ``status=None`` lists every status."""
    rows = connection.execute(
        text(
            f"{_SELECT} WHERE (CAST(:s AS text) IS NULL OR status = :s) "  # noqa: S608
            "AND (CAST(:k AS text) IS NULL OR kind = :k) ORDER BY id"
        ),
        {"s": status, "k": kind},
    )
    return [ReviewItem(*row) for row in rows]


def show(connection: Connection, item_id: int) -> ReviewItem:
    """One item by id."""
    row = connection.execute(text(f"{_SELECT} WHERE id = :i"), {"i": item_id}).one_or_none()  # noqa: S608
    if row is None:
        raise ReviewError(f"no review item #{item_id}")
    return ReviewItem(*row)


def to_markdown(items: list[ReviewItem]) -> str:
    """A table for pasting into a PR (the D-8 review surface)."""
    lines = [
        "| # | Kind | Ref | Status | Requested by | Decided by | Notes |",
        "|---|---|---|---|---|---|---|",
    ]
    for item in items:
        cells = [
            str(item.id),
            item.kind,
            item.ref_id,
            item.status,
            item.requested_by,
            item.decided_by,
            item.notes,
        ]
        lines.append("| " + " | ".join(_cell(c) for c in cells) + " |")
    return "\n".join(lines) + "\n"


def _cell(value: str | None) -> str:
    return (value or "").replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _pending(connection: Connection, item_id: int) -> ReviewItem:
    connection.execute(text("SELECT 1 FROM tda.review_item WHERE id = :i FOR UPDATE"), {"i": item_id})
    item = show(connection, item_id)
    if item.status != "pending":
        raise ReviewError(f"item #{item_id} is already {item.status}")
    return item


def _move_fact(move: Any, connection: Connection, item: ReviewItem, reviewer: str) -> None:
    try:
        move(connection, int(item.ref_id), reviewer)
    except FactStateError as error:
        raise ReviewError(str(error)) from None


def _decide(connection: Connection, item_id: int, status: str, decided_by: str, notes: str | None) -> None:
    connection.execute(
        text(
            "UPDATE tda.review_item SET status = :s, decided_by = :by, decided_at = now(), notes = :n "
            "WHERE id = :i"
        ),
        {"i": item_id, "s": status, "by": decided_by, "n": notes},
    )


def _proposal_path(proposals_dir: Path, item: ReviewItem) -> Path:
    path = (
        proposals_dir / "sources" / f"{Source.model_validate({**item.payload, 'status': 'proposed'}).id}.yaml"
    )
    if path.exists():
        raise ReviewError(f"{path} already exists; merge or remove it before approving another proposal")
    return path


def _write_proposal(path: Path, item: ReviewItem, decided_by: str) -> None:
    proposal = Source.model_validate({**item.payload, "status": "proposed"})
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = proposal.model_dump(mode="json", exclude_none=True, exclude_defaults=False)
    header = (
        f"# Suggested sources.yaml entry for {proposal.id}\n"
        f"# (review item #{item.id}, approved by {decided_by}).\n"
        "# This file enables nothing. To add the source, copy the entry into tda/config/sources.yaml\n"
        "# in a PR; the terms review (03 §2.4) and `status: approved` happen in that PR.\n"
    )
    path.write_text(header + yaml.safe_dump([entry], sort_keys=False, allow_unicode=True), encoding="utf-8")
