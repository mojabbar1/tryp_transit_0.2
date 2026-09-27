"""Connector base (P2 T6): statuses, idempotency, append-only loads, no partial loads, manual acquisition."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import Engine, text

from tda.http.polite_client import BudgetExceeded, FetchError, RequestBudget, RobotsDisallowed
from tda.store.observations import content_hash, insert_observations
from tests.db.conftest import rows
from tests.support.echo import EchoConnector

Echo = Callable[..., EchoConnector]


def _runs(engine: Engine) -> list[tuple]:
    return [tuple(r) for r in rows(engine, "SELECT status, acquisition FROM tda.fetch_run ORDER BY id")]


def _current(engine: Engine) -> set[tuple]:
    return {tuple(r) for r in rows(engine, "SELECT name, value FROM tda.current_echo_obs")}


def _count(engine: Engine, table: str) -> int:
    return rows(engine, f"SELECT count(*) FROM tda.{table}")[0][0]


@pytest.mark.parametrize("live", [False, True])
def test_a_proposed_source_is_skipped_disabled_without_fetching(
    echo: Echo, writer_engine: Engine, live: bool
) -> None:
    connector = echo(approved=False)
    outcome = connector.run(live=live)
    assert outcome.status == "skipped_disabled"
    assert connector.fetches == []
    assert _runs(writer_engine) == [("skipped_disabled", "http")]


def test_an_approved_source_is_not_fetched_without_live(echo: Echo, writer_engine: Engine) -> None:
    connector = echo()
    outcome = connector.run(live=False)
    assert (outcome.status, outcome.run_id) == ("not_live", None)
    assert connector.fetches == []
    assert _runs(writer_engine) == []


def test_a_live_run_lands_loads_and_records_the_run(
    echo: Echo, writer_engine: Engine, tmp_path: Path
) -> None:
    payload = {"items": [{"name": "a", "value": "1"}, {"name": "b", "value": "2"}]}
    outcome = echo(payload=payload).run(live=True)
    assert (outcome.status, outcome.rows_loaded) == ("success", 2)
    run = rows(
        writer_engine,
        "SELECT status, acquisition, http_status, bytes, sha256, raw_uri, etag "
        "FROM tda.fetch_run WHERE id = :i",
        i=outcome.run_id,
    )[0]
    body = json.dumps(payload).encode()
    assert (run.status, run.acquisition, run.http_status, run.bytes) == ("success", "http", 200, len(body))
    assert run.sha256 == hashlib.sha256(body).hexdigest()
    assert run.etag == '"e1"'
    assert (tmp_path / "raw" / run.raw_uri.removeprefix("raw://")).read_bytes() == body
    assert _current(writer_engine) == {("a", "1"), ("b", "2")}


def test_the_same_content_is_not_loaded_twice(echo: Echo, writer_engine: Engine) -> None:
    connector = echo()
    first = connector.run(live=True)
    second = connector.run(live=True)
    assert second.status == "not_modified"
    assert connector.fetches[1] is not None and connector.fetches[1].etag == '"e1"', (
        "conditional GET validators"
    )
    assert _count(writer_engine, "echo_obs") == 1
    raw = rows(writer_engine, "SELECT raw_uri, sha256 FROM tda.fetch_run WHERE id = :i", i=second.run_id)[0]
    assert raw.raw_uri is None
    assert (
        raw.sha256
        == rows(writer_engine, "SELECT sha256 FROM tda.fetch_run WHERE id = :i", i=first.run_id)[0][0]
    )


def test_a_304_is_not_modified(echo: Echo, writer_engine: Engine) -> None:
    connector = echo()
    connector.run(live=True)
    connector.not_modified = True
    outcome = connector.run(live=True)
    assert outcome.status == "not_modified"
    assert (
        rows(writer_engine, "SELECT http_status FROM tda.fetch_run WHERE id = :i", i=outcome.run_id)[0][0]
        == 304
    )


def test_changed_content_appends_and_the_current_view_moves(echo: Echo, writer_engine: Engine) -> None:
    connector = echo(payload={"items": [{"name": "a", "value": "1"}]})
    connector.run(live=True)
    connector.payload = {"items": [{"name": "a", "value": "2"}]}
    assert connector.run(live=True).status == "success"
    assert _count(writer_engine, "echo_obs") == 2, "the earlier observation is kept"
    assert _current(writer_engine) == {("a", "2")}


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (RobotsDisallowed("robots.txt says no"), "skipped_robots"),
        (BudgetExceeded("spent"), "skipped_budget"),
        (FetchError("HTTP 500 from https://echo.test/feed"), "failed"),
        (RuntimeError("connector bug"), "failed"),
    ],
)
def test_fetch_problems_become_statuses(
    echo: Echo, writer_engine: Engine, error: Exception, status: str
) -> None:
    connector = echo()
    connector.fail_with = error
    outcome = connector.run(live=True)
    assert outcome.status == status
    recorded = rows(
        writer_engine, "SELECT error, finished_at FROM tda.fetch_run WHERE id = :i", i=outcome.run_id
    )[0]
    assert str(error) in recorded.error and recorded.finished_at is not None
    assert _count(writer_engine, "echo_obs") == 0


def test_a_spent_budget_skips_the_run(echo: Echo) -> None:
    connector = echo()
    connector.budget = RequestBudget(limit=0)
    assert connector.run(live=True).status == "skipped_budget"


def test_invalid_data_fails_the_run_loads_nothing_and_keeps_the_evidence(
    echo: Echo, writer_engine: Engine, tmp_path: Path
) -> None:
    outcome = echo(payload={"items": [{"value": "no name"}]}).run(live=True)
    assert outcome.status == "failed"
    run = rows(writer_engine, "SELECT error, raw_uri FROM tda.fetch_run WHERE id = :i", i=outcome.run_id)[0]
    assert run.error.startswith("ValidationFailed")
    assert (tmp_path / "raw" / run.raw_uri.removeprefix("raw://")).exists()
    assert _count(writer_engine, "echo_obs") == 0


def test_a_load_that_fails_halfway_leaves_no_rows(echo: Echo, writer_engine: Engine) -> None:
    connector = echo(payload={"items": [{"name": n, "value": "1"} for n in "abc"]})
    connector.fail_load_after = 2
    assert connector.run(live=True).status == "failed"
    assert _count(writer_engine, "echo_obs") == 0


def test_store_policy_none_keeps_no_body(echo: Echo, writer_engine: Engine, tmp_path: Path) -> None:
    outcome = echo(store_policy="none").run(live=True)
    assert outcome.status == "success"
    run = rows(writer_engine, "SELECT raw_uri, sha256 FROM tda.fetch_run WHERE id = :i", i=outcome.run_id)[0]
    assert run.raw_uri is None and run.sha256
    assert not (tmp_path / "raw").exists()


# Manual acquisition


def _inbox_file(tmp_path: Path, meta: dict | None) -> Path:
    path = tmp_path / "inbox" / "export.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"items": [{"name": "m", "value": "9"}]}))
    if meta is not None:
        path.with_name("export.json.meta.yaml").write_text(json.dumps(meta))
    return path


def test_a_manual_file_is_ingested_with_its_provenance(
    echo: Echo, writer_engine: Engine, tmp_path: Path
) -> None:
    connector = echo()
    path = _inbox_file(
        tmp_path, {"supplied_by": "Jane at CARTA", "original_url": "https://agency.test/export"}
    )
    outcome = connector.run_manual(path)
    assert outcome.status == "success"
    assert connector.fetches == [], "no network for a supplied file"
    run = rows(
        writer_engine,
        "SELECT acquisition, supplied_by, original_url, http_status FROM tda.fetch_run WHERE id = :i",
        i=outcome.run_id,
    )[0]
    assert tuple(run) == ("manual", "Jane at CARTA", "https://agency.test/export", None)
    assert _current(writer_engine) == {("m", "9")}
    assert connector.run_manual(path).status == "not_modified"


def test_a_manual_file_needs_its_sidecar(echo: Echo, writer_engine: Engine, tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="meta.yaml"):
        echo().run_manual(_inbox_file(tmp_path, None))
    assert _runs(writer_engine) == []


def test_the_sidecar_is_strict(echo: Echo, tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        echo().run_manual(_inbox_file(tmp_path, {"supplied_by": "x", "surprise": True}))
    with pytest.raises(ValidationError):
        echo().run_manual(_inbox_file(tmp_path, {"original_url": "https://agency.test/"}))


def test_a_manual_file_for_a_proposed_source_is_skipped(
    echo: Echo, writer_engine: Engine, tmp_path: Path
) -> None:
    connector = echo(approved=False)
    outcome = connector.run_manual(_inbox_file(tmp_path, {"supplied_by": "Jane"}))
    assert outcome.status == "skipped_disabled"
    assert rows(writer_engine, "SELECT acquisition, supplied_by FROM tda.fetch_run")[0] == ("manual", "Jane")


# Observation helper


def test_insert_observations_dedupes_within_a_run_and_rejects_bad_rows(
    echo: Echo, writer_engine: Engine
) -> None:
    run_id = echo().run(live=True).run_id
    with writer_engine.begin() as connection:
        batch = [{"name": "x", "value": "1"}, {"name": "x", "value": "1"}, {"name": "y", "value": "1"}]
        assert insert_observations(connection, "echo_obs", batch, run_id) == 2
        with pytest.raises(ValueError, match="may not set"):
            insert_observations(connection, "echo_obs", [{"name": "z", "content_hash": "h"}], run_id)
        with pytest.raises(ValueError, match="same columns"):
            insert_observations(connection, "echo_obs", [{"name": "z"}, {"name": "z", "value": "2"}], run_id)
        with pytest.raises(ValueError, match="identifier"):
            insert_observations(connection, "echo_obs; drop", [{"name": "z"}], run_id)
        hashes = (
            connection.execute(text("SELECT content_hash FROM tda.echo_obs WHERE name = 'x'")).scalars().all()
        )
    assert hashes == [content_hash({"value": "1", "name": "x"})]
