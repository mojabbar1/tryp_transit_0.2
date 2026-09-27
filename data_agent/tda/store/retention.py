"""Retention (T4): the database says which snapshots are protected; the raw store deletes the rest.

Lineage convention: a fact lists every ``fetch_run`` it depends on, transitively (through metrics too), in
``derived_from.input_run_ids``. Snapshots of those runs are protected while the fact is or was published
(``approved``, ``needs_review``, ``superseded``), regardless of TTL (02 §7.4). Candidates and rejected facts
don't protect anything, so the TTL, which may be a licence limit, still applies to them.
"""

from __future__ import annotations

from sqlalchemy import Connection, text

from tda.config.models import Source
from tda.store.raw_store import RawStore, RetentionReport

PUBLISHED_FACT_STATUSES = ("approved", "needs_review", "superseded")


def protected_snapshots(connection: Connection, source_id: str) -> set[str]:
    """The ``raw_uri`` of every run of ``source_id`` that a published fact derives from."""
    rows = connection.execute(
        text(
            """
            SELECT DISTINCT r.raw_uri FROM tda.fetch_run r
            WHERE r.source_id = :source AND r.raw_uri IS NOT NULL AND EXISTS (
              SELECT 1 FROM tda.fact f
              WHERE f.status = ANY(:published)
                AND f.derived_from -> 'input_run_ids' @> to_jsonb(r.id)
            )
            """
        ),
        {"source": source_id, "published": list(PUBLISHED_FACT_STATUSES)},
    ).scalars()
    return set(rows)


def apply_retention(
    connection: Connection, store: RawStore, source: Source, *, dry_run: bool = False
) -> RetentionReport:
    """Enforce ``source.store_policy`` on its snapshots, keeping those cited by published facts."""
    return store.enforce_retention(
        source, protected=protected_snapshots(connection, source.id), dry_run=dry_run
    )
