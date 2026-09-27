"""Mirror ``sources.yaml`` into ``tda.source`` (the YAML is the source of truth; 02 §6.1).

A source missing from the YAML is set ``disabled``, never deleted (the table refuses DELETE), so its runs keep
their foreign key and history.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import Connection, text

from tda.config.models import Source, SourceRegistry

_COLUMNS = (
    "id",
    "name",
    "kind",
    "url",
    "auth",
    "license",
    "terms_url",
    "robots_required",
    "store_policy",
    "cadence",
    "stale_after_hours",
    "status",
    "owner",
    "attribution_text",
    "allowed_hosts",
    "rate_limit_per_min",
)
_UPDATABLE = [c for c in _COLUMNS if c != "id"]
# Only the constant column names above are interpolated; every value is a bound parameter.
_UPSERT = text(
    f"INSERT INTO tda.source ({', '.join(_COLUMNS)}) VALUES ({', '.join(':' + c for c in _COLUMNS)}) "  # noqa: S608
    f"ON CONFLICT (id) DO UPDATE SET {', '.join(f'{c} = EXCLUDED.{c}' for c in _UPDATABLE)}, "
    "updated_at = now() "
    f"WHERE ({', '.join(f'tda.source.{c}' for c in _UPDATABLE)}) "
    f"IS DISTINCT FROM ({', '.join(f'EXCLUDED.{c}' for c in _UPDATABLE)}) "
    "RETURNING (xmax = 0) AS inserted"
)


@dataclass
class SyncReport:
    """What ``sync_sources`` changed."""

    inserted: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    disabled: list[str] = field(default_factory=list)


def _row(source: Source) -> dict[str, object]:
    row = source.model_dump(include=set(_COLUMNS))
    row["url"] = str(source.url) if source.url else None
    row["terms_url"] = str(source.terms_url) if source.terms_url else None
    return row


def upsert_source(connection: Connection, source: Source) -> str | None:
    """Insert or update one source row; returns ``"inserted"``, ``"updated"``, or None (unchanged)."""
    result = connection.execute(_UPSERT, _row(source)).scalar_one_or_none()
    if result is None:
        return None
    return "inserted" if result else "updated"


def sync_sources(connection: Connection, registry: SourceRegistry) -> SyncReport:
    """Make ``tda.source`` match the registry; sources no longer listed become ``disabled``."""
    report = SyncReport()
    for source in registry.sources:
        change = upsert_source(connection, source)
        if change == "inserted":
            report.inserted.append(source.id)
        elif change == "updated":
            report.updated.append(source.id)
    listed = [source.id for source in registry.sources]
    report.disabled = list(
        connection.execute(
            text(
                "UPDATE tda.source SET status = 'disabled', updated_at = now() "
                "WHERE status <> 'disabled' AND NOT (id = ANY(:listed)) RETURNING id"
            ),
            {"listed": listed},
        ).scalars()
    )
    return report
