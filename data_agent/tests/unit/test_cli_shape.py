"""The CLI exposes exactly the P2 T9 sub-apps and commands, and fails cleanly without configuration."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import yaml
from click.testing import Result
from typer.main import get_command
from typer.testing import CliRunner

from tda.cli import app
from tda.config.settings import get_settings

EXPECTED = {
    "db": {"bootstrap", "upgrade", "downgrade"},
    "sources": {"list", "validate", "sync"},
    "runs": {"rollback", "list", "show"},
    "gtfs": {"versions", "activate"},
    "review": {"list", "show", "approve", "reject"},
    "api": {"serve", "openapi"},
    "retention": {"run"},
    "scheduler": {"run"},
}


def test_every_sub_app_and_command_is_wired() -> None:
    root = get_command(app)
    groups = {name: set(cmd.commands) for name, cmd in root.commands.items() if hasattr(cmd, "commands")}
    assert groups == EXPECTED
    assert "ingest" in root.commands and not hasattr(root.commands["ingest"], "commands")
    live = next(p for p in root.commands["ingest"].params if p.name == "live")
    assert live.default is False, "network access is opt-in"


def test_errors_are_one_line_and_exit_2_without_a_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TDA_DATABASE_URL", raising=False)
    get_settings.cache_clear()
    try:
        result = CliRunner().invoke(app, ["runs", "list"])
    finally:
        get_settings.cache_clear()
    assert result.exit_code == 2
    assert result.stderr.strip() == "error: no database URL configured for the writer (TDA_DATABASE_URL)"


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "config"


def _project(tmp_path: Path) -> Path:
    """A throwaway project root with a copy of the real config."""
    real = Path(__file__).resolve().parents[2] / "tda" / "config"
    shutil.copytree(
        real, tmp_path / "data_agent" / "tda" / "config", ignore=shutil.ignore_patterns("*.py", "__pycache__")
    )
    return tmp_path / "data_agent"


def _validate(root: Path, monkeypatch: pytest.MonkeyPatch) -> Result:
    monkeypatch.setenv("TDA_PROJECT_ROOT", str(root))
    get_settings.cache_clear()
    try:
        return CliRunner().invoke(app, ["sources", "validate"])
    finally:
        get_settings.cache_clear()


def test_sources_validate_fails_on_the_invalid_sources_fixture(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _project(tmp_path)
    shutil.copy(FIXTURES / "sources-invalid.yaml", root / "tda" / "config" / "sources.yaml")
    result = _validate(root, monkeypatch)
    assert result.exit_code == 2, result.output
    assert result.stderr.strip() == (
        "error: invalid SourceRegistry: sources.0: Value error, "
        "source bad-html: html and pdf sources require robots_required: true"
    )


def test_sources_validate_fails_on_an_invalid_region(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = _project(tmp_path)
    region_file = root / "tda" / "config" / "regions" / "charleston.yaml"
    region = yaml.safe_load(region_file.read_text(encoding="utf-8"))
    region["timezone"] = "Mars/Olympus_Mons"
    region_file.write_text(yaml.safe_dump(region), encoding="utf-8")
    result = _validate(root, monkeypatch)
    assert result.exit_code == 2, result.output
    lines = result.stderr.strip().splitlines()
    assert len(lines) == 1 and lines[0].startswith("error: invalid Region: timezone: ")


def test_the_real_config_validates(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    result = _validate(_project(tmp_path), monkeypatch)
    assert result.exit_code == 0 and "25 sources OK" in result.stdout
