"""``tda``: the data agent CLI, composed from each module's own Typer sub-app (P2 T9)."""

from __future__ import annotations

import typer

from tda import __version__
from tda.api.cli import api_app
from tda.cli_support import configure_logging
from tda.config.cli import sources_app
from tda.config.settings import get_settings
from tda.connectors.cli import ingest, runs_app
from tda.connectors.gtfs_cli import gtfs_app
from tda.facts.cli import facts_app
from tda.pipelines.scheduler import scheduler_app
from tda.review.cli import review_app
from tda.store.cli import db_app, retention_app

app = typer.Typer(help=f"Tryp Transit data agent {__version__}.", no_args_is_help=True, add_completion=False)
app.add_typer(db_app, name="db")
app.add_typer(sources_app, name="sources")
app.command("ingest")(ingest)
app.add_typer(runs_app, name="runs")
app.add_typer(gtfs_app, name="gtfs")
app.add_typer(review_app, name="review")
app.add_typer(facts_app, name="facts")
app.add_typer(api_app, name="api")
app.add_typer(retention_app, name="retention")
app.add_typer(scheduler_app, name="scheduler")


@app.callback()
def main() -> None:
    """Configure logging before any command runs."""
    configure_logging(get_settings().log_json)
