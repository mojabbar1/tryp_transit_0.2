"""Real runtime and reader-grant checks, only against the existing disposable *_test fixtures."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError
from typer.testing import CliRunner

from tda.agent.queries import QueryService
from tda.agent.report import ReportError, Window, packet_digest
from tda.agent.runtime import run
from tda.cli import app
from tda.config.settings import get_settings
from tda.facts.rules.eia_gas import KEY, UNIT
from tda.facts.versions import FactDraft, write_fact
from tda.review.queue import show
from tda.store.sources import upsert_source
from tests.conftest import DbUrls
from tests.support.factories import APPROVAL, make_source
from tests.support.feeds import LoadFeed, edited, r1_trip
from tests.unit.test_report import fixture_plan

DAY = date(2026, 9, 28)
WINDOW = Window(start=DAY, end=DAY)


@pytest.fixture
def query(db: DbUrls) -> Iterator[QueryService]:
    engine = db.engine("reader")
    yield QueryService(engine)
    engine.dispose()


@pytest.fixture
def fuel(writer_engine: Engine) -> FactDraft:
    with writer_engine.begin() as connection:
        upsert_source(
            connection, make_source(id="eia-gas", cadence="0 0 * * *", stale_after_hours=24, **APPROVAL)
        )
        run_id = connection.execute(
            text(
                "INSERT INTO tda.fetch_run (source_id, acquisition, status, finished_at) "
                "VALUES ('eia-gas', 'http', 'success', now() - interval '2 hours') RETURNING id"
            )
        ).scalar_one()
        draft = FactDraft(
            key=KEY,
            created_by="connector",
            value_num=8.765,
            unit=UNIT,
            geography="region:padd-1c",
            period_start=DAY,
            period_end=DAY,
            method="synthetic_eia_rule",
            source_ids=["eia-gas"],
            derived_from={"input_run_ids": [run_id]},
        )
        write_fact(connection, draft, auto_publish=True)
    return draft


def counts(writer: Engine) -> tuple:
    with writer.connect() as connection:
        return tuple(
            connection.execute(
                text(
                    "SELECT (SELECT count(*) FROM tda.review_item), (SELECT count(*) FROM tda.agent_run), "
                    "(SELECT count(*) FROM tda.fact), (SELECT count(*) FROM tda.metric_value)"
                )
            ).one()
        )


def test_prepare_and_dry_run_read_only_then_pending(
    query: QueryService,
    writer_engine: Engine,
    fuel: FactDraft,
) -> None:
    before = counts(writer_engine)
    packet = query.export(WINDOW)
    plan = fixture_plan(packet)
    item_id, dry = run(query, packet, plan)
    assert item_id is None and "8.765" in dry
    assert counts(writer_engine) == before
    item_id, draft = run(query, packet, plan, writer=writer_engine)
    with writer_engine.connect() as connection:
        item = show(connection, item_id)
        assert item.status == "pending" and item.decided_by is None
        assert item.requested_by == "copilot-assisted-report-runtime"
        assert item.payload["markdown"] == draft
        audit = connection.execute(
            text("SELECT provider, input_tokens, output_tokens, cost_usd, output_ref FROM tda.agent_run")
        ).one()
        assert audit.provider == "copilot-assisted"
        assert audit.input_tokens is None and audit.output_tokens is None and audit.cost_usd == 0
        assert audit.output_ref == f"review_item:{item_id}"
    assert counts(writer_engine) == (before[0] + 1, before[1] + 1, before[2], before[3])


@pytest.mark.parametrize(
    "mutation", ["needs_review", "rejected", "superseded", "source_disabled", "rollback"]
)
def test_changed_evidence_never_enters_queue(
    query: QueryService,
    writer_engine: Engine,
    fuel: FactDraft,
    mutation: str,
) -> None:
    packet = query.export(WINDOW)
    with writer_engine.begin() as connection:
        if mutation == "superseded":
            write_fact(connection, replace(fuel, value_num=9.876), auto_publish=True)
        elif mutation == "source_disabled":
            connection.execute(text("UPDATE tda.source SET status = 'disabled' WHERE id = 'eia-gas'"))
        elif mutation == "rollback":
            connection.execute(text("UPDATE tda.fetch_run SET status = 'rolled_back'"))
        else:
            connection.execute(text("UPDATE tda.fact SET status = 'needs_review'"))
            if mutation == "rejected":
                connection.execute(text("UPDATE tda.fact SET status = 'rejected'"))
    with pytest.raises(ReportError, match="evidence_changed_or_unavailable"):
        run(query, packet, fixture_plan(packet), writer=writer_engine)
    assert counts(writer_engine)[:2] == (0, 0)


@pytest.mark.parametrize(
    "field,value",
    [
        ("phrase", "Wrong subject: 8.765 minutes"),
        ("period_end", date(2026, 10, 1)),
        ("unit", "minutes"),
        ("fact_id", 999999),
        ("geography", "another place"),
    ],
)
def test_rehashed_packet_cannot_forge_read_evidence(
    query: QueryService,
    writer_engine: Engine,
    fuel: FactDraft,
    field: str,
    value: object,
) -> None:
    packet = query.export(WINDOW)
    setattr(packet.evidence[0], field, value)
    packet.packet_hash = packet_digest(packet)
    with pytest.raises(ReportError, match="evidence_changed_or_unavailable"):
        run(query, packet, fixture_plan(packet), writer=writer_engine)
    assert counts(writer_engine)[:2] == (0, 0)


def test_wrong_attribution_or_old_packet(
    query: QueryService,
    writer_engine: Engine,
    fuel: FactDraft,
) -> None:
    packet = query.export(WINDOW)
    packet.sources[0].attribution = "Invented attribution"
    packet.packet_hash = packet_digest(packet)
    with pytest.raises(ReportError, match="evidence_changed"):
        run(query, packet, fixture_plan(packet), writer=writer_engine)
    packet = query.export(WINDOW)
    packet.generated_at -= timedelta(days=2)
    packet.packet_hash = packet_digest(packet)
    with pytest.raises(ReportError, match="packet_expired"):
        run(query, packet, fixture_plan(packet), writer=writer_engine)
    assert counts(writer_engine)[:2] == (0, 0)


def test_expired_fact_and_stale_source_not_exported(
    query: QueryService,
    writer_engine: Engine,
    fuel: FactDraft,
) -> None:
    with writer_engine.begin() as connection:
        write_fact(connection, replace(fuel, valid_until=date(2000, 1, 1)), auto_publish=True)
    assert not query.export(WINDOW).evidence
    with writer_engine.begin() as connection:
        write_fact(connection, replace(fuel, valid_until=None), auto_publish=True)
        connection.execute(text("UPDATE tda.source SET stale_after_hours = 1 WHERE id = 'eia-gas'"))
    assert not query.export(WINDOW).evidence


def test_requires_actual_reader_role_and_reader_cannot_write(
    query: QueryService,
    writer_engine: Engine,
) -> None:
    with pytest.raises(ReportError, match="reader_role_required"):
        QueryService(writer_engine).export(WINDOW)
    with query.engine.begin() as connection, pytest.raises(DBAPIError, match="permission denied"):
        connection.execute(
            text("INSERT INTO tda.review_item (kind, ref_id, requested_by) VALUES ('report', 'x', 'model')")
        )


def test_schema_failure_no_queue_and_no_untrusted_error_echo(
    query: QueryService,
    writer_engine: Engine,
    fuel: FactDraft,
    tmp_path: Path,
) -> None:
    packet = query.export(WINDOW)
    packet_path, plan_path = tmp_path / "packet.json", tmp_path / "plan.json"
    packet_path.write_text(packet.model_dump_json())
    plan = fixture_plan(packet).model_dump(mode="json")
    plan["mode"] = "DO-NOT-LOG-THIS-UNTRUSTED-STRING"
    plan_path.write_text(json.dumps(plan))
    result = CliRunner().invoke(
        app, ["report", "submit", "--packet", str(packet_path), "--plan", str(plan_path)]
    )
    assert result.exit_code == 2
    assert "plan_schema_invalid" in result.output and "DO-NOT-LOG" not in result.output
    assert counts(writer_engine)[:2] == (0, 0)


def test_submission_locks_corrections_until_commit(
    query: QueryService,
    writer_engine: Engine,
    fuel: FactDraft,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    packet = query.export(WINDOW)
    export = query.export

    def concurrent_export(*args: object, **kwargs: object):
        with writer_engine.begin() as other, pytest.raises(DBAPIError, match="lock timeout"):
            other.execute(text("SET LOCAL lock_timeout = '50ms'"))
            other.execute(text("UPDATE tda.source SET status = 'disabled' WHERE id = 'eia-gas'"))
        return export(*args, **kwargs)

    monkeypatch.setattr(query, "export", concurrent_export)
    run(query, packet, fixture_plan(packet), writer=writer_engine)


def test_service_citations_are_feed_pinned_and_read_only(
    query: QueryService,
    writer_engine: Engine,
    load_feed: LoadFeed,
) -> None:
    feed = load_feed(edited(trips=[r1_trip("T-extra", "08:00")]))
    before = counts(writer_engine)
    packet = query.export(WINDOW)
    service = [e for e in packet.evidence if e.kind == "scheduled_headway"]
    assert service and len(service) <= 12
    assert all(e.feed_version_id == feed.feed_version_id and e.period_start == DAY for e in service)
    assert all(e.input_run_ids == [feed.fetch_run_id] for e in service)
    assert counts(writer_engine) == before


def test_cli_prepare_submit_render_and_no_overwrite(
    db: DbUrls,
    writer_engine: Engine,
    fuel: FactDraft,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TDA_READER_DATABASE_URL", db.reader)
    monkeypatch.setenv("TDA_DATABASE_URL", db.writer)
    get_settings.cache_clear()
    runner = CliRunner()
    packet_path, plan_path, draft_path = (
        tmp_path / name for name in ("packet.json", "plan.json", "draft.md")
    )
    try:
        result = runner.invoke(
            app,
            [
                "report",
                "prepare",
                "--start",
                str(DAY),
                "--end",
                str(DAY),
                "--out",
                str(packet_path),
            ],
        )
        assert result.exit_code == 0, result.output
        from tda.agent.report import Packet

        packet = Packet.model_validate_json(packet_path.read_text())
        plan_path.write_text(fixture_plan(packet).model_dump_json())
        args = ["report", "submit", "--packet", str(packet_path), "--plan", str(plan_path)]
        assert runner.invoke(app, [*args, "--dry-run"]).exit_code == 0
        assert counts(writer_engine)[:2] == (0, 0)
        result = runner.invoke(app, args)
        assert result.exit_code == 0, result.output
        with writer_engine.connect() as connection:
            item_id = connection.execute(text("SELECT id FROM tda.review_item")).scalar_one()
        args = ["report", "render", str(item_id), "--out", str(draft_path)]
        assert runner.invoke(app, args).exit_code == 0
        assert draft_path.read_text().startswith("# DRAFT")
        assert runner.invoke(app, args).exit_code == 2
    finally:
        get_settings.cache_clear()
