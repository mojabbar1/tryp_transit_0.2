"""Retention (T4): the database says which snapshots are protected; the raw store deletes the rest.

Lineage convention: a fact lists every ``fetch_run`` it depends on, transitively (through metrics too), in
``derived_from.input_run_ids``. Snapshots of those runs are protected, regardless of TTL (02 §7.4), for every
fact version that was **ever** published: ``fact.published_at`` is set by the database on first publication
and never cleared, so a later ``needs_review`` -> ``rejected`` keeps the evidence of what was published.
A fact that was never published protects nothing, so the TTL, which may be a licence limit, still applies.
"""

from __future__ import annotations

from sqlalchemy import Connection, text

from tda.config.models import Source
from tda.store.raw_store import RawStore, RetentionReport


def protected_snapshots(connection: Connection, source_id: str) -> set[str]:
    """The ``raw_uri`` of every run of ``source_id`` that an ever-published fact derives from."""
    rows = connection.execute(
        text(
            """
            SELECT DISTINCT r.raw_uri FROM tda.fetch_run r
            WHERE r.source_id = :source AND r.raw_uri IS NOT NULL AND EXISTS (
              SELECT 1 FROM tda.fact f
              WHERE f.published_at IS NOT NULL
                AND f.derived_from -> 'input_run_ids' @> to_jsonb(r.id)
            )
            """
        ),
        {"source": source_id},
    ).scalars()
    return set(rows)


def apply_retention(
    connection: Connection, store: RawStore, source: Source, *, dry_run: bool = False
) -> RetentionReport:
    """Enforce ``source.store_policy`` on its snapshots, keeping those cited by published facts."""
    return store.enforce_retention(
        source, protected=protected_snapshots(connection, source.id), dry_run=dry_run
    )
