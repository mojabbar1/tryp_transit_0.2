"""GTFS-realtime service alerts (P3.7): the append-only ``service_alert`` table and its current view.

The alerts feed is a full snapshot, so ``current_service_alert`` is the alerts in the source's latest
successful run, not the latest row per alert id: an alert that has ended is gone from the next snapshot, and
must not linger. Rolling back that run makes the previous snapshot current again.

Revision ID: 0004_gtfs_rt_alerts
Revises: 0003_ntd_monthly
"""

from __future__ import annotations

from alembic import op

from tda.store.observations import drop_observation_table_ddl, observation_table_ddl

revision = "0004_gtfs_rt_alerts"
down_revision = "0003_ntd_monthly"
branch_labels = None
depends_on = None

# Third-party alert text is untrusted (02 §7.3): stored as data, never interpreted. The JSON columns hold
# the feed's translations and selectors as parsed, nothing derived from the text.
COLUMNS = [
    "alert_id text NOT NULL",
    "cause text",
    "effect text",
    "severity_level text",
    "active_from timestamptz",
    "active_until timestamptz",
    "active_periods jsonb NOT NULL",
    "informed_entities jsonb NOT NULL",
    "header_text jsonb NOT NULL",
    "description_text jsonb NOT NULL",
    "url jsonb NOT NULL",
    "CHECK (active_from IS NULL OR active_until IS NULL OR active_from <= active_until)",
]

SNAPSHOT_VIEW = """
    CREATE OR REPLACE VIEW tda.current_service_alert AS
      SELECT a.*
      FROM tda.service_alert a
      JOIN (
        SELECT DISTINCT ON (source_id) id FROM tda.fetch_run
        WHERE status = 'success'
        ORDER BY source_id, finished_at DESC, id DESC
      ) latest ON latest.id = a.fetch_run_id
"""


def upgrade() -> None:
    # observation_table_ddl adds the append-only guards and grants (the reader gets the current view only);
    # the view is then redefined with the same columns as the snapshot above.
    for statement in observation_table_ddl("service_alert", COLUMNS, ["alert_id"]):
        op.execute(statement)
    op.execute(SNAPSHOT_VIEW)


def downgrade() -> None:
    for statement in drop_observation_table_ddl("service_alert"):
        op.execute(statement)
