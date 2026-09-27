"""DDL helpers for append-only observation tables and their ``current_<table>`` views (02 §6.0).

P3 connector migrations call these so every observation table gets the same invariants:
- rows are keyed by (natural key, ``content_hash``, ``fetch_run_id``); never updated, deleted, or truncated;
- ``current_<table>`` returns, per natural key, the row from the latest ``success`` run (a ``rolled_back`` run
  drops out, so the previous observation is current again);
- the writer may insert, and only the current view is granted to the reader.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

_IDENT = re.compile(r"^[a-z][a-z0-9_]*$")


def _ident(name: str) -> str:
    if not _IDENT.match(name):
        raise ValueError(f"not a safe SQL identifier: {name!r}")
    return name


def observation_table_ddl(table: str, columns: Sequence[str], natural_key: Sequence[str]) -> list[str]:
    """Statements that create ``tda.<table>``, its guard trigger, ``tda.current_<table>``, and grants.

    ``columns`` are column definitions (for example ``"station_id text NOT NULL"``); ``natural_key`` names
    the columns that identify one observed thing across runs.
    """
    table = _ident(table)
    keys = [_ident(k) for k in natural_key]
    if not keys:
        raise ValueError("an observation table needs a natural key")
    key_list = ", ".join(keys)
    ordered = ", ".join(f"o.{k}" for k in keys)
    body = ",\n  ".join(
        [*columns, "content_hash text NOT NULL", "fetch_run_id bigint NOT NULL REFERENCES tda.fetch_run(id)"]
    )
    return [
        f"CREATE TABLE tda.{table} (\n  id bigserial PRIMARY KEY,\n  {body},\n"
        f"  UNIQUE ({key_list}, content_hash, fetch_run_id)\n)",
        f"CREATE INDEX {table}_run ON tda.{table} (fetch_run_id)",
        f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON tda.{table} "
        "FOR EACH ROW EXECUTE FUNCTION tda.forbid_mutation()",
        f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON tda.{table} "
        "FOR EACH STATEMENT EXECUTE FUNCTION tda.forbid_mutation()",
        # Every interpolated name passed _ident() above.
        f"CREATE VIEW tda.current_{table} AS\n"  # noqa: S608
        f"  SELECT DISTINCT ON ({ordered}) o.*\n"
        f"  FROM tda.{table} o JOIN tda.fetch_run r ON r.id = o.fetch_run_id\n"
        "  WHERE r.status = 'success'\n"
        f"  ORDER BY {ordered}, r.finished_at DESC, r.id DESC",
        f"GRANT SELECT, INSERT ON tda.{table} TO tda_writer",
        f"GRANT USAGE, SELECT ON SEQUENCE tda.{table}_id_seq TO tda_writer",
        f"GRANT SELECT ON tda.current_{table} TO tda_writer, tda_reader",
    ]


def drop_observation_table_ddl(table: str) -> list[str]:
    """The reverse of :func:`observation_table_ddl`, for ``downgrade()``."""
    table = _ident(table)
    return [f"DROP VIEW tda.current_{table}", f"DROP TABLE tda.{table}"]
