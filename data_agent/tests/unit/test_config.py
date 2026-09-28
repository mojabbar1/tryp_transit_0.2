"""Config: settings, the region registry, and the source registry (P2 T2)."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from tda.config.models import Region, Source, SourceRegistry
from tda.config.registry import load_region, load_sources
from tda.config.settings import DEFAULT_USER_AGENT, PACKAGE_ROOT, Settings

DATA_AGENT = Path(__file__).resolve().parents[2]
REPO_ROOT = DATA_AGENT.parent


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in list(os.environ):
        if name.startswith("TDA_"):
            monkeypatch.delenv(name)


def test_project_root_is_the_package_parent_not_the_working_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolved = []
    for cwd in (REPO_ROOT, DATA_AGENT, DATA_AGENT / "tda"):
        monkeypatch.chdir(cwd)
        s = Settings()
        resolved.append((s.project_root, s.raw_store_dir, s.inbox_dir))
    assert len(set(resolved)) == 1
    assert PACKAGE_ROOT == DATA_AGENT
    assert resolved[0] == (DATA_AGENT, DATA_AGENT / "raw", DATA_AGENT / "inbox")


def test_raw_and_inbox_are_gitignored() -> None:
    result = subprocess.run(
        ["git", "check-ignore", "data_agent/raw/x", "data_agent/inbox/x"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["data_agent/raw/x", "data_agent/inbox/x"]


def test_relative_paths_resolve_under_the_project_root(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TDA_RAW_STORE_DIR", "snapshots")
    assert Settings().raw_store_dir == DATA_AGENT / "snapshots"
    monkeypatch.setenv("TDA_PROJECT_ROOT", "relative/root")
    with pytest.raises(ValidationError, match="absolute"):
        Settings()


def test_user_agent_needs_the_d18_contact(monkeypatch: pytest.MonkeyPatch) -> None:
    assert "https://github.com/mojabbar1/tryp_transit_0.2" in DEFAULT_USER_AGENT
    assert Settings().user_agent == DEFAULT_USER_AGENT
    monkeypatch.setenv("TDA_USER_AGENT", "TrypTransitDataAgent/0.1.0")
    with pytest.raises(ValidationError, match="contact"):
        Settings()
    monkeypatch.setenv("TDA_USER_AGENT", "TrypTransitDataAgent/0.1.0 (ops@example.org)")
    assert Settings().user_agent.endswith("(ops@example.org)")


@pytest.mark.parametrize("name", ["TDA_DATABASE_URL", "TDA_ADMIN_DATABASE_URL", "TDA_READER_DATABASE_URL"])
def test_database_urls_are_plain_postgres(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv(name, "postgresql+psycopg://tda_writer@localhost/tda")
    with pytest.raises(ValidationError, match="plain postgresql"):
        Settings()


def test_charleston_region_loads() -> None:
    region = load_region("charleston")
    assert region.timezone == "America/New_York"
    assert [a.ntd_id for a in region.agencies] == ["40110"]
    assert region.corridors and all(c.status == "draft" and c.probe_points == [] for c in region.corridors)


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"timezone": "Mars/Olympus_Mons"}, "unknown time zone"),
        ({"bbox": {"min_lon": -79.2, "min_lat": 32.4, "max_lon": -80.8, "max_lat": 33.5}}, "minimums"),
        ({"corridors": [{"id": "x", "name": "X", "description": "d", "status": "ready"}]}, "probe_points"),
    ],
)
def test_region_rejects_invalid_fixtures(patch: dict, message: str) -> None:
    data = yaml.safe_load((DATA_AGENT / "tda/config/regions/charleston.yaml").read_text()) | patch
    with pytest.raises(ValidationError, match=message):
        Region.model_validate(data)


# Sources whose 05 §6 row is signed and whose connector PR has merged. Each connector PR adds its own.
APPROVED = {"carta-gtfs"}


def test_only_signed_sources_are_approved() -> None:
    registry = load_sources()
    assert len(registry.sources) == 25
    assert {s.id for s in registry.sources if s.status == "approved"} == APPROVED
    assert {s.status for s in registry.sources if s.id not in APPROVED} == {"proposed"}
    assert all(s.terms_reviewed_by and s.terms_reviewed_at for s in registry.sources if s.id in APPROVED)
    assert "S-8" not in {s.catalog_id for s in registry.sources}
    assert all(s.robots_required for s in registry.sources if s.kind in ("html", "pdf"))


BASE = {
    "id": "example",
    "catalog_id": "S-99",
    "name": "Example",
    "kind": "rest",
    "url": "https://example.org/api",
    "store_policy": "ttl:180d",
    "store_policy_reason": "test",
    "owner": "test",
}


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"kind": "html", "robots_required": False}, "robots_required"),
        ({"store_policy": "forever"}, "store_policy"),
        ({"cadence": "every monday", "stale_after_hours": 24}, "cron|Wrong number of fields|fields"),
        ({"cadence": "0 9 * * *"}, "set together"),
        ({"status": "approved"}, "terms review"),
        ({"auth": "password"}, "auth"),
        ({"id": "Not_A_Slug"}, "id"),
    ],
)
def test_source_rejects_invalid_fixtures(patch: dict, message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        Source.model_validate(BASE | patch)


def test_source_approval_needs_terms_review_and_attribution() -> None:
    approved = Source.model_validate(
        BASE
        | {
            "status": "approved",
            "terms_reviewed_by": "reviewer",
            "terms_reviewed_at": "2026-09-27",
            "attribution_text": "Source: Example",
        }
    )
    assert approved.ttl_days == 180


def test_registry_rejects_duplicate_ids() -> None:
    with pytest.raises(ValidationError, match="duplicate source ids: example"):
        SourceRegistry.model_validate({"sources": [BASE, BASE]})
