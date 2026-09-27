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


def ingest(
    settings: Settings, source: Source, *, live: bool, client: PoliteClient | None = None
) -> RunOutcome:
    """Skip it unless approved; otherwise run its connector (over the network only when ``live``).

    The worker passes its one long-lived ``client`` so per-host pacing and the robots cache span every job; a
    one-off CLI run gets its own client, closed afterwards.
    """
    engine = writer_engine(settings)
    try:
        if source.status != "approved":
            return skip_disabled(engine, source)
        cls = connector_class(source.id)
        if cls is None:
            raise NoConnector(
                f"{source.id} is approved but has no registered connector (connectors arrive in P3)"
            )
        http = client if live else None
        owned = live and http is None
        if owned:
            http = PoliteClient(settings)
        try:
            store = RawStore(settings.raw_store_dir or settings.project_root / "raw")
            connector = cls(source, engine=engine, store=store, client=http, settings=settings)
            return connector.run(live=live)
        finally:
            if owned and http is not None:
                http.close()
    finally:
        engine.dispose()
