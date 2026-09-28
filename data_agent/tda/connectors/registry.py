"""Which connector class serves which source. Each connector module registers itself on import."""

from __future__ import annotations

import importlib

from tda.connectors.base import Connector

CONNECTORS: dict[str, type[Connector]] = {}
# Imported on first lookup (a connector module imports this one, so importing them here would be a cycle).
BUILTIN = ("tda.connectors.gtfs_static",)


def register(cls: type[Connector]) -> type[Connector]:
    """Class decorator: make ``cls`` the connector for ``cls.source_id``."""
    if cls.source_id in CONNECTORS:
        raise ValueError(f"a connector for {cls.source_id} is already registered")
    CONNECTORS[cls.source_id] = cls
    return cls


def connector_class(source_id: str) -> type[Connector] | None:
    """The registered connector class for ``source_id``, if any."""
    for module in BUILTIN:
        importlib.import_module(module)
    return CONNECTORS.get(source_id)
