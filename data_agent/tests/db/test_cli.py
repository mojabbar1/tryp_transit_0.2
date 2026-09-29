"""The ``tda`` CLI end to end against Postgres (P2 T9), including the DoD's no-network skipped_disabled."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
import respx
from click.testing import Result
from sqlalchemy import Engine
from typer.testing import CliRunner

from tda.cli import app
from tda.config.models import SourceRegistry
from tda.config.settings import get_settings
from tda.connectors import registry as connector_registry
from tda.http import polite_client
from tda.pipelines import scheduler
from tests.conftest import DbUrls
from tests.db.conftest import rows
from tests.support.echo import EchoConnector
from tests.support.factories import APPROVAL, make_source

Invoke = Callable[..., Result]


@pytest.fixture
def invoke(db: DbUrls, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Invoke]:
    """Run ``tda <args>`` with the test database's URLs; settings are re-read for every call."""
    env = {
        "TDA_ADMIN_DATABASE_URL": db.admin,
        "TDA_DATABASE_URL": db.writer,
        "TDA_READER_DATABASE_URL": db.reader,
        "TDA_RAW_STORE_DIR": str(tmp_path / "raw"),
    }
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    runner = CliRunner()

    def run(*args: str) -> Result:
        get_settings.cache_clear()
        try:
            return runner.invoke(app, list(args), catch_exceptions=False)
        finally:
            get_settings.cache_clear()

    yield run
    get_settings.cache_clear()


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[respx.MockRouter]:
    """Any HTTP request, or even building the polite client, fails the test."""

    def refuse(*_: object, **__: object) -> None:
        raise AssertionError("the polite client must not be created")

    monkeypatch.setattr(polite_client.PoliteClient, "__init__", refuse)
    with respx.mock(assert_all_called=False) as router:
        yield router
    assert not router.calls


def test_ingest_of_a_proposed_source_is_skipped_disabled_with_no_network(
    invoke: Invoke, writer_engine: Engine, no_network: respx.MockRouter
) -> None:
    for args in (("ingest", "tricounty-link-gtfs"), ("ingest", "tricounty-link-gtfs", "--live")):
        result = invoke(*args)
        assert result.exit_code == 0, result.output
        assert "tricounty-link-gtfs: skipped_disabled" in result.stdout
    assert [tuple(r) for r in rows(writer_engine, "SELECT source_id, status FROM tda.fetch_run")] == [
        ("tricounty-link-gtfs", "skipped_disabled"),
        ("tricounty-link-gtfs", "skipped_disabled"),
    ]


def test_ingest_refuses_unknown_sources_and_approved_ones_without_a_connector(
    invoke: Invoke, monkeypatch: pytest.MonkeyPatch, no_network: respx.MockRouter
) -> None:
    result = invoke("ingest", "no-such-source")
    assert (result.exit_code, "no source 'no-such-source'" in result.stderr) == (2, True)
    approved = SourceRegistry(sources=[make_source(id="lonely", **APPROVAL)])
    monkeypatch.setattr("tda.connectors.cli.load_sources", lambda settings=None: approved)
    result = invoke("ingest", "lonely", "--live")
    assert result.exit_code == 2 and "no registered connector" in result.stderr


@pytest.fixture
def echo_cli(echo: Callable[..., EchoConnector], monkeypatch: pytest.MonkeyPatch) -> None:
    """An approved ``echo`` source whose connector is registered only for this test."""
    echo()  # creates tda.echo_obs
    registry = SourceRegistry(sources=[make_source(id="echo", **APPROVAL)])
    for module in ("tda.connectors.cli", "tda.config.cli", "tda.store.cli"):
        monkeypatch.setattr(f"{module}.load_sources", lambda settings=None: registry)
    monkeypatch.setitem(connector_registry.CONNECTORS, "echo", EchoConnector)
    monkeypatch.setattr(polite_client.PoliteClient, "__init__", lambda self, settings, **_: None)
    monkeypatch.setattr(polite_client.PoliteClient, "close", lambda self: None)


