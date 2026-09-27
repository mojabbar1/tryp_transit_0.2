"""Loading the region and source registries from YAML."""

from __future__ import annotations

from pathlib import Path

import yaml

from tda.config.models import Region, SourceRegistry
from tda.config.settings import Settings, get_settings


def load_region(name: str | None = None, settings: Settings | None = None) -> Region:
    """Parse and validate ``regions/<name>.yaml`` (default: the configured region)."""
    settings = settings or get_settings()
    path = settings.config_dir / "regions" / f"{name or settings.region}.yaml"
    return Region.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def load_sources(path: Path | None = None, settings: Settings | None = None) -> SourceRegistry:
    """Parse and validate ``sources.yaml`` (the source of truth for the `source` table)."""
    settings = settings or get_settings()
    path = path or settings.config_dir / "sources.yaml"
    return SourceRegistry.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
