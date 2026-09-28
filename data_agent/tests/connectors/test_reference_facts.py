"""Reference facts (P3.5): the committed file, the evidence rules, and loading candidates for human review."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import Engine
from typer.testing import CliRunner

from tda.api.app import create_app
from tda.cli import app
from tda.config.models import SourceRegistry
from tda.config.registry import load_sources
from tda.config.settings import get_settings
from tda.facts.reference import DEFAULT_FILE, ReferenceFile, check_sources, load_reference, read_reference
from tda.review import queue
from tests.conftest import DbUrls
from tests.support.db import rows
from tests.support.factories import make_source

REPO = Path(__file__).resolve().parents[3]
DECISIONS = REPO / "docs" / "transit-data-agent" / "05-decisions-and-review.md"
REGISTRY = SourceRegistry(sources=[make_source(id="test-src", attribution_text="Test attribution")])


def _assumption_keys() -> set[str]:
    text = DECISIONS.read_text(encoding="utf-8")
    table = text[text.index("## 2. Assumptions table") : text.index("## 2a.")]
    return {m.group(1) for m in re.finditer(r"^\| `([a-z0-9_.]+)`", table, flags=re.M)}


# The committed file (no database)


def test_the_committed_file_covers_every_05_assumption_and_its_sources_exist() -> None:
    reference, _ = read_reference()
    keys = {entry.key for entry in reference.facts}
    expected = _assumption_keys()
    assert len(expected) >= 16
    for key in expected:
        assert key in keys or any(k.startswith(f"{key}.") for k in keys), f"{key} has no reference entry"
    check_sources(reference, load_sources())
    for entry in reference.facts:
        if not entry.filled:
            assert entry.todo, f"{entry.key}: an empty entry says where to verify it"


def _file(tmp_path: Path, *entries: dict[str, Any]) -> Path:
    path = tmp_path / "reference.yaml"
    path.write_text(yaml.safe_dump({"facts": list(entries)}), encoding="utf-8")
    return path


FILLED = {
    "key": "fixture.speed_kmh",
    "value": 42,
    "unit": "km/h (synthetic)",
    "source_id": "test-src",
    "url": "https://example.test/source",
    "quote": "a synthetic quote",
    "retrieved_at": "2026-09-27",
    "verified_by": "tester",
}
DECISION = {
    "key": "fixture.policy",
    "value_text": "a synthetic decision",
    "url": "https://example.test/decisions",
    "page": "§2",
    "retrieved_at": "2026-09-27",
    "verified_by": "tester",
}
EMPTY = {
    "key": "fixture.empty",
    "value": None,
    "url": "https://example.test/",
    "todo": "verify from somewhere",
}


@pytest.mark.parametrize(
    ("entry", "message"),
    [
        ({**FILLED, "quote": None}, "needs quote or page"),
        ({**FILLED, "retrieved_at": None}, "needs retrieved_at"),
        ({**FILLED, "verified_by": None}, "needs verified_by"),
        ({**FILLED, "value_text": "also text"}, "not both"),
        ({**FILLED, "key": "NoDots"}, "String should match pattern"),
        ({**FILLED, "period_start": "2026-02-01", "period_end": "2026-01-01"}, "period_start is after"),
        ({**FILLED, "surprise": 1}, "Extra inputs"),
        ({**FILLED, "url": "not a url"}, "valid URL"),
    ],
)
def test_filled_entries_need_their_evidence(entry: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        ReferenceFile.model_validate({"facts": [entry]})


def test_duplicate_keys_and_unknown_sources_are_refused(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="duplicate keys: fixture.speed_kmh"):
        ReferenceFile.model_validate({"facts": [FILLED, FILLED]})
    reference, _ = read_reference(_file(tmp_path, {**FILLED, "source_id": "nope"}))
    with pytest.raises(ValueError, match="unknown source_id in reference facts: nope"):
        check_sources(reference, REGISTRY)


# Loading (Postgres)


def _load(engine: Engine, path: Path) -> Any:
    with engine.begin() as connection:
        return load_reference(connection, REGISTRY, path, requested_by="tester")


def test_filled_entries_become_candidates_with_review_items(writer_engine: Engine, tmp_path: Path) -> None:
    report = _load(writer_engine, _file(tmp_path, FILLED, DECISION, EMPTY))
    assert (report.loaded, report.skipped) == (["fixture.speed_kmh", "fixture.policy"], ["fixture.empty"])
    facts = rows(
        writer_engine,
        "SELECT key, value_num, value_text, status, created_by, source_ids, evidence FROM tda.fact",
    )
    by_key = {f.key: f for f in facts}
    assert (by_key["fixture.speed_kmh"].value_num, by_key["fixture.speed_kmh"].status) == (42, "candidate")
    assert by_key["fixture.speed_kmh"].created_by == "human"
    assert by_key["fixture.speed_kmh"].evidence == {
        "url": "https://example.test/source",
        "quote": "a synthetic quote",
        "retrieved_at": "2026-09-27",
        "verified_by": "tester",
    }
    assert (
        by_key["fixture.policy"].value_text == "a synthetic decision"
        and by_key["fixture.policy"].source_ids == []
    )
    items = rows(writer_engine, "SELECT kind, status, requested_by FROM tda.review_item")
    assert [tuple(i) for i in items] == [("fact", "pending", "tester")] * 2
    assert rows(writer_engine, "SELECT id FROM tda.source")[0][0] == "test-src", (
        "the cited source is mirrored"
    )


def test_reloading_is_idempotent_and_changes_make_new_versions(writer_engine: Engine, tmp_path: Path) -> None:
    _load(writer_engine, _file(tmp_path, FILLED))
    again = _load(writer_engine, _file(tmp_path, FILLED))
    assert (again.loaded, again.unchanged) == ([], ["fixture.speed_kmh"])
    changed = _load(writer_engine, _file(tmp_path, {**FILLED, "value": 43}))
    assert changed.loaded == ["fixture.speed_kmh"]
    versions = rows(
        writer_engine, "SELECT version, value_num, supersedes_id IS NOT NULL FROM tda.fact ORDER BY version"
    )
    assert [tuple(v) for v in versions] == [(1, 42, False), (2, 43, True)]
    assert rows(writer_engine, "SELECT count(*) FROM tda.review_item")[0][0] == 2


def test_a_rejected_value_is_not_queued_again(writer_engine: Engine, tmp_path: Path) -> None:
    _load(writer_engine, _file(tmp_path, FILLED))
    with writer_engine.begin() as connection:
        (item,) = queue.list_items(connection)
        queue.reject(connection, item.id, "reviewer", notes="wrong page")
    assert _load(writer_engine, _file(tmp_path, FILLED)).unchanged == ["fixture.speed_kmh"]
    assert rows(writer_engine, "SELECT count(*) FROM tda.review_item WHERE status = 'pending'")[0][0] == 0


def test_an_approved_reference_fact_is_served_with_attribution(
    db: DbUrls, writer_engine: Engine, tmp_path: Path
) -> None:
    _load(writer_engine, _file(tmp_path, FILLED))
    reader = db.engine("reader")
    with TestClient(create_app(engine=reader)) as client:
        assert client.get("/v1/facts").json()["items"] == [], "a candidate is never served"
        with writer_engine.begin() as connection:
            (item,) = queue.list_items(connection)
            queue.approve(connection, item.id, "reviewer", proposals_dir=tmp_path)
        (fact,) = client.get("/v1/facts").json()["items"]
    reader.dispose()
    assert (fact["key"], fact["value_num"], fact["status"]) == ("fixture.speed_kmh", 42, "approved")
    assert fact["sources"] == [
        {"source_id": "test-src", "attribution": "Test attribution", "retrieved": None}
    ]
    assert fact["evidence"]["quote"] == "a synthetic quote"


def test_the_cli_checks_and_loads(db: DbUrls, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TDA_DATABASE_URL", db.writer)
    monkeypatch.setattr("tda.facts.cli.load_sources", lambda settings=None: REGISTRY)
    path = _file(tmp_path, FILLED, EMPTY)
    get_settings.cache_clear()
    try:
        check = CliRunner().invoke(app, ["facts", "load-reference", "--file", str(path), "--check"])
        load = CliRunner().invoke(app, ["facts", "load-reference", "--file", str(path), "--by", "tester"])
    finally:
        get_settings.cache_clear()
    assert check.exit_code == 0 and "2 entries, 1 filled" in check.stdout
    assert load.exit_code == 0 and "queued for review: fixture.speed_kmh" in load.stdout
    assert "skipped (no value yet): 1" in load.stdout


def test_the_default_file_is_the_committed_one() -> None:
    assert DEFAULT_FILE.name == "reference_facts.yaml" and DEFAULT_FILE.is_file()
