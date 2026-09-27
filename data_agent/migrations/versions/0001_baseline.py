"""Baseline schema: sources, runs, facts, metrics, the review queue, agent runs, guards, views, grants.

Revision ID: 0001_baseline
Revises:
"""

from __future__ import annotations

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

UPGRADE = [
    # Guards (02 §6.0): observations and metric values are append-only; a fact version is immutable.
    """
    CREATE FUNCTION tda.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'tda.%: % is not allowed (append-only)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
    END $$
    """,
    """
    CREATE TABLE tda.source (
      id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]*$'),
      name text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('gtfs','gtfs_rt','socrata','census','arcgis','rest','html','pdf','manual')),
      url text,
      auth text NOT NULL CHECK (auth IN ('none','free_key','api_key','agency','registration','paid')),
      license text,
      terms_url text,
      robots_required boolean NOT NULL,
      store_policy text NOT NULL CHECK (store_policy ~ '^(none|indefinite|ttl:[1-9][0-9]*d)$'),
      cadence text,
      stale_after_hours integer CHECK (stale_after_hours > 0),
      status text NOT NULL CHECK (status IN ('proposed','approved','disabled')),
      owner text NOT NULL,
      attribution_text text,
      allowed_hosts text[] NOT NULL DEFAULT '{}',
      rate_limit_per_min integer CHECK (rate_limit_per_min > 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (kind NOT IN ('html','pdf') OR robots_required)
    )
    """,
    "CREATE TRIGGER source_no_delete BEFORE DELETE ON tda.source FOR EACH ROW EXECUTE FUNCTION tda.forbid_mutation()",
    """
    CREATE TABLE tda.fetch_run (
      id bigserial PRIMARY KEY,
      source_id text NOT NULL REFERENCES tda.source(id),
      acquisition text NOT NULL CHECK (acquisition IN ('http','manual')),
      supplied_by text,
      original_url text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      status text NOT NULL CHECK (status IN ('running','success','not_modified','failed','skipped_robots',
                                             'skipped_budget','skipped_disabled','rolled_back')),
      http_status integer,
      bytes bigint CHECK (bytes >= 0),
      sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      raw_uri text,
      error text,
      etag text,
      last_modified text,
      CHECK (acquisition = 'http' OR supplied_by IS NOT NULL),
      CHECK (status = 'running' OR finished_at IS NOT NULL)
    )
    """,
    "CREATE INDEX fetch_run_source_started ON tda.fetch_run (source_id, started_at DESC)",
    """
    CREATE FUNCTION tda.fetch_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'tda.fetch_run: runs are never deleted' USING ERRCODE = 'restrict_violation';
      END IF;
      IF (NEW.id, NEW.source_id, NEW.acquisition, NEW.supplied_by, NEW.original_url, NEW.started_at)
         IS DISTINCT FROM (OLD.id, OLD.source_id, OLD.acquisition, OLD.supplied_by, OLD.original_url, OLD.started_at) THEN
        RAISE EXCEPTION 'tda.fetch_run: a run''s identity never changes' USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.status = 'running' AND NEW.status <> 'rolled_back' THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'success' AND NEW.status = 'rolled_back'
         AND (NEW.finished_at, NEW.http_status, NEW.bytes, NEW.sha256, NEW.raw_uri, NEW.error, NEW.etag, NEW.last_modified)
             IS NOT DISTINCT FROM
             (OLD.finished_at, OLD.http_status, OLD.bytes, OLD.sha256, OLD.raw_uri, OLD.error, OLD.etag, OLD.last_modified) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'tda.fetch_run: a finished run is immutable (only success -> rolled_back is allowed), got % -> %',
        OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END $$
    """,
    "CREATE TRIGGER fetch_run_guard BEFORE UPDATE OR DELETE ON tda.fetch_run FOR EACH ROW EXECUTE FUNCTION tda.fetch_run_guard()",
    """
    CREATE TABLE tda.fact (
      id bigserial PRIMARY KEY,
      key text NOT NULL,
      version integer NOT NULL CHECK (version >= 1),
      supersedes_id bigint REFERENCES tda.fact(id),
      derived_from jsonb NOT NULL DEFAULT '{}'::jsonb,
      value_num numeric,
      value_text text,
      unit text,
      geography text,
      period_start date,
      period_end date,
      method text,
      source_ids text[] NOT NULL DEFAULT '{}',
      evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
      confidence text,
      status text NOT NULL CHECK (status IN ('candidate','approved','rejected','superseded','needs_review')),
      created_by text NOT NULL CHECK (created_by IN ('connector','metric','agent','human')),
      reviewed_by text,
      reviewed_at timestamptz,
      valid_until date,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (key, version),
      CHECK ((version = 1) = (supersedes_id IS NULL)),
      CHECK (value_num IS NOT NULL OR value_text IS NOT NULL),
      CHECK (status NOT IN ('approved','rejected') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
    )
    """,
    "CREATE INDEX fact_key_status ON tda.fact (key, status)",
    """
    CREATE FUNCTION tda.fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'tda.fact: facts are never deleted' USING ERRCODE = 'restrict_violation';
      END IF;
      IF (NEW.id, NEW.key, NEW.version, NEW.supersedes_id, NEW.derived_from, NEW.value_num, NEW.value_text, NEW.unit,
          NEW.geography, NEW.period_start, NEW.period_end, NEW.method, NEW.source_ids, NEW.evidence, NEW.confidence,
          NEW.created_by, NEW.valid_until, NEW.created_at)
         IS DISTINCT FROM
         (OLD.id, OLD.key, OLD.version, OLD.supersedes_id, OLD.derived_from, OLD.value_num, OLD.value_text, OLD.unit,
          OLD.geography, OLD.period_start, OLD.period_end, OLD.method, OLD.source_ids, OLD.evidence, OLD.confidence,
          OLD.created_by, OLD.valid_until, OLD.created_at) THEN
        RAISE EXCEPTION 'tda.fact: a fact version is immutable; write a new version that supersedes it'
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.status IS NOT DISTINCT FROM OLD.status
         AND (NEW.reviewed_by, NEW.reviewed_at) IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at) THEN
        RAISE EXCEPTION 'tda.fact: the reviewer changes only with a status change' USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (
           ('candidate','approved'), ('candidate','rejected'),
           ('approved','superseded'), ('approved','needs_review'),
           ('needs_review','approved'), ('needs_review','rejected'), ('needs_review','superseded')) THEN
        RAISE EXCEPTION 'tda.fact: illegal status change % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END $$
    """,
    "CREATE TRIGGER fact_guard BEFORE UPDATE OR DELETE ON tda.fact FOR EACH ROW EXECUTE FUNCTION tda.fact_guard()",
    """
    CREATE TABLE tda.metric_value (
      id bigserial PRIMARY KEY,
      metric_key text NOT NULL,
      dims jsonb NOT NULL DEFAULT '{}'::jsonb,
      value numeric,
      unit text,
      computed_at timestamptz NOT NULL DEFAULT now(),
      method_version text NOT NULL,
      input_run_ids bigint[] NOT NULL DEFAULT '{}'
    )
    """,
    "CREATE INDEX metric_value_key ON tda.metric_value (metric_key, computed_at DESC)",
    "CREATE INDEX metric_value_runs ON tda.metric_value USING gin (input_run_ids)",
    "CREATE TRIGGER metric_value_append_only BEFORE UPDATE OR DELETE ON tda.metric_value "
    "FOR EACH ROW EXECUTE FUNCTION tda.forbid_mutation()",
    """
    CREATE TABLE tda.review_item (
      id bigserial PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('source','fact','report','campaign')),
      ref_id text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL CHECK (status IN ('pending','approved','rejected')),
      requested_by text NOT NULL,
      decided_by text,
      decided_at timestamptz,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((status = 'pending') = (decided_by IS NULL AND decided_at IS NULL))
    )
    """,
    """
    CREATE FUNCTION tda.review_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'tda.review_item: review items are never deleted' USING ERRCODE = 'restrict_violation';
      END IF;
      IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'tda.review_item: item % is already %', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
      END IF;
      IF (NEW.id, NEW.kind, NEW.ref_id, NEW.payload, NEW.requested_by, NEW.created_at)
         IS DISTINCT FROM (OLD.id, OLD.kind, OLD.ref_id, OLD.payload, OLD.requested_by, OLD.created_at) THEN
        RAISE EXCEPTION 'tda.review_item: only the decision may change' USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END $$
    """,
    "CREATE TRIGGER review_item_guard BEFORE UPDATE OR DELETE ON tda.review_item "
    "FOR EACH ROW EXECUTE FUNCTION tda.review_item_guard()",
    """
    CREATE TABLE tda.agent_run (
      id bigserial PRIMARY KEY,
      task text NOT NULL,
      provider text,
      model text,
      prompt_version text,
      tools_called jsonb NOT NULL DEFAULT '[]'::jsonb,
      input_tokens integer,
      output_tokens integer,
      cost_usd numeric(12, 6),
      status text NOT NULL,
      guardrail_violations jsonb NOT NULL DEFAULT '[]'::jsonb,
      output_ref text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )
    """,
    "CREATE TRIGGER agent_run_no_delete BEFORE DELETE ON tda.agent_run FOR EACH ROW EXECUTE FUNCTION tda.forbid_mutation()",
    """
    CREATE VIEW tda.current_metric_value AS
      SELECT DISTINCT ON (metric_key, dims)
             id, metric_key, dims, value, unit, computed_at, method_version, input_run_ids
      FROM tda.metric_value
      ORDER BY metric_key, dims, computed_at DESC, id DESC
    """,
    # The reader's only ingestion-status surface (02 §6.2): it has no access to fetch_run itself.
    """
    CREATE VIEW tda.source_freshness AS
      SELECT s.id AS source_id, s.status AS source_status, s.cadence, s.stale_after_hours,
             ok.last_success, latest.last_status,
             (s.status = 'approved' AND s.stale_after_hours IS NOT NULL
              AND (ok.last_success IS NULL OR ok.last_success < now() - make_interval(hours => s.stale_after_hours)))
               AS stale
      FROM tda.source s
      LEFT JOIN LATERAL (
        SELECT max(r.finished_at) AS last_success FROM tda.fetch_run r
        WHERE r.source_id = s.id AND r.status IN ('success', 'not_modified')
      ) ok ON true
      LEFT JOIN LATERAL (
        SELECT r.status AS last_status FROM tda.fetch_run r
        WHERE r.source_id = s.id ORDER BY r.started_at DESC, r.id DESC LIMIT 1
      ) latest ON true
    """,
    # TRUNCATE skips row triggers, so history tables also refuse it (even for the owner).
    *(
        f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON tda.{table} "
        "FOR EACH STATEMENT EXECUTE FUNCTION tda.forbid_mutation()"
        for table in ("source", "fetch_run", "fact", "metric_value", "review_item", "agent_run")
    ),
    # Explicit grants only; never default privileges (02 §6.2). Later revisions grant their own objects.
    "GRANT SELECT, INSERT, UPDATE ON tda.source, tda.fetch_run, tda.fact, tda.review_item, tda.agent_run TO tda_writer",
    "GRANT SELECT, INSERT ON tda.metric_value TO tda_writer",
    "GRANT SELECT ON tda.current_metric_value, tda.source_freshness TO tda_writer",
    "GRANT USAGE, SELECT ON SEQUENCE tda.fetch_run_id_seq, tda.fact_id_seq, tda.metric_value_id_seq, "
    "tda.review_item_id_seq, tda.agent_run_id_seq TO tda_writer",
    "GRANT SELECT ON tda.fact, tda.metric_value, tda.source, tda.current_metric_value, tda.source_freshness TO tda_reader",
]

DOWNGRADE = [
    "DROP VIEW tda.source_freshness",
    "DROP VIEW tda.current_metric_value",
    "DROP TABLE tda.agent_run",
    "DROP TABLE tda.review_item",
    "DROP FUNCTION tda.review_item_guard()",
    "DROP TABLE tda.metric_value",
    "DROP TABLE tda.fact",
    "DROP FUNCTION tda.fact_guard()",
    "DROP TABLE tda.fetch_run",
    "DROP FUNCTION tda.fetch_run_guard()",
    "DROP TABLE tda.source",
    "DROP FUNCTION tda.forbid_mutation()",
]


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE:
        op.execute(statement)
