"""The CLI exposes exactly the P2 T9 sub-apps and commands, and fails cleanly without configuration."""

from __future__ import annotations

import pytest
from typer.main import get_command
from typer.testing import CliRunner

from tda.cli import app
from tda.config.settings import get_settings

EXPECTED = {
    "db": {"bootstrap", "upgrade", "downgrade"},
    "sources": {"list", "validate", "sync"},
    "runs": {"rollback", "list", "show"},
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
