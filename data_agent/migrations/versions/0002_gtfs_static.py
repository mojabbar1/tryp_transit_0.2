"""GTFS static (P3.1): feed versions, activations, and the seven GTFS observation tables.

Revision ID: 0002_gtfs_static
Revises: 0001_baseline
"""

from __future__ import annotations

from alembic import op

from tda.store.observations import drop_observation_table_ddl, observation_table_ddl

revision = "0002_gtfs_static"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

FEED = "feed_version_id bigint NOT NULL REFERENCES tda.gtfs_feed_version(id)"

# (table, columns, natural key). Every natural key includes the feed version, so versions never collide.
CHILD_TABLES: list[tuple[str, list[str], list[str]]] = [
    (
        "gtfs_stop",
        [
            FEED,
            "stop_id text NOT NULL",
            "stop_code text",
            "stop_name text",
            "stop_lat double precision CHECK (stop_lat BETWEEN -90 AND 90)",
            "stop_lon double precision CHECK (stop_lon BETWEEN -180 AND 180)",
            "zone_id text",
            # GTFS: coordinates are required except for generic nodes (3) and boarding areas (4).
            "location_type smallint CHECK (location_type BETWEEN 0 AND 4)",
            "CHECK (location_type IN (3, 4) OR (stop_lat IS NOT NULL AND stop_lon IS NOT NULL))",
            "parent_station text",
            "wheelchair_boarding smallint",
        ],
        ["feed_version_id", "stop_id"],
    ),
    (
        "gtfs_route",
        [
            FEED,
            "route_id text NOT NULL",
            "agency_id text",
            "route_short_name text",
            "route_long_name text",
            "route_type integer NOT NULL",
            "route_color text",
            "route_text_color text",
        ],
        ["feed_version_id", "route_id"],
    ),
    (
        "gtfs_trip",
        [
            FEED,
            "trip_id text NOT NULL",
            "route_id text NOT NULL",
            "service_id text NOT NULL",
            "trip_headsign text",
            "direction_id smallint",
            "block_id text",
            "shape_id text",
        ],
        ["feed_version_id", "trip_id"],
    ),
    (
        "gtfs_stop_time",
        [
            FEED,
            "trip_id text NOT NULL",
            "stop_sequence integer NOT NULL CHECK (stop_sequence >= 0)",
            "stop_id text NOT NULL",
            "arrival_time text",
            "departure_time text",
            # Seconds after midnight of the service day; GTFS allows 24:00:00 and later.
            "arrival_s integer CHECK (arrival_s >= 0)",
            "departure_s integer CHECK (departure_s >= 0)",
            "pickup_type smallint",
            "drop_off_type smallint",
            "shape_dist_traveled double precision",
            "timepoint smallint",
        ],
        ["feed_version_id", "trip_id", "stop_sequence"],
    ),
    (
        "gtfs_calendar",
        [
            FEED,
            "service_id text NOT NULL",
            "monday boolean NOT NULL",
            "tuesday boolean NOT NULL",
            "wednesday boolean NOT NULL",
            "thursday boolean NOT NULL",
            "friday boolean NOT NULL",
            "saturday boolean NOT NULL",
            "sunday boolean NOT NULL",
            "start_date date NOT NULL",
            "end_date date NOT NULL",
        ],
        ["feed_version_id", "service_id"],
    ),
    (
        "gtfs_calendar_date",
        [
            FEED,
            "service_id text NOT NULL",
            "date date NOT NULL",
            "exception_type smallint NOT NULL CHECK (exception_type IN (1, 2))",
        ],
        ["feed_version_id", "service_id", "date"],
    ),
    (
        "gtfs_shape",
        [
            FEED,
            "shape_id text NOT NULL",
            "shape_pt_sequence integer NOT NULL CHECK (shape_pt_sequence >= 0)",
            "shape_pt_lat double precision NOT NULL CHECK (shape_pt_lat BETWEEN -90 AND 90)",
            "shape_pt_lon double precision NOT NULL CHECK (shape_pt_lon BETWEEN -180 AND 180)",
            "shape_dist_traveled double precision",
        ],
        ["feed_version_id", "shape_id", "shape_pt_sequence"],
    ),
]

APPEND_ONLY = [
    "CREATE TRIGGER {t}_append_only BEFORE UPDATE OR DELETE ON tda.{t} "
    "FOR EACH ROW EXECUTE FUNCTION tda.forbid_mutation()",
    "CREATE TRIGGER {t}_no_truncate BEFORE TRUNCATE ON tda.{t} "
    "FOR EACH STATEMENT EXECUTE FUNCTION tda.forbid_mutation()",
]

