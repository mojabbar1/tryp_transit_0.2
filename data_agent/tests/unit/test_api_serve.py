"""``tda api serve`` keeps no access log: URLs carry riders' coordinates and stop pairs (review F1)."""

from __future__ import annotations

from typing import Any

import pytest
import uvicorn
from typer.testing import CliRunner

from tda.cli import app
from tda.config.settings import get_settings


def test_the_api_launcher_turns_uvicorns_access_log_off(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(uvicorn, "run", lambda application, **kwargs: calls.append(kwargs))
    get_settings.cache_clear()
    try:
        result = CliRunner().invoke(app, ["api", "serve", "--port", "18081"], catch_exceptions=False)
    finally:
        get_settings.cache_clear()
    assert result.exit_code == 0
    assert calls == [{"host": "127.0.0.1", "port": 18081, "log_level": "info", "access_log": False}]
