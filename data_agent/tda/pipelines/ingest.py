"""One ingest of one source, shared by ``tda ingest`` and the scheduler."""

from __future__ import annotations

from tda.config.models import Source
from tda.config.settings import Settings
from tda.connectors.base import RunOutcome, skip_disabled
from tda.connectors.registry import connector_class
from tda.http.polite_client import PoliteClient
from tda.store.db import writer_engine
from tda.store.raw_store import RawStore


class NoConnector(LookupError):
    """An approved source has no connector yet (connectors arrive in P3)."""


def ingest(settings: Settings, source: Source, *, live: bool) -> RunOutcome:
    """Skip it unless approved; otherwise run its connector (over the network only when ``live``)."""
    engine = writer_engine(settings)
    try:
        if source.status != "approved":
            return skip_disabled(engine, source)
        cls = connector_class(source.id)
        if cls is None:
            raise NoConnector(
                f"{source.id} is approved but has no registered connector (connectors arrive in P3)"
            )
        client = PoliteClient(settings) if live else None
        try:
            store = RawStore(settings.raw_store_dir or settings.project_root / "raw")
            connector = cls(source, engine=engine, store=store, client=client, settings=settings)
            return connector.run(live=live)
        finally:
            if client is not None:
                client.close()
    finally:
        engine.dispose()
