"""GTFS fares v1 (P4b real-data pilot): ``fare_attributes.txt`` and ``fare_rules.txt``, and their active views.

CARTA's real feed prices routes differently (fixed route $2.00, Express $3.50, DASH and other free routes $0.00), so
one base fare can't stand for every trip. These two append-only tables keep each feed version's fares, and the
``active_gtfs_fare_*`` views expose the active feed's fares to the read API (``/v1/compare`` reports a trip's
route fare). A feed version loaded before this migration simply has no fare rows.

Revision ID: 0007_gtfs_fares
Revises: 0006_metrics_api
"""

from __future__ import annotations

from alembic import op

from tda.store.observations import drop_observation_table_ddl, observation_table_ddl

revision = "0007_gtfs_fares"
down_revision = "0006_metrics_api"
branch_labels = None
depends_on = None

FEED = "feed_version_id bigint NOT NULL REFERENCES tda.gtfs_feed_version(id)"

TABLES: list[tuple[str, list[str], list[str]]] = [
    (
        "gtfs_fare_attribute",
        [
            FEED,
            "fare_id text NOT NULL",
            "price numeric NOT NULL CHECK (price >= 0)",
            "currency_type text NOT NULL",
            "payment_method smallint NOT NULL CHECK (payment_method IN (0, 1))",
            # Empty in GTFS means unlimited transfers, so NULL is meaningful here.
            "transfers smallint CHECK (transfers IN (0, 1, 2))",
            "agency_id text",
            "transfer_duration integer CHECK (transfer_duration >= 0)",
        ],
        ["feed_version_id", "fare_id"],
    ),
    (
        "gtfs_fare_rule",
        [
            FEED,
            "fare_id text NOT NULL",
            "route_id text",
            "origin_id text",
            "destination_id text",
            "contains_id text",
        ],
        ["feed_version_id", "fare_id", "route_id", "origin_id", "destination_id", "contains_id"],
    ),
]

ACTIVE = """
    CREATE VIEW tda.active_{table} AS
      SELECT f.source_id, c.*
      FROM tda.{table} c
      JOIN tda.active_gtfs_feed f ON f.feed_version_id = c.feed_version_id AND f.fetch_run_id = c.fetch_run_id
"""


def upgrade() -> None:
    for table, columns, natural_key in TABLES:
        for statement in observation_table_ddl(table, columns, natural_key):
            op.execute(statement)
        op.execute(ACTIVE.format(table=table))
        op.execute(f"GRANT SELECT ON tda.active_{table} TO tda_writer, tda_reader")


def downgrade() -> None:
    for table, _, _ in reversed(TABLES):
        op.execute(f"DROP VIEW tda.active_{table}")
        for statement in drop_observation_table_ddl(table):
            op.execute(statement)
