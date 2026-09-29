"""P4a: reader views over the active GTFS feed of each approved source, and over approved sources' alerts.

``active_gtfs_feed`` is the active version (``current_gtfs_feed_version``) of every **approved** GTFS source.
The ``active_gtfs_<table>`` views return that version's rows. A feed version's rows all come from its own load
run, and ``current_gtfs_feed_version`` keeps only versions whose run is still a success, so these views need
no per-row ``DISTINCT ON``. That lets the schedule queries use the ``(feed_version_id, stop_id)`` index. Rolling
back the active version's run falls back to the previous activation, as the current views do.

``approved_service_alert`` is ``current_service_alert`` limited to approved sources, with its ``source_id``
(the reader can't read ``fetch_run`` itself).

Revision ID: 0006_metrics_api
Revises: 0005_eia_gas
"""

from __future__ import annotations

from alembic import op

revision = "0006_metrics_api"
down_revision = "0005_eia_gas"
branch_labels = None
depends_on = None

TABLES = ("gtfs_stop", "gtfs_route", "gtfs_trip", "gtfs_stop_time", "gtfs_calendar", "gtfs_calendar_date")
VIEWS = ("active_gtfs_feed", *(f"active_{t}" for t in TABLES), "approved_service_alert")

FEED = """
    CREATE VIEW tda.active_gtfs_feed AS
      SELECT v.source_id, v.id AS feed_version_id, v.fetch_run_id, v.feed_label, v.publisher, v.feed_start,
             v.feed_end, v.agency_timezone, v.loaded_at, v.activated_at
      FROM tda.current_gtfs_feed_version v
      JOIN tda.source s ON s.id = v.source_id
      WHERE v.is_active AND s.status = 'approved'
"""

CHILD = """
    CREATE VIEW tda.active_{table} AS
      SELECT f.source_id, c.*
      FROM tda.{table} c
      JOIN tda.active_gtfs_feed f ON f.feed_version_id = c.feed_version_id AND f.fetch_run_id = c.fetch_run_id
"""

ALERTS = """
    CREATE VIEW tda.approved_service_alert AS
      SELECT r.source_id, a.*
      FROM tda.current_service_alert a
      JOIN tda.fetch_run r ON r.id = a.fetch_run_id
      JOIN tda.source s ON s.id = r.source_id
      WHERE s.status = 'approved'
"""


def upgrade() -> None:
    op.execute(FEED)
    for table in TABLES:
        op.execute(CHILD.format(table=table))
    op.execute(ALERTS)
    op.execute(f"GRANT SELECT ON {', '.join(f'tda.{v}' for v in VIEWS)} TO tda_writer, tda_reader")


def downgrade() -> None:
    for view in reversed(VIEWS):
        op.execute(f"DROP VIEW tda.{view}")
