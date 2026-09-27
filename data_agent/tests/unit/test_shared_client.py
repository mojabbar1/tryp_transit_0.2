"""The worker shares one polite client across jobs (review finding F5): pacing and robots span runs."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import respx
from sqlalchemy import Connection

from tda.config.models import SourceRegistry
from tda.config.settings import Settings
from tda.connectors import registry as connector_registry
from tda.connectors.base import Connector, FetchResult, LoadStats, PriorRun, Row, RunOutcome
from tda.http.polite_client import NotModified, PoliteClient, RequestBudget
from tda.pipelines import ingest as ingest_module
from tda.pipelines import scheduler
from tests.support.factories import APPROVAL, make_source
from tests.unit.test_polite_client import Clock


class _HttpProbe(Connector):
    source_id = "shared-a"

    def fetch(self, prior: PriorRun | None, budget: RequestBudget | None) -> FetchResult | NotModified:
        return self.http_get(prior, budget, ext="json")

    def normalize(self, raw: bytes) -> Iterable[Row]:
        return []

    def load(self, connection: Connection, rows: list[Row], run_id: int) -> LoadStats:
        return LoadStats()


def test_two_ingests_through_one_client_share_pacing_and_the_robots_cache(monkeypatch: Any) -> None:
    clock = Clock()
    fetched: list[float] = []

    class Recorder(_HttpProbe):
        def run(self, *, live: bool) -> RunOutcome:
            assert self.client is shared
            response = self.client.fetch(self.source)
            fetched.append(clock.t)
            return RunOutcome(self.source.id, "success", 1, message=str(response))

    source = make_source(id="shared-a", kind="html", robots_required=True, url="https://h.test/a", **APPROVAL)
    monkeypatch.setitem(connector_registry.CONNECTORS, "shared-a", Recorder)
    monkeypatch.setattr(ingest_module, "writer_engine", lambda settings: _NoEngine())
    shared = PoliteClient(
        Settings(default_rate_limit_per_min=30), sleep=clock.sleep, monotonic=clock.monotonic
    )
    with respx.mock(assert_all_called=False) as router:
        robots = router.get("https://h.test/robots.txt").respond(200, text="User-agent: *\nAllow: /\n")
        router.get("https://h.test/a").respond(200)
        for _ in range(2):
            ingest_module.ingest(Settings(), source, live=True, client=shared)
    assert robots.call_count == 1, "the second run reused the cached robots.txt"
    assert fetched == [2.0, 4.0], "every request to h.test is 2 s after the previous one, across runs"
    shared.close()


def test_the_scheduler_hands_every_job_the_same_client(monkeypatch: Any) -> None:
    seen: list[PoliteClient] = []
    jobs = [scheduler.Job("ingest:a", "0 * * * *"), scheduler.Job("ingest:b", "0 * * * *")]
    monkeypatch.setattr(scheduler, "load_sources", lambda settings=None: SourceRegistry(sources=[]))
    monkeypatch.setattr(scheduler, "planned_jobs", lambda registry: jobs)
    monkeypatch.setattr(scheduler, "run_job", lambda settings, registry, job, client: seen.append(client))
    scheduler.run(once=True)
    assert len(seen) == 2 and seen[0] is seen[1]


class _NoEngine:
    def dispose(self) -> None:
        pass
