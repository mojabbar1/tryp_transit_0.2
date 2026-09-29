"""``tda scheduler run``: one cron job per approved source that has a cadence and a connector, plus retention
and the daily metrics recompute (``tda metrics compute``).

There are no connector jobs until P3 adds connectors and a PR approves their sources. Jobs never overlap
(``max_instances=1``), missed runs are coalesced, and times are UTC.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog
import typer
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from tda.cli_support import cli_errors
from tda.config.models import Source, SourceRegistry
from tda.config.registry import load_sources
from tda.config.settings import Settings, get_settings
from tda.connectors.registry import connector_class
from tda.http.polite_client import PoliteClient
from tda.metrics.cli import compute_all
from tda.pipelines.ingest import ingest
from tda.store.db import writer_engine
from tda.store.raw_store import RawStore
from tda.store.retention import apply_retention

log = structlog.get_logger(__name__)
RETENTION_CRON = "17 3 * * *"
# After the daily GTFS check (09:00 UTC) and the weekly NTD check (Tuesday 10:00 UTC).
METRICS_CRON = "45 10 * * *"

scheduler_app = typer.Typer(help="The worker's job scheduler.", no_args_is_help=True)


@dataclass(frozen=True)
class Job:
    """One scheduled job."""

    name: str
    cron: str
    source: Source | None = None


def planned_jobs(registry: SourceRegistry) -> list[Job]:
    """Ingest jobs for approved sources with a cadence and a connector, then daily retention and metrics."""
    jobs = []
    for source in registry.sources:
        if source.status != "approved" or source.cadence is None:
            continue
        if connector_class(source.id) is None:
            log.warning("scheduler.no_connector", source=source.id)
            continue
        jobs.append(Job(f"ingest:{source.id}", source.cadence, source))
    jobs.append(Job("retention", RETENTION_CRON))
    jobs.append(Job("metrics", METRICS_CRON))
    return jobs


def run_job(settings: Settings, registry: SourceRegistry, job: Job, client: PoliteClient) -> None:
    """Run one job now; errors are logged, never raised (the scheduler keeps going)."""
    try:
        if job.source is not None:
            outcome = ingest(settings, job.source, live=True, client=client)
            log.info("scheduler.ingest", source=job.source.id, status=outcome.status, run_id=outcome.run_id)
            return
        if job.name == "metrics":
            for line in compute_all(settings):
                log.info("scheduler.metrics", result=line)
            return
        engine = writer_engine(settings)
        store = RawStore(settings.raw_store_dir or settings.project_root / "raw")
        try:
            with engine.connect() as connection:
                for source in registry.sources:
                    report = apply_retention(connection, store, source)
                    if report.deleted:
                        log.info("scheduler.retention", source=source.id, deleted=len(report.deleted))
        finally:
            engine.dispose()
    except Exception as error:
        log.error("scheduler.job_failed", job=job.name, error=f"{type(error).__name__}: {error}"[:300])


@scheduler_app.command("run")
@cli_errors
def run(once: bool = typer.Option(False, "--once", help="Run every job once, now, then exit.")) -> None:
    """Start the scheduler (blocking), or run each job once with --once."""
    settings = get_settings()
    registry = load_sources(settings=settings)
    jobs = planned_jobs(registry)
    ingest_jobs = sum(1 for job in jobs if job.source is not None)
    typer.echo(
        f"scheduler: {ingest_jobs} ingest job(s), plus retention at '{RETENTION_CRON}' "
        f"and metrics at '{METRICS_CRON}' UTC"
    )
    for job in jobs:
        typer.echo(f"  {job.name:<40} {job.cron}")
    # One polite client for the worker's lifetime: per-host pacing and the robots cache span every job.
    with PoliteClient(settings) as client:
        if once:
            for job in jobs:
                run_job(settings, registry, job, client)
            return
        scheduler = BlockingScheduler(timezone="UTC")
        for job in jobs:
            scheduler.add_job(
                run_job,
                CronTrigger.from_crontab(job.cron, timezone="UTC"),
                args=(settings, registry, job, client),
                id=job.name,
                max_instances=1,
                coalesce=True,
                misfire_grace_time=300,
            )
        scheduler.start()