FEED_VERSION = [
    # One row per loaded feed (natural key: source + zip sha256). Append-only like every observation table.
    """
    CREATE TABLE tda.gtfs_feed_version (
      id bigserial PRIMARY KEY,
      source_id text NOT NULL REFERENCES tda.source(id),
      feed_sha256 text NOT NULL CHECK (feed_sha256 ~ '^[0-9a-f]{64}$'),
      feed_label text,
      publisher text,
      feed_start date NOT NULL,
      feed_end date NOT NULL,
      -- agency.txt agency_timezone: GTFS service days and times are in this zone (P4 needs it).
      agency_timezone text NOT NULL,
      loaded_at timestamptz NOT NULL DEFAULT now(),
      content_hash text NOT NULL,
      fetch_run_id bigint NOT NULL REFERENCES tda.fetch_run(id),
      CHECK (feed_start <= feed_end),
      UNIQUE (source_id, feed_sha256, content_hash, fetch_run_id),
      UNIQUE (source_id, id)
    )
    """,
    "CREATE INDEX gtfs_feed_version_run ON tda.gtfs_feed_version (fetch_run_id)",
    *(s.format(t="gtfs_feed_version") for s in APPEND_ONLY),
    # Activation is an append-only log, not a mutable flag: "flipping" a feed adds a row. The active feed is the
    # newest activation whose feed version is still valid, so rolling back a feed's run falls back automatically.
    # Activations are ordered by id, not time: activate() serializes them per source with a transaction-scoped
    # lock, so id order is commit order (now() would be each transaction's start time).
    """
    CREATE TABLE tda.gtfs_feed_activation (
      id bigserial PRIMARY KEY,
      source_id text NOT NULL,
      feed_version_id bigint NOT NULL,
      activated_at timestamptz NOT NULL DEFAULT now(),
      activated_by text NOT NULL CHECK (activated_by <> ''),
      FOREIGN KEY (source_id, feed_version_id) REFERENCES tda.gtfs_feed_version (source_id, id)
    )
    """,
    *(s.format(t="gtfs_feed_activation") for s in APPEND_ONLY),
    # Every version whose load run succeeded is current, including an earlier load of the same zip (A, B, then
    # A again is three versions), so any current version can be activated by its id.
    """
    CREATE VIEW tda.current_gtfs_feed_version AS
      WITH valid AS (
        SELECT v.*
        FROM tda.gtfs_feed_version v JOIN tda.fetch_run r ON r.id = v.fetch_run_id
        WHERE r.status = 'success'
      ),
      active AS (
        SELECT DISTINCT ON (a.source_id) a.source_id, a.feed_version_id, a.activated_at, a.activated_by
        FROM tda.gtfs_feed_activation a JOIN valid ON valid.id = a.feed_version_id
        ORDER BY a.source_id, a.id DESC
      )
      SELECT valid.*, active.feed_version_id IS NOT NULL AS is_active,
             active.activated_at, active.activated_by
      FROM valid LEFT JOIN active ON active.feed_version_id = valid.id
    """,
    "GRANT SELECT, INSERT ON tda.gtfs_feed_version, tda.gtfs_feed_activation TO tda_writer",
    "GRANT USAGE, SELECT ON SEQUENCE tda.gtfs_feed_version_id_seq, tda.gtfs_feed_activation_id_seq TO tda_writer",
    # API-exposed (P4 reads schedules): the reader gets the current views only, never the base tables.
    "GRANT SELECT ON tda.current_gtfs_feed_version TO tda_writer, tda_reader",
]


def upgrade() -> None:
    for statement in FEED_VERSION:
        op.execute(statement)
    for table, columns, natural_key in CHILD_TABLES:
        for statement in observation_table_ddl(table, columns, natural_key):
            op.execute(statement)
    # Departures from a stop, the main P4 schedule query.
    op.execute("CREATE INDEX gtfs_stop_time_stop ON tda.gtfs_stop_time (feed_version_id, stop_id)")


def downgrade() -> None:
    for table, _, _ in reversed(CHILD_TABLES):
        for statement in drop_observation_table_ddl(table):
            op.execute(statement)
    for statement in (
        "DROP VIEW tda.current_gtfs_feed_version",
        "DROP TABLE tda.gtfs_feed_activation",
        "DROP TABLE tda.gtfs_feed_version",
    ):
        op.execute(statement)
