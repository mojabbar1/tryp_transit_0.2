"""Load the synthetic GTFS fixture (tests/fixtures/carta-gtfs plus per-test edits) into Postgres (P4a tests).

The feed is served by respx, so nothing reaches the network. Every trip below is invented test data.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence
from pathlib import Path

import httpx
import pytest
import respx
from sqlalchemy import Engine

from tda.config.settings import Settings
from tda.connectors.gtfs_static import GtfsStaticConnector
from tda.http.polite_client import PoliteClient
from tda.metrics.feeds import ActiveFeed, active_feed
from tda.metrics.registry import MetricRegistry
from tda.store.raw_store import RawStore
from tests.connectors.gtfs_feed import files, zipped
from tests.support.factories import APPROVAL, make_source

URL = "https://data.trilliumtransit.com/gtfs/carta-sc-us/carta-sc-us.zip"
R1_STOPS = ("FX01", "FX02", "FX03", "FX04", "FX05", "FX06")


def r1_trip(trip_id: str, start: str, service: str = "WKDY") -> tuple[str, list[str]]:
    """An R1 direction-0 trip from FX01 to FX06, 4 minutes between stops (like the fixture's T1)."""
    hours, minutes = (int(part) for part in start.split(":"))
    rows = []
    for n, stop in enumerate(R1_STOPS):
        total = hours * 60 + minutes + 4 * n
        clock = f"{total // 60:02d}:{total % 60:02d}:00"
        rows.append(f"{trip_id},{clock},{clock},{stop},{n + 1},0,0,{0.8 * n:.1f},{1 if n in (0, 5) else 0}")
    return f"R1,{service},{trip_id},Fixture Stop 06,0,B9,SH1", rows


def r2_trip(trip_id: str, start: str) -> tuple[str, list[str]]:
    """An R2 weekday trip FX01 -> FX07 -> FX08 -> FX09 -> FX10, 4 minutes apart (like the fixture's T4)."""
    hours, minutes = (int(part) for part in start.split(":"))
    rows = []
    for n, stop in enumerate(("FX01", "FX07", "FX08", "FX09", "FX10")):
        total = hours * 60 + minutes + 4 * n
        clock = f"{total // 60:02d}:{total % 60:02d}:00"
        rows.append(f"{trip_id},{clock},{clock},{stop},{n + 1},0,0,{0.8 * n:.1f},{1 if n in (0, 4) else 0}")
    return f"R2,WKDY,{trip_id},Fixture Stop 10,0,B8,SH2", rows


def edited(
    trips: Sequence[tuple[str, list[str]]] = (),
    replace: Sequence[tuple[str, str, str]] = (),
) -> dict[str, str | None]:
    """The fixture's files plus ``trips``, then each (file, old, new) replacement applied once."""
    contents = files()
    for trip, stop_times in trips:
        contents["trips.txt"] += trip + "\n"
        contents["stop_times.txt"] += "".join(line + "\n" for line in stop_times)
    for name, old, new in replace:
        assert old in contents[name], f"{old!r} not in {name}"
        contents[name] = contents[name].replace(old, new, 1)
    return dict(contents)


LoadFeed = Callable[..., ActiveFeed]


@pytest.fixture
def load_feed(writer_engine: Engine, tmp_path: Path) -> Iterator[LoadFeed]:
    """``load_feed(contents=None, metrics=None)`` loads a feed as the approved ``carta-gtfs`` (now active)."""
    client = PoliteClient(Settings(), sleep=lambda _seconds: None)
    source = make_source(id="carta-gtfs", kind="gtfs", url=URL, **APPROVAL)
    store = RawStore(tmp_path / "raw")
    with respx.mock(assert_all_called=False) as router:

        def load(
            contents: dict[str, str | None] | None = None, metrics: MetricRegistry | None = None
        ) -> ActiveFeed:
            connector = GtfsStaticConnector(
                source,
                engine=writer_engine,
                store=store,
                client=client,
                settings=Settings(),
                metrics=metrics or MetricRegistry(),
            )
            router.get(URL).mock(return_value=httpx.Response(200, content=zipped(contents)))
            outcome = connector.run(live=True)
            assert outcome.status == "success", outcome
            with writer_engine.connect() as connection:
                return active_feed(connection, "carta-gtfs")

        yield load
    client.close()
