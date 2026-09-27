"""Concurrency (review findings F1, F2): per-key version changes; publishing and rollback coordinate.

Each test holds one transaction open and proves the other side waits, then sees the committed result.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, text

from tda.facts.versions import FactDraft, FactStateError, approve_fact, write_fact
from tda.metrics.registry import MetricDefinition, MetricRegistry, MetricResult, record_metric
from tda.store.lineage import LineageError
from tests.db.conftest import rows
from tests.support.echo import EchoConnector

WAIT = 0.5


def _draft(value: int, runs: list[int] | None = None, key: str = "carta.fare") -> FactDraft:
    return FactDraft(
        key=key, created_by="metric", derived_from={"input_run_ids": runs or []}, value_num=value
    )


def _status(engine: Engine, fact_id: int) -> str:
    return rows(engine, "SELECT status FROM tda.fact WHERE id = :i", i=fact_id)[0][0]


def _in_thread(fn: Callable[[], Any]) -> tuple[threading.Thread, dict[str, Any]]:
    out: dict[str, Any] = {}

    def body() -> None:
        try:
            out["value"] = fn()
        except Exception as error:
            out["error"] = error

    thread = threading.Thread(target=body, daemon=True)
    thread.start()
    return thread, out


def _approve(engine: Engine, fact_id: int) -> Callable[[], None]:
    def go() -> None:
        with engine.begin() as connection:
            approve_fact(connection, fact_id, "second")

    return go


@pytest.mark.parametrize("first", ["v1", "v2"])
def test_concurrent_approvals_always_leave_the_newest_version_current(
    writer_engine: Engine, first: str
) -> None:
    with writer_engine.begin() as connection:
        ids = {"v1": write_fact(connection, _draft(1)), "v2": write_fact(connection, _draft(2))}
    second = "v2" if first == "v1" else "v1"
    with writer_engine.connect() as holder:  # closing it on any failure releases its locks
        holder.begin()
        approve_fact(holder, ids[first], "first")
        thread, out = _in_thread(_approve(writer_engine, ids[second]))
        thread.join(WAIT)
        assert thread.is_alive(), "the second approval waits for the key lock"
        holder.commit()
    thread.join(10)
    assert _status(writer_engine, ids["v2"]) == "approved"
    assert _status(writer_engine, ids["v1"]) == ("superseded" if first == "v1" else "candidate")
    if first == "v2":
        assert isinstance(out.get("error"), FactStateError) and "newer" in str(out["error"])
    approved = rows(
        writer_engine, "SELECT count(*) FROM tda.fact WHERE key = 'carta.fare' AND status = 'approved'"
    )
    assert approved[0][0] == 1


def test_the_database_allows_one_approved_version_per_key(writer_engine: Engine) -> None:
    with writer_engine.begin() as connection:
        write_fact(connection, _draft(1), auto_publish=True)
        second = write_fact(connection, _draft(2))
    with writer_engine.connect() as connection, pytest.raises(Exception, match="fact_one_approved_per_key"):
        connection.execute(
            text(
                "UPDATE tda.fact SET status = 'approved', reviewed_by = 'x', reviewed_at = now() "
                "WHERE id = :i"
            ),
            {"i": second},
        )


@pytest.fixture
def paused_rollback(
    echo: Callable[..., EchoConnector], writer_engine: Engine, metrics: MetricRegistry
) -> dict[str, Any]:
    """A success run with a metric citing it, and a rollback of that run that pauses mid-transaction."""
    connector = echo()
    run = connector.run(live=True).run_id
    started, release = threading.Event(), threading.Event()

    def blocking(connection: Connection, dims: Any) -> MetricResult:
        started.set()
        assert release.wait(10)
        return MetricResult(Decimal(0), [])

    metrics.register(MetricDefinition("probe.metric", "v1", blocking))
    with writer_engine.begin() as connection:
        record_metric(connection, "probe.metric", {}, MetricResult(Decimal(1), [run]), "v1")
    return {"connector": connector, "run": run, "started": started, "release": release}


def test_a_publisher_blocked_by_a_rollback_then_refuses(
    paused_rollback: dict[str, Any], writer_engine: Engine
) -> None:
    run = paused_rollback["run"]
    with writer_engine.begin() as connection:
        fact = write_fact(connection, _draft(5, [run], key="echo.fact"))
    rollback, rolled = _in_thread(lambda: paused_rollback["connector"].rollback(run, dry_run=False))
    assert paused_rollback["started"].wait(10), "the rollback holds the run lock"

    def record() -> None:
        with writer_engine.begin() as connection:
            record_metric(connection, "late.metric", {}, MetricResult(Decimal(7), [run]), "v1")

    publisher, published = _in_thread(_approve(writer_engine, fact))
    recorder, recorded = _in_thread(record)
    try:
        publisher.join(WAIT)
        recorder.join(WAIT)
        assert publisher.is_alive() and recorder.is_alive(), "both wait for the rollback"
    finally:
        paused_rollback["release"].set()  # never leave the rollback's transaction (and its locks) open
        for thread in (rollback, publisher, recorder):
            thread.join(10)
    assert "error" not in rolled, rolled
    assert isinstance(published.get("error"), FactStateError) and "rolled_back" in str(published["error"])
    assert isinstance(recorded.get("error"), LineageError)
    assert _status(writer_engine, fact) == "candidate"
    assert (
        rows(writer_engine, "SELECT count(*) FROM tda.metric_value WHERE metric_key = 'late.metric'")[0][0]
        == 0
    )


def test_a_rollback_blocked_by_a_publisher_then_flags_the_new_fact(
    echo: Callable[..., EchoConnector], writer_engine: Engine
) -> None:
    connector = echo()
    run = connector.run(live=True).run_id
    with writer_engine.begin() as connection:
        fact = write_fact(connection, _draft(5, [run], key="echo.fact"))
    with writer_engine.connect() as holder:  # closing it on any failure releases its locks
        holder.begin()
        approve_fact(holder, fact, "publisher")
        rollback, rolled = _in_thread(lambda: connector.rollback(run, dry_run=False))
        rollback.join(WAIT)
        assert rollback.is_alive(), "the rollback waits for the publisher's run lock"
        holder.commit()
    rollback.join(10)
    plan = rolled["value"]
    assert [f.id for f in plan.facts_to_review] == [fact]
    assert _status(writer_engine, fact) == "needs_review"


def test_publishing_refuses_inputs_that_are_not_success(
    echo: Callable[..., EchoConnector], writer_engine: Engine
) -> None:
    connector = echo()
    run = connector.run(live=True).run_id
    connector.rollback(run, dry_run=False)
    with writer_engine.begin() as connection:
        with pytest.raises(FactStateError, match="rolled_back"):
            write_fact(connection, _draft(1, [run], key="echo.auto"), auto_publish=True)
    with writer_engine.begin() as connection:
        with pytest.raises(FactStateError, match="missing"):
            write_fact(connection, _draft(1, [987654], key="echo.auto"), auto_publish=True)


def test_concurrent_rollbacks_sharing_a_metric_do_not_deadlock(
    echo: Callable[..., EchoConnector], writer_engine: Engine, metrics: MetricRegistry
) -> None:
    """Review round 2, R2-1: a metric depends on runs A and B, and both are rolled back at once. Each
    recomputation reads the other run while it is still a success (Astra's lock cycle). Rollbacks are
    serialized, so both finish."""
    connector = echo(payload={"items": [{"name": "a", "value": "1"}]})
    a = connector.run(live=True).run_id
    connector.payload = {"items": [{"name": "a", "value": "2"}]}
    b = connector.run(live=True).run_id
    first_in, release = threading.Event(), threading.Event()

    def still_successful(connection: Connection, dims: Any) -> MetricResult:
        inputs = list(
            connection.execute(
                text("SELECT id FROM tda.fetch_run WHERE id = ANY(:ids) AND status = 'success' ORDER BY id"),
                {"ids": [a, b]},
            ).scalars()
        )
        if not first_in.is_set():
            first_in.set()
            assert release.wait(10)
        return MetricResult(Decimal(len(inputs)), inputs)

    metrics.register(MetricDefinition("both.runs", "v1", still_successful))
    with writer_engine.begin() as connection:
        record_metric(connection, "both.runs", {}, MetricResult(Decimal(2), [a, b]), "v1")
    first, first_out = _in_thread(lambda: connector.rollback(a, dry_run=False))
    assert first_in.wait(10)
    second, second_out = _in_thread(lambda: connector.rollback(b, dry_run=False))
    try:
        second.join(WAIT)
        assert second.is_alive(), "the second rollback waits for the first"
    finally:
        release.set()
        first.join(10)
        second.join(10)
    assert "error" not in first_out and "error" not in second_out, (first_out, second_out)
    statuses = rows(writer_engine, "SELECT status FROM tda.fetch_run WHERE id = ANY(:ids)", ids=[a, b])
    assert [r[0] for r in statuses] == ["rolled_back", "rolled_back"]
    current = rows(writer_engine, "SELECT value FROM tda.current_metric_value WHERE metric_key = 'both.runs'")
    assert [r[0] for r in current] == [Decimal(0)], "recomputed with no surviving inputs"
