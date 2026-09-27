"""Schema invariants: grants, guards, views, and a migration round trip (P2 T3)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from tda.store.bootstrap import bootstrap, downgrade, upgrade
from tda.store.observations import drop_observation_table_ddl, observation_table_ddl
from tests.conftest import DbUrls

SOURCE = (
    "INSERT INTO tda.source (id, name, kind, auth, robots_required, store_policy, status, owner, cadence, "
    "stale_after_hours) "
    "VALUES (:id, 'Test', 'rest', 'none', false, 'ttl:180d', :status, 'test', :cadence, :stale)"
)


def _conn(urls: DbUrls, role: str) -> Iterator[Connection]:
    engine = urls.engine(role)
    with engine.connect() as connection:
        yield connection
    engine.dispose()


@pytest.fixture
def writer(db: DbUrls) -> Iterator[Connection]:
    yield from _conn(db, "writer")


@pytest.fixture
def reader(db: DbUrls) -> Iterator[Connection]:
    yield from _conn(db, "reader")


@pytest.fixture
def owner(db: DbUrls) -> Iterator[Connection]:
    """The schema owner: every privilege, so only the guard triggers stand in the way."""
    for connection in _conn(db, "admin"):
        connection.execute(text("SET ROLE tda_owner"))
        connection.commit()
        yield connection


def _source(
    connection: Connection, source_id: str = "src", status: str = "approved", stale: int | None = 24
) -> None:
    connection.execute(
        text(SOURCE),
        {"id": source_id, "status": status, "cadence": "0 9 * * *" if stale else None, "stale": stale},
    )


def _run(connection: Connection, source_id: str = "src", status: str = "success", ago: str = "1 hour") -> int:
    return connection.execute(
        text(
            "INSERT INTO tda.fetch_run (source_id, acquisition, status, started_at, finished_at) "
            "VALUES (:s, 'http', :st, now() - CAST(:ago AS interval), now() - CAST(:ago AS interval)) "
            "RETURNING id"
        ),
        {"s": source_id, "st": status, "ago": ago},
    ).scalar_one()


def _denied(connection: Connection, statement: str, params: dict | None = None) -> str:
    with pytest.raises(DBAPIError) as caught:
        connection.execute(text(statement), params or {})
    connection.rollback()
    return str(caught.value.orig)


def test_reader_sees_only_api_exposed_objects(writer: Connection, reader: Connection) -> None:
    _source(writer)
    writer.commit()
    for relation in (
        "fact",
        "metric_value",
        "source",
        "current_metric_value",
        "source_freshness",
        "fact_source_retrieval",
    ):
        reader.execute(text(f"SELECT count(*) FROM tda.{relation}")).scalar_one()
    for relation in ("fetch_run", "review_item", "agent_run", "alembic_version"):
        assert "permission denied" in _denied(reader, f"SELECT 1 FROM tda.{relation}")


def test_reader_cannot_write(reader: Connection) -> None:
    message = _denied(
        reader,
        "INSERT INTO tda.fact (key, version, value_num, status, created_by) "
        "VALUES ('k', 1, 1, 'candidate', 'human')",
    )
    assert "permission denied" in message


def test_no_default_privileges_in_schema(db: DbUrls) -> None:
    engine = db.engine("admin")
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT count(*) FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace "
                "WHERE n.nspname = 'tda'"
            )
        ).scalar_one()
        owners = connection.execute(
            text(
                "SELECT DISTINCT pg_get_userbyid(c.relowner) FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tda'"
            )
        ).scalars()
        owner_set = set(owners)
    engine.dispose()
    assert rows == 0
    assert owner_set == {"tda_owner"}


def test_fact_versions_are_immutable(writer: Connection) -> None:
    fact_id = writer.execute(
        text(
            "INSERT INTO tda.fact (key, version, value_num, status, created_by) "
            "VALUES ('carta.upt', 1, 100, 'candidate', 'connector') RETURNING id"
        )
    ).scalar_one()
    writer.commit()
    assert "immutable" in _denied(writer, "UPDATE tda.fact SET value_num = 101 WHERE id = :i", {"i": fact_id})
    writer.execute(
        text("UPDATE tda.fact SET status = 'approved', reviewed_by = 'r', reviewed_at = now() WHERE id = :i"),
        {"i": fact_id},
    )
    writer.commit()
    assert "illegal status change" in _denied(
        writer, "UPDATE tda.fact SET status = 'candidate' WHERE id = :i", {"i": fact_id}
    )
    assert "permission denied" in _denied(writer, "DELETE FROM tda.fact WHERE id = :i", {"i": fact_id})


def test_a_decision_cannot_be_reattributed(writer: Connection) -> None:
    fact_id = writer.execute(
        text(
            "INSERT INTO tda.fact (key, version, value_num, status, created_by, reviewed_by, reviewed_at) "
            "VALUES ('k', 1, 1, 'approved', 'human', 'alice', now()) RETURNING id"
        )
    ).scalar_one()
    writer.commit()
    assert "reviewer changes only with a status change" in _denied(
        writer, "UPDATE tda.fact SET reviewed_by = 'mallory' WHERE id = :i", {"i": fact_id}
    )
    writer.execute(text("UPDATE tda.fact SET status = 'needs_review' WHERE id = :i"), {"i": fact_id})
    writer.execute(
        text(
            "UPDATE tda.fact SET status = 'approved', reviewed_by = 'bob', reviewed_at = now() WHERE id = :i"
        ),
        {"i": fact_id},
    )
    writer.commit()
    assert (
        writer.execute(text("SELECT reviewed_by FROM tda.fact WHERE id = :i"), {"i": fact_id}).scalar_one()
        == "bob"
    )


def test_even_the_owner_cannot_delete_or_edit_history(writer: Connection, owner: Connection) -> None:
    _source(writer)
    run = _run(writer)
    fact_id = writer.execute(
        text(
            "INSERT INTO tda.fact (key, version, value_num, status, created_by) "
            "VALUES ('k', 1, 1, 'candidate', 'human') RETURNING id"
        )
    ).scalar_one()
    writer.execute(
        text("INSERT INTO tda.metric_value (metric_key, value, method_version) VALUES ('m', 1, 'v1')")
    )
    writer.commit()
    assert "never deleted" in _denied(owner, "DELETE FROM tda.fact WHERE id = :i", {"i": fact_id})
    assert "never deleted" in _denied(owner, "DELETE FROM tda.fetch_run WHERE id = :i", {"i": run})
    assert "append-only" in _denied(owner, "UPDATE tda.metric_value SET value = 2")
    assert "append-only" in _denied(owner, "DELETE FROM tda.metric_value")
    assert "append-only" in _denied(owner, "DELETE FROM tda.source")
    for table in ("source", "fetch_run", "fact", "metric_value", "review_item", "agent_run"):
        assert "TRUNCATE is not allowed" in _denied(owner, f"TRUNCATE tda.{table} CASCADE")


def test_finished_runs_only_move_to_rolled_back(writer: Connection) -> None:
    _source(writer)
    run = _run(writer, status="running")
    writer.execute(
        text("UPDATE tda.fetch_run SET status = 'success', sha256 = repeat('a', 64) WHERE id = :i"),
        {"i": run},
    )
    writer.commit()
    assert "immutable" in _denied(
        writer, "UPDATE tda.fetch_run SET sha256 = repeat('b', 64) WHERE id = :i", {"i": run}
    )
    writer.execute(text("UPDATE tda.fetch_run SET status = 'rolled_back' WHERE id = :i"), {"i": run})
    writer.commit()
    assert "immutable" in _denied(
        writer, "UPDATE tda.fetch_run SET status = 'success' WHERE id = :i", {"i": run}
    )
    assert "permission denied" in _denied(writer, "DELETE FROM tda.fetch_run WHERE id = :i", {"i": run})


def test_metric_values_are_append_only(writer: Connection, reader: Connection) -> None:
    for value in (1, 2):
        writer.execute(
            text(
                "INSERT INTO tda.metric_value (metric_key, dims, value, method_version) "
                "VALUES ('m', '{\"a\": 1}', :v, 'v1')"
            ),
            {"v": value},
        )
    writer.commit()
    assert "permission denied" in _denied(writer, "UPDATE tda.metric_value SET value = 3")
    assert "permission denied" in _denied(writer, "DELETE FROM tda.metric_value")
    assert (
        reader.execute(text("SELECT value FROM tda.current_metric_value WHERE metric_key = 'm'")).scalar_one()
        == 2
    )


def test_source_freshness(writer: Connection, reader: Connection) -> None:
    _source(writer, "fresh")
    _source(writer, "stale")
    _source(writer, "never")
    _source(writer, "proposed", status="proposed")
    _run(writer, "fresh", ago="1 hour")
    _run(writer, "stale", ago="3 days")
    _run(writer, "stale", status="failed", ago="1 hour")
    writer.commit()
    rows = {
        r.source_id: r.stale
        for r in reader.execute(text("SELECT source_id, stale FROM tda.source_freshness"))
    }
    assert rows == {"fresh": False, "stale": True, "never": True, "proposed": False}
    last = reader.execute(
        text("SELECT last_status FROM tda.source_freshness WHERE source_id = 'stale'")
    ).scalar_one()
    assert last == "failed"


def test_observation_helper_keeps_history_and_honors_rollback(db: DbUrls) -> None:
    admin = db.engine("admin")
    writer = db.engine("writer")

    def as_owner(statements: list[str]) -> None:
        with admin.begin() as connection:
            connection.execute(text("SET ROLE tda_owner"))
            for statement in statements:
                connection.execute(text(statement))

    as_owner(observation_table_ddl("probe_obs", ["item text NOT NULL", "value text"], ["item"]))
    try:
        with writer.begin() as connection:
            _source(connection)
            first = _run(connection, ago="2 hours")
            second = _run(connection, ago="1 hour")
            for run, value in ((first, "old"), (second, "new")):
                connection.execute(
                    text(
                        "INSERT INTO tda.probe_obs (item, value, content_hash, fetch_run_id) "
                        "VALUES ('x', :v, :v, :r)"
                    ),
                    {"v": value, "r": run},
                )
        with writer.connect() as connection:
            assert connection.execute(text("SELECT value FROM tda.current_probe_obs")).scalar_one() == "new"
            connection.execute(
                text("UPDATE tda.fetch_run SET status = 'rolled_back' WHERE id = :i"), {"i": second}
            )
            connection.commit()
            assert connection.execute(text("SELECT value FROM tda.current_probe_obs")).scalar_one() == "old"
            assert connection.execute(text("SELECT count(*) FROM tda.probe_obs")).scalar_one() == 2
            assert "permission denied" in _denied(connection, "UPDATE tda.probe_obs SET value = 'edited'")
        with admin.connect() as connection:
            connection.execute(text("SET ROLE tda_owner"))
            connection.commit()
            for statement in (
                "UPDATE tda.probe_obs SET value = 'edited'",
                "DELETE FROM tda.probe_obs",
                "TRUNCATE tda.probe_obs",
            ):
                assert "append-only" in _denied(connection, statement)
    finally:
        as_owner(drop_observation_table_ddl("probe_obs"))
        writer.dispose()
        admin.dispose()


def test_migrations_round_trip_and_bootstrap_is_idempotent(db: DbUrls) -> None:
    downgrade(db.admin, "base")
    engine = db.engine("admin")
    with engine.connect() as connection:
        left = connection.execute(
            text(
                "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema = 'tda' AND table_name <> 'alembic_version'"
            )
        ).scalar_one()
    assert left == 0
    assert bootstrap(db.admin, db.writer, db.reader)[-1].startswith("schema tda")
    upgrade(db.admin)
    with engine.connect() as connection:
        names = set(
            connection.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'tda'")
            ).scalars()
        )
    engine.dispose()
    assert {
        "source",
        "fetch_run",
        "fact",
        "metric_value",
        "review_item",
        "agent_run",
        "source_freshness",
    } <= names


def test_reader_role_cannot_run_ddl(reader: Connection) -> None:
    with pytest.raises(ProgrammingError):
        reader.execute(text("CREATE TABLE tda.evil (id int)"))
    reader.rollback()


def test_orm_models_match_the_migrated_columns(db: DbUrls) -> None:
    from tda.store.models import Base

    engine = db.engine("admin")
    with engine.connect() as connection:
        for table in Base.metadata.sorted_tables:
            migrated = set(
                connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'tda' AND table_name = :t"
                    ),
                    {"t": table.name},
                ).scalars()
            )
            assert migrated == {column.name for column in table.columns}, table.name
    engine.dispose()


def test_current_metrics_hide_a_latest_value_whose_input_was_rolled_back(
    db: DbUrls, writer: Connection
) -> None:
    """Review finding F3: checked as reader, writer, and owner; an older value is never revived."""
    _source(writer)
    old_run = _run(writer, ago="2 hours")
    new_run = _run(writer, ago="1 hour")
    for value, run, ago in ((5, old_run, "2 hours"), (99, new_run, "1 hour")):
        writer.execute(
            text(
                "INSERT INTO tda.metric_value "
                "(metric_key, value, method_version, input_run_ids, computed_at) "
                "VALUES ('m', :v, 'v1', ARRAY[CAST(:r AS bigint)], now() - CAST(:ago AS interval))"
            ),
            {"v": value, "r": run, "ago": ago},
        )
    writer.commit()
    query = "SELECT value FROM tda.current_metric_value WHERE metric_key = 'm'"
    assert writer.execute(text(query)).scalars().all() == [99]
    writer.execute(text("UPDATE tda.fetch_run SET status = 'rolled_back' WHERE id = :i"), {"i": new_run})
    writer.commit()
    for role in ("reader", "writer", "admin"):
        engine = db.engine(role)
        with engine.connect() as connection:
            assert connection.execute(text(query)).scalars().all() == [], role
        engine.dispose()


def test_published_at_is_stamped_once_and_never_changes(writer: Connection, owner: Connection) -> None:
    """Review finding F4: publication is an immutable fact of history."""
    fact_id = writer.execute(
        text(
            "INSERT INTO tda.fact (key, version, value_num, status, created_by, published_at) "
            "VALUES ('k', 1, 1, 'candidate', 'human', now()) RETURNING id"
        )
    ).scalar_one()
    writer.commit()
    query = text("SELECT published_at FROM tda.fact WHERE id = :i")
    assert writer.execute(query, {"i": fact_id}).scalar_one() is None, "a client can't pre-set it"
    writer.execute(
        text("UPDATE tda.fact SET status = 'approved', reviewed_by = 'r', reviewed_at = now() WHERE id = :i"),
        {"i": fact_id},
    )
    writer.commit()
    stamped = writer.execute(query, {"i": fact_id}).scalar_one()
    assert stamped is not None
    writer.execute(text("UPDATE tda.fact SET status = 'needs_review' WHERE id = :i"), {"i": fact_id})
    writer.execute(
        text(
            "UPDATE tda.fact SET status = 'rejected', reviewed_by = 'r2', reviewed_at = now() WHERE id = :i"
        ),
        {"i": fact_id},
    )
    writer.commit()
    assert writer.execute(query, {"i": fact_id}).scalar_one() == stamped, "rejection keeps the history"
    for connection in (writer, owner):
        assert "published_at never changes" in _denied(
            connection, "UPDATE tda.fact SET published_at = NULL WHERE id = :i", {"i": fact_id}
        )


def test_freshness_counts_a_not_modified_run_only_while_its_success_survives(
    writer: Connection, reader: Connection
) -> None:
    """Review finding F8."""
    _source(writer, "src")
    success = _run(writer, ago="3 days")
    writer.execute(
        text(
            "INSERT INTO tda.fetch_run (source_id, acquisition, status, finished_at, validates_run_id) "
            "VALUES ('src', 'http', 'not_modified', now() - interval '1 hour', :v)"
        ),
        {"v": success},
    )
    writer.commit()
    fresh = text("SELECT stale, last_success FROM tda.source_freshness WHERE source_id = 'src'")
    assert reader.execute(fresh).one().stale is False
    writer.execute(text("UPDATE tda.fetch_run SET status = 'rolled_back' WHERE id = :i"), {"i": success})
    writer.commit()
    row = reader.execute(fresh).one()
    assert (row.stale, row.last_success) == (True, None)
    assert "must confirm a success run of the same source" in _denied(
        writer,
        "INSERT INTO tda.fetch_run (source_id, acquisition, status, finished_at) "
        "VALUES ('src', 'http', 'not_modified', now())",
    )


def test_a_not_modified_run_cannot_borrow_another_sources_success(
    writer: Connection, reader: Connection
) -> None:
    """Review round 2, R2-5: the validator must be a success of the same source."""
    _source(writer, "a-src")
    _source(writer, "b-src")
    b_success = _run(writer, "b-src")
    writer.commit()
    insert = (
        "INSERT INTO tda.fetch_run (source_id, acquisition, status, finished_at, validates_run_id) "
        "VALUES ('a-src', 'http', 'not_modified', now(), :v)"
    )
    assert "must confirm a success run of the same source" in _denied(writer, insert, {"v": b_success})
    stale = reader.execute(
        text("SELECT stale FROM tda.source_freshness WHERE source_id = 'a-src'")
    ).scalar_one()
    assert stale is True, "a-src never succeeded"


def test_metric_lineage_must_name_real_success_runs(db: DbUrls, writer: Connection) -> None:
    """Review round 2, R2-4: rejected on insert, and the view filters them even if a row slipped in."""
    _source(writer)
    run = _run(writer)
    writer.commit()
    insert = (
        "INSERT INTO tda.metric_value (metric_key, value, method_version, input_run_ids) "
        "VALUES (:k, 99, 'v1', {})"
    )
    ghost = "ARRAY[CAST(987654321 AS bigint)]"
    assert "must exist and be a success" in _denied(writer, insert.format(ghost), {"k": "m1"})
    null = "ARRAY[CAST(NULL AS bigint)]"
    assert "must exist and be a success" in _denied(writer, insert.format(null), {"k": "m2"})
    admin = db.engine("admin")
    with admin.connect() as connection:  # triggers off (superuser): the CHECK still refuses a NULL input
        connection.execute(text("SET session_replication_role = replica"))
        connection.commit()
        assert "violates check constraint" in _denied(connection, insert.format(null), {"k": "m2"})
    with admin.begin() as connection:  # bypass the trigger as a superuser to test the view on its own
        connection.execute(text("SET LOCAL session_replication_role = replica"))
        connection.execute(text(insert.format(ghost)), {"k": "ghost"})
        connection.execute(text(insert.format("ARRAY[CAST(:r AS bigint)]")), {"k": "real", "r": run})
    admin.dispose()
    for role in ("reader", "writer", "admin"):
        engine = db.engine(role)
        with engine.connect() as connection:
            keys = connection.execute(text("SELECT metric_key FROM tda.current_metric_value")).scalars().all()
        engine.dispose()
        assert keys == ["real"], role
