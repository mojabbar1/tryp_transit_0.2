"""Review queue (P2 T7): the 02 §7.4 state machine, fact versions, and source proposals (enable nothing)."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError
from sqlalchemy import Connection, Engine, text

from tda.config.models import Source
from tda.config.registry import load_sources
from tda.facts.versions import FactDraft, FactStateError, approve_fact, write_fact
from tda.review.queue import ReviewError, approve, list_items, reject, show, submit, to_markdown
from tests.db.conftest import rows


def _draft(key: str = "carta.upt.2025", value: int = 100) -> FactDraft:
    return FactDraft(key=key, created_by="connector", derived_from={"input_run_ids": []}, value_num=value)


def _status(connection: Connection, fact_id: int) -> str:
    return connection.execute(text("SELECT status FROM tda.fact WHERE id = :i"), {"i": fact_id}).scalar_one()


def test_approving_a_fact_item_approves_the_fact(writer_engine: Engine, tmp_path: Path) -> None:
    with writer_engine.begin() as connection:
        fact = write_fact(connection, _draft())
        item = submit(connection, "fact", str(fact), requested_by="agent")
        assert [i.id for i in list_items(connection)] == [item]
        decided = approve(connection, item, "maintainer", proposals_dir=tmp_path)
        assert (decided.status, decided.decided_by) == ("approved", "maintainer")
        reviewed = connection.execute(
            text("SELECT status, reviewed_by, reviewed_at FROM tda.fact WHERE id = :i"), {"i": fact}
        ).one()
    assert (reviewed.status, reviewed.reviewed_by) == ("approved", "maintainer") and reviewed.reviewed_at


def test_rejecting_needs_a_reason_and_rejects_the_fact(writer_engine: Engine) -> None:
    with writer_engine.begin() as connection:
        fact = write_fact(connection, _draft())
        item = submit(connection, "fact", str(fact), requested_by="agent")
        with pytest.raises(ReviewError, match="reason"):
            reject(connection, item, "maintainer", notes="  ")
        decided = reject(connection, item, "maintainer", notes="wrong period")
        assert (decided.status, decided.notes, _status(connection, fact)) == (
            "rejected",
            "wrong period",
            "rejected",
        )


def test_illegal_transitions_are_refused(writer_engine: Engine, tmp_path: Path) -> None:
    with writer_engine.begin() as connection:
        fact = write_fact(connection, _draft())
        item = submit(connection, "fact", str(fact), requested_by="agent")
        with pytest.raises(ReviewError, match="already has pending"):
            submit(connection, "fact", str(fact), requested_by="agent")
        approve(connection, item, "maintainer", proposals_dir=tmp_path)
        with pytest.raises(ReviewError, match="already approved"):
            approve(connection, item, "maintainer", proposals_dir=tmp_path)
        with pytest.raises(ReviewError, match="already approved"):
            reject(connection, item, "maintainer", notes="too late")
        with pytest.raises(ReviewError, match="only candidate or needs_review"):
            submit(connection, "fact", str(fact), requested_by="agent")
        with pytest.raises(ReviewError, match="missing"):
            submit(connection, "fact", "999999", requested_by="agent")
        with pytest.raises(ReviewError, match="fact id"):
            submit(connection, "fact", "carta.upt", requested_by="agent")
        with pytest.raises(ReviewError, match="unknown kind"):
            submit(connection, "vote", "x", requested_by="agent")  # type: ignore[arg-type]
        with pytest.raises(ReviewError, match="no review item"):
            show(connection, 424242)


def test_a_decided_item_is_frozen_by_the_database_too(writer_engine: Engine, tmp_path: Path) -> None:
    with writer_engine.begin() as connection:
        item = submit(connection, "report", "2026-W39", requested_by="agent")
        approve(connection, item, "maintainer", proposals_dir=tmp_path)
    with writer_engine.connect() as connection, pytest.raises(Exception, match="already approved"):
        connection.execute(text("UPDATE tda.review_item SET status = 'rejected' WHERE id = :i"), {"i": item})


def test_a_correction_is_a_new_version_that_supersedes_on_approval(
    writer_engine: Engine, tmp_path: Path
) -> None:
    with writer_engine.begin() as connection:
        v1 = write_fact(connection, _draft(value=100), auto_publish=True)
        v2 = write_fact(connection, _draft(value=101))
        v1_row, v2_row = (
            connection.execute(
                text("SELECT version, supersedes_id, status FROM tda.fact WHERE id = :i"), {"i": i}
            ).one()
            for i in (v1, v2)
        )
        assert tuple(v1_row) == (1, None, "approved")
        assert tuple(v2_row) == (2, v1, "candidate")
        approve(
            connection, submit(connection, "fact", str(v2), requested_by="agent"), "m", proposals_dir=tmp_path
        )
        assert (_status(connection, v1), _status(connection, v2)) == ("superseded", "approved")
        reviewer = connection.execute(
            text("SELECT reviewed_by FROM tda.fact WHERE id = :i"), {"i": v1}
        ).scalar_one()
        assert reviewer == "rule:auto_publish", "superseding keeps the original decision"


def test_an_older_version_cannot_replace_a_newer_published_one(writer_engine: Engine) -> None:
    with writer_engine.begin() as connection:
        v1 = write_fact(connection, _draft(value=1))
        write_fact(connection, _draft(value=2), auto_publish=True)
        with pytest.raises(FactStateError, match="newer"):
            approve_fact(connection, v1, "m")


def test_needs_review_can_be_approved_again(writer_engine: Engine, tmp_path: Path) -> None:
    with writer_engine.begin() as connection:
        fact = write_fact(connection, _draft(), auto_publish=True)
        connection.execute(text("UPDATE tda.fact SET status = 'needs_review' WHERE id = :i"), {"i": fact})
        approve(
            connection,
            submit(connection, "fact", str(fact), requested_by="rollback"),
            "m",
            proposals_dir=tmp_path,
        )
        assert _status(connection, fact) == "approved"


def test_a_draft_needs_lineage_and_a_value() -> None:
    with pytest.raises(ValueError, match="input_run_ids"):
        FactDraft(key="k", created_by="human", derived_from={}, value_num=1)
    with pytest.raises(ValueError, match="value"):
        FactDraft(key="k", created_by="human", derived_from={"input_run_ids": [1]})


# Sources: approval by PR only


def _proposal(source_id: str = "new-feed") -> dict:
    return {
        "id": source_id,
        "catalog_id": "S-99",
        "name": "A new feed",
        "kind": "rest",
        "url": "https://feeds.example.test/new.json",
        "store_policy": "ttl:30d",
        "store_policy_reason": "open data",
        "owner": "mojabbar",
    }


def test_approving_a_source_proposal_writes_a_suggestion_and_enables_nothing(
    writer_engine: Engine, tmp_path: Path
) -> None:
    sources_yaml = load_sources()
    with writer_engine.begin() as connection:
        item = submit(connection, "source", "new-feed", requested_by="agent", payload=_proposal())
        approve(connection, item, "maintainer", proposals_dir=tmp_path)
    written = tmp_path / "sources" / "new-feed.yaml"
    content = written.read_text(encoding="utf-8")
    assert "enables nothing" in content and f"#{item}" in content
    (entry,) = yaml.safe_load(content)
    assert Source.model_validate(entry).status == "proposed"
    assert rows(writer_engine, "SELECT count(*) FROM tda.source")[0][0] == 0, (
        "nothing reaches the source table"
    )
    assert load_sources() == sources_yaml, "sources.yaml is untouched"


def test_a_source_proposal_is_validated_and_never_overwrites(writer_engine: Engine, tmp_path: Path) -> None:
    with writer_engine.begin() as connection:
        with pytest.raises(ValidationError):
            submit(connection, "source", "bad", requested_by="agent", payload={"id": "bad"})
        with pytest.raises(ReviewError, match="not other"):
            submit(connection, "source", "other", requested_by="agent", payload=_proposal())
        first = submit(connection, "source", "new-feed", requested_by="agent", payload=_proposal())
        approve(connection, first, "maintainer", proposals_dir=tmp_path)
        second = submit(connection, "source", "new-feed", requested_by="agent", payload=_proposal())
    with writer_engine.begin() as connection, pytest.raises(ReviewError, match="already exists"):
        approve(connection, second, "maintainer", proposals_dir=tmp_path)
    with writer_engine.connect() as connection:
        assert show(connection, second).status == "pending", "the failed approval changed nothing"


def test_a_rejected_proposal_writes_nothing(writer_engine: Engine, tmp_path: Path) -> None:
    with writer_engine.begin() as connection:
        item = submit(connection, "source", "new-feed", requested_by="agent", payload=_proposal())
        reject(connection, item, "maintainer", notes="terms unclear")
    assert not (tmp_path / "sources").exists()


def test_list_filters_and_exports_markdown(writer_engine: Engine, tmp_path: Path) -> None:
    with writer_engine.begin() as connection:
        a = submit(connection, "report", "2026-W39", requested_by="agent")
        b = submit(connection, "campaign", "spring|push", requested_by="agent")
        approve(connection, a, "maintainer", proposals_dir=tmp_path, notes="ok")
        assert [i.id for i in list_items(connection)] == [b]
        assert [i.id for i in list_items(connection, status=None)] == [a, b]
        assert [i.id for i in list_items(connection, status=None, kind="report")] == [a]
        markdown = to_markdown(list_items(connection, status=None))
    assert markdown.splitlines()[0].startswith("| # | Kind")
    assert f"| {a} | report | 2026-W39 | approved | agent | maintainer | ok |" in markdown
    assert "| spring\\|push |" in markdown, "a pipe in any cell is escaped"
