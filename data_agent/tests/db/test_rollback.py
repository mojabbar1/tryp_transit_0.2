"""Rollback by status (P2 T6, REV-07): dry run lists; confirm marks, recomputes, flags; deletes nothing."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, text

from tda.connectors.base import RollbackRefused, rollback_run
from tda.metrics.registry import MetricDefinition, MetricRegistry, MetricResult
from tests.db.conftest import rows
from tests.support.echo import EchoConnector

Echo = Callable[..., EchoConnector]
TABLES = ("fetch_run", "echo_obs", "fact", "metric_value", "source")


def _value_of_a(connection: Connection, dims: Mapping[str, Any]) -> MetricResult:
    row = connection.execute(
        text("SELECT value, fetch_run_id FROM tda.current_echo_obs WHERE name = :n"), {"n": dims["name"]}
    ).one()
    return MetricResult(Decimal(row.value), [row.fetch_run_id], unit="count")


def _counts(engine: Engine) -> dict[str, int]:
    return {t: rows(engine, f"SELECT count(*) FROM tda.{t}")[0][0] for t in TABLES}


@pytest.fixture
def world(echo: Echo, writer_engine: Engine, metrics: MetricRegistry) -> dict[str, Any]:
    """Two runs of echo (a: 1, then a: 2), metrics and facts that depend on them."""
    metrics.register(MetricDefinition("echo.value", "v1", _value_of_a))
    connector = echo(payload={"items": [{"name": "a", "value": "1"}]})
    first = connector.run(live=True).run_id
    connector.payload = {"items": [{"name": "a", "value": "2"}]}
    second = connector.run(live=True).run_id
    ids: dict[str, Any] = {"connector": connector, "first": first, "second": second}
    with writer_engine.begin() as connection:
        for key, dims, value, inputs in (
            ("echo.value", {"name": "a"}, 2, [second]),
            ("echo.unregistered", {}, 7, [first, second]),
            ("other.metric", {}, 5, [first]),
        ):
            connection.execute(
                text(
                    "INSERT INTO tda.metric_value (metric_key, dims, value, method_version, input_run_ids) "
                    "VALUES (:k, CAST(:d AS jsonb), :v, 'v1', :i)"
                ),
                {"k": key, "d": json.dumps(dims), "v": value, "i": inputs},
            )
        for name, status, cites in (
            ("uses_second", "approved", [first, second]),
            ("uses_first", "approved", [first]),
            ("candidate", "candidate", [second]),
        ):
            reviewed = status == "approved"
            ids[name] = connection.execute(
                text(
                    "INSERT INTO tda.fact (key, version, value_num, status, created_by, derived_from, "
                    "reviewed_by, reviewed_at) VALUES (:k, 1, 2, :s, 'metric', CAST(:d AS jsonb), :rb, :ra) "
                    "RETURNING id"
                ),
                {
                    "k": f"echo.{name}",
                    "s": status,
                    "d": json.dumps({"input_run_ids": cites}),
                    "rb": "reviewer" if reviewed else None,
                    "ra": datetime(2026, 9, 27, tzinfo=UTC) if reviewed else None,
                },
            ).scalar_one()
    return ids


def _metric(engine: Engine, key: str) -> Any:
    return rows(
        engine,
        "SELECT value, method_version, input_run_ids FROM tda.current_metric_value WHERE metric_key = :k",
        k=key,
    )[0]


def _fact_status(engine: Engine, fact_id: int) -> str:
    return rows(engine, "SELECT status FROM tda.fact WHERE id = :i", i=fact_id)[0][0]


def test_dry_run_lists_every_change_and_changes_nothing(world: dict[str, Any], writer_engine: Engine) -> None:
    before = _counts(writer_engine)
    plan = world["connector"].rollback(world["second"], dry_run=True)
    assert not plan.applied
    assert plan.observations == {"echo_obs": 1}
    assert [(m.metric_key, m.action) for m in plan.metrics] == [
        ("echo.unregistered", "withdraw"),
        ("echo.value", "recompute"),
    ]
    assert [f.id for f in plan.facts_to_review] == [world["uses_second"]]
    assert [f.id for f in plan.candidate_facts] == [world["candidate"]]
    text_plan = "\n".join(plan.lines())
    assert "would roll back" in text_plan and "approved -> needs_review" in text_plan
    assert _counts(writer_engine) == before
    assert (
        rows(writer_engine, "SELECT status FROM tda.fetch_run WHERE id = :i", i=world["second"])[0][0]
        == "success"
    )
    assert _fact_status(writer_engine, world["uses_second"]) == "approved"


def test_confirm_marks_recomputes_flags_and_deletes_nothing(
    world: dict[str, Any], writer_engine: Engine, tmp_path: Path
) -> None:
    before = _counts(writer_engine)
    raw_uri = rows(writer_engine, "SELECT raw_uri FROM tda.fetch_run WHERE id = :i", i=world["second"])[0][0]
    plan = world["connector"].rollback(world["second"], dry_run=False)
    assert plan.applied
    assert rows(writer_engine, "SELECT status FROM tda.fetch_run WHERE id = :i", i=world["second"])[0][0] == (
        "rolled_back"
    )
    assert {tuple(r) for r in rows(writer_engine, "SELECT name, value FROM tda.current_echo_obs")} == {
        ("a", "1")
    }
    value = _metric(writer_engine, "echo.value")
    assert (value.value, value.method_version, value.input_run_ids) == (Decimal(1), "v1", [world["first"]])
    withdrawn = _metric(writer_engine, "echo.unregistered")
    assert (withdrawn.value, withdrawn.method_version) == (None, "withdrawn")
    assert _metric(writer_engine, "other.metric").value == Decimal(5)
    assert _fact_status(writer_engine, world["uses_second"]) == "needs_review"
    assert _fact_status(writer_engine, world["uses_first"]) == "approved"
    assert _fact_status(writer_engine, world["candidate"]) == "candidate"
    after = _counts(writer_engine)
    assert after == {**before, "metric_value": before["metric_value"] + 2}, "only appends; nothing deleted"
    assert (tmp_path / "raw" / raw_uri.removeprefix("raw://")).exists(), "the raw snapshot is kept"


def test_only_a_success_run_can_be_rolled_back(world: dict[str, Any], writer_engine: Engine) -> None:
    connector = world["connector"]
    connector.rollback(world["second"], dry_run=False)
    with pytest.raises(RollbackRefused, match="rolled_back"):
        connector.rollback(world["second"], dry_run=False)
    reloaded = connector.run(live=True)
    assert reloaded.status == "success", "after the rollback, the same body loads again"
    repeat = connector.run(live=True)
    with pytest.raises(RollbackRefused, match="not_modified"):
        connector.rollback(repeat.run_id, dry_run=True)
    with pytest.raises(LookupError):
        rollback_run(writer_engine, 999_999, owned_tables=(), dry_run=True)


def test_a_connector_rolls_back_only_its_own_runs(world: dict[str, Any], writer_engine: Engine) -> None:
    with pytest.raises(RollbackRefused, match="belongs to"):
        rollback_run(writer_engine, world["first"], owned_tables=(), dry_run=True, source_id="someone-else")


def test_a_metric_that_still_reads_the_rolled_back_run_aborts_everything(
    world: dict[str, Any], writer_engine: Engine, metrics: MetricRegistry
) -> None:
    metrics.definitions["echo.value"] = MetricDefinition(
        "echo.value", "v1", lambda c, d: MetricResult(Decimal(0), [world["second"]])
    )
    with pytest.raises(RuntimeError, match="still read"):
        world["connector"].rollback(world["second"], dry_run=False)
    assert (
        rows(writer_engine, "SELECT status FROM tda.fetch_run WHERE id = :i", i=world["second"])[0][0]
        == "success"
    )
    assert _fact_status(writer_engine, world["uses_second"]) == "approved"