def test_ingest_runs_and_rollback_through_the_cli(
    invoke: Invoke, echo_cli: None, writer_engine: Engine
) -> None:
    offline = invoke("ingest", "echo")
    assert "echo: not_live" in offline.stdout and "--live" in offline.stdout
    live = invoke("ingest", "echo", "--live")
    assert live.exit_code == 0 and "echo: success (run 1)" in live.stdout, live.output
    assert "echo" in invoke("runs", "list").stdout
    assert "sha256" in invoke("runs", "show", "1").stdout
    assert invoke("runs", "rollback", "1").exit_code == 2, "needs --dry-run or --confirm"
    dry = invoke("runs", "rollback", "1", "--dry-run")
    assert "would roll back" in dry.stdout and "tda.echo_obs: 1 row(s)" in dry.stdout
    assert rows(writer_engine, "SELECT status FROM tda.fetch_run WHERE id = 1")[0][0] == "success"
    done = invoke("runs", "rollback", "1", "--confirm")
    assert "rolled back" in done.stdout
    assert rows(writer_engine, "SELECT status FROM tda.fetch_run WHERE id = 1")[0][0] == "rolled_back"
    assert rows(writer_engine, "SELECT count(*) FROM tda.echo_obs")[0][0] == 1, "nothing deleted"
    again = invoke("runs", "rollback", "1", "--confirm")
    assert again.exit_code == 2 and "only a success run" in again.stderr


def test_sources_sync_validate_and_list(invoke: Invoke, writer_engine: Engine) -> None:
    assert "25 sources OK" in invoke("sources", "validate").stdout
    listed = invoke("sources", "list").stdout
    assert "25 sources: 4 approved, 21 proposed" in listed
    synced = invoke("sources", "sync")
    assert synced.exit_code == 0 and "carta-gtfs" in synced.stdout
    assert rows(writer_engine, "SELECT count(*) FROM tda.source WHERE status = 'proposed'")[0][0] == 21
    assert "inserted: -" in invoke("sources", "sync").stdout, "a second sync changes nothing"


def test_review_through_the_cli(invoke: Invoke, writer_engine: Engine, tmp_path: Path) -> None:
    from tda.review.queue import submit

    with writer_engine.begin() as connection:
        first = submit(connection, "report", "2026-W39", requested_by="agent")
        second = submit(connection, "report", "2026-W40", requested_by="agent")
    assert "2026-W39" in invoke("review", "list").stdout
    assert "| # | Kind" in invoke("review", "list", "--markdown").stdout
    assert "payload:" in invoke("review", "show", str(first)).stdout
    assert "approved by alice" in invoke("review", "approve", str(first), "--by", "alice").stdout
    assert invoke("review", "reject", str(second)).exit_code == 2, "--notes is required"
    assert (
        "rejected by bob" in invoke("review", "reject", str(second), "--notes", "dup", "--by", "bob").stdout
    )
    assert "already approved" in invoke("review", "approve", str(first)).stderr
    assert "nothing to review" in invoke("review", "list").stdout


def test_db_commands_bootstrap_idempotently_and_guard_downgrade(invoke: Invoke) -> None:
    result = invoke("db", "bootstrap")
    assert result.exit_code == 0 and "schema tda owned by tda_owner" in result.stdout
    assert "upgraded to head" in invoke("db", "upgrade").stdout
    refused = invoke("db", "downgrade")
    assert refused.exit_code == 2 and "--confirm" in refused.stderr


def test_retention_and_scheduler_once(invoke: Invoke, monkeypatch: pytest.MonkeyPatch) -> None:
    result = invoke("retention", "run", "--dry-run", "--source", "carta-gtfs")
    assert result.exit_code == 0 and "carta-gtfs (ttl:180d): would delete 0" in result.stdout
    real, ran = scheduler.run_job, []

    def run_job(settings: Any, registry: Any, job: Any, client: Any) -> None:
        # An approved source's ingest job would fetch live; it's recorded, not run. Retention and metrics run.
        ran.append(job.name)
        if job.source is None:
            real(settings, registry, job, client)

    monkeypatch.setattr(scheduler, "run_job", run_job)
    with respx.mock(assert_all_called=False) as router:
        once = invoke("scheduler", "run", "--once")
    assert not router.calls, "no network"
    assert once.exit_code == 0 and "scheduler: 4 ingest job(s)" in once.stdout
    assert ran == [
        "ingest:carta-gtfs",
        "ingest:carta-gtfs-rt-alerts",
        "ingest:ntd-monthly",
        "ingest:eia-gas",
        "retention",
        "metrics",
    ]


def test_api_openapi_writes_the_snapshot(
    invoke: Invoke, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TDA_PROJECT_ROOT", str(tmp_path / "data_agent"))
    result = invoke("api", "openapi")
    assert result.exit_code == 0
    assert (tmp_path / "contracts" / "data-agent.openapi.json").is_file()
