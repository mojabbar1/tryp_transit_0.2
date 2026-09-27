"""The committed OpenAPI snapshot (``contracts/data-agent.openapi.json``); P4 generates TS types from it."""

from __future__ import annotations

import json
from pathlib import Path

from tda.config.settings import Settings, get_settings


def snapshot_path(settings: Settings | None = None) -> Path:
    """``<repo>/contracts/data-agent.openapi.json``."""
    return (settings or get_settings()).project_root.parent / "contracts" / "data-agent.openapi.json"


def render() -> str:
    """The OpenAPI document as stable, sorted JSON (no database needed)."""
    from tda.api.app import create_app

    return json.dumps(create_app().openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def write(settings: Settings | None = None) -> Path:
    """Write the snapshot; returns its path."""
    path = snapshot_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(), encoding="utf-8")
    return path
