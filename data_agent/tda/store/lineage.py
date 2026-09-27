"""How publishers coordinate with rollback through the runs their data came from (02 §7.4, REV-07).

Rollback holds ``FOR UPDATE`` on the run it rolls back. Anything that publishes derived data (approving
or auto-publishing a fact, recording a metric) first takes ``FOR SHARE`` on every input run, in id order,
and refuses an input that isn't a ``success``. The two conflict, so whichever commits first wins and the
other sees its result:
- a rollback that waited sees the newly published fact or metric, and flags or recomputes it;
- a publisher that waited sees ``rolled_back`` and refuses.
Publishers take these locks before any fact row lock, so the two can't deadlock.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import Connection, text


class LineageError(Exception):
    """An input run is missing or isn't a ``success`` (for example, it was rolled back)."""


def lock_input_runs(connection: Connection, run_ids: Iterable[int]) -> None:
    """``FOR SHARE`` on every input run (id order), or :class:`LineageError` if one is not a ``success``."""
    ids = sorted(set(run_ids))
    if not ids:
        return
    rows = connection.execute(
        text("SELECT id, status FROM tda.fetch_run WHERE id = ANY(:ids) ORDER BY id FOR SHARE"), {"ids": ids}
    ).all()
    found = {row.id: row.status for row in rows}
    missing = [i for i in ids if i not in found]
    unusable = {i: s for i, s in found.items() if s != "success"}
    if missing or unusable:
        details = [f"run {i} is missing" for i in missing] + [
            f"run {i} is {s}" for i, s in sorted(unusable.items())
        ]
        raise LineageError("input runs must all be success: " + ", ".join(details))


def key_lock(connection: Connection, namespace: str, key: str) -> None:
    """A transaction-scoped advisory lock on ``namespace:key`` (released at commit or rollback)."""
    connection.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": f"tda.{namespace}:{key}"}
    )
