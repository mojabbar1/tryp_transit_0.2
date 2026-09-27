"""Which connector class serves which source. Empty in P2; each P3 connector module registers itself."""

from __future__ import annotations

from tda.connectors.base import Connector

CONNECTORS: dict[str, type[Connector]] = {}


def register(cls: type[Connector]) -> type[Connector]:
    """Class decorator: make ``cls`` the connector for ``cls.source_id``."""
    if cls.source_id in CONNECTORS:
        raise ValueError(f"a connector for {cls.source_id} is already registered")
    CONNECTORS[cls.source_id] = cls
    return cls


def connector_class(source_id: str) -> type[Connector] | None:
    """The registered connector class for ``source_id``, if any."""
    return CONNECTORS.get(source_id)
