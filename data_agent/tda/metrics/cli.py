"""``tda metrics compute``: record the headway and ridership metrics from the current data (runs daily)."""

from __future__ import annotations

from datetime import date, datetime

import typer

from tda.cli_support import cli_errors
from tda.config.registry import load_region
from tda.config.settings import Settings, get_settings
from tda.metrics.feeds import active_feeds
from tda.metrics.ridership import record_ridership
from tda.metrics.service import record_headways
from tda.store.db import writer_engine

metrics_app = typer.Typer(help="Metrics: headways (GTFS) and ridership (NTD).", no_args_is_help=True)


def compute_all(settings: Settings, reference: date | None = None) -> list[str]:
    """Headways for every active approved GTFS feed, then ridership for every agency with an NTD ID.

    Each feed and agency is one transaction; unchanged values aren't written again. Returns one line each.
    """
    engine = writer_engine(settings)
    lines = []
    try:
        with engine.connect() as connection:
            feeds = active_feeds(connection)
        for feed in feeds:
            with engine.begin() as connection:
                written = record_headways(connection, feed, reference or feed.today())
            lines.append(
                f"headways {feed.source_id} (feed version {feed.feed_version_id}): {written} written"
            )
        for agency in load_region(settings=settings).agencies:
            if agency.ntd_id:
                with engine.begin() as connection:
                    written = record_ridership(connection, agency.ntd_id)
                lines.append(f"ridership {agency.id} (NTD {agency.ntd_id}): {written} written")
    finally:
        engine.dispose()
    return lines


REFERENCE = typer.Option(
    None,
    "--date",
    formats=["%Y-%m-%d"],
    help="Headways start from this date. Default: today in each feed's time zone.",
)


@metrics_app.command()
@cli_errors
def compute(reference: datetime | None = REFERENCE) -> None:
    """Record changed metrics and withdraw ones that can no longer be computed."""
    lines = compute_all(get_settings(), reference.date() if reference else None)
    for line in lines or ["nothing to compute (no active feed, no NTD agency)"]:
        typer.echo(line)
