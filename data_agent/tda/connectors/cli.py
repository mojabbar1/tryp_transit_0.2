"""``tda ingest <id> [--live]`` and ``tda runs`` (list, show, rollback)."""

from __future__ import annotations

import typer
from sqlalchemy import text

from tda.cli_support import cli_errors
from tda.config.registry import load_sources
from tda.config.settings import get_settings
from tda.connectors.base import rollback_run
from tda.connectors.registry import connector_class
from tda.pipelines.ingest import ingest as ingest_source
from tda.store.db import writer_engine

runs_app = typer.Typer(
    help="Fetch runs: list, show, and roll back (by status; nothing is deleted).", no_args_is_help=True
)


@cli_errors
def ingest(
    source_id: str = typer.Argument(..., help="A source id from sources.yaml."),
    live: bool = typer.Option(False, "--live", help="Allow network access. Without it nothing is fetched."),
) -> None:
    """Run one source's connector. A source that isn't approved is recorded as skipped_disabled."""
    settings = get_settings()
    registry = load_sources(settings=settings)
    try:
        source = registry.get(source_id)
    except KeyError:
        raise LookupError(f"no source {source_id!r} in sources.yaml") from None
    outcome = ingest_source(settings, source, live=live)
    detail = f" (run {outcome.run_id})" if outcome.run_id else ""
    typer.echo(
        f"{outcome.source_id}: {outcome.status}{detail}" + (f": {outcome.message}" if outcome.message else "")
    )
    if outcome.status == "failed":
        raise typer.Exit(1)


@runs_app.command("list")
@cli_errors
def list_runs(
    source_id: str | None = typer.Option(None, "--source"), limit: int = typer.Option(20, min=1, max=1000)
) -> None:
    """The most recent runs, newest first."""
    engine = writer_engine(get_settings())
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT id, source_id, acquisition, status, started_at, http_status, bytes "
                    "FROM tda.fetch_run WHERE CAST(:s AS text) IS NULL OR source_id = :s "
                    "ORDER BY id DESC LIMIT :n"
                ),
                {"s": source_id, "n": limit},
            ).all()
    finally:
        engine.dispose()
    for r in rows:
        typer.echo(
            f"{r.id:>7} {r.source_id:<28} {r.acquisition:<6} {r.status:<16} {r.started_at:%Y-%m-%d %H:%M}Z "
            f"http={r.http_status or '-'} bytes={r.bytes if r.bytes is not None else '-'}"
        )
    if not rows:
        typer.echo("no runs")


@runs_app.command()
@cli_errors
def show(run_id: int) -> None:
    """Every recorded field of one run."""
    engine = writer_engine(get_settings())
    try:
        with engine.connect() as connection:
            row = (
                connection.execute(text("SELECT * FROM tda.fetch_run WHERE id = :i"), {"i": run_id})
                .mappings()
                .one_or_none()
            )
    finally:
        engine.dispose()
    if row is None:
        raise LookupError(f"no fetch_run {run_id}")
    for key, value in row.items():
        typer.echo(f"{key:<14} {value if value is not None else '-'}")


@runs_app.command()
@cli_errors
def rollback(
    run_id: int,
    dry_run: bool = typer.Option(False, "--dry-run", help="List what would change; change nothing."),
    confirm: bool = typer.Option(False, "--confirm", help="Apply the rollback."),
) -> None:
    """Mark a success run rolled_back, recompute its metrics, and flag dependent facts. Deletes nothing."""
    if dry_run == confirm:
        typer.secho("error: pass exactly one of --dry-run or --confirm", err=True, fg="red")
        raise typer.Exit(2)
    engine = writer_engine(get_settings())
    try:
        with engine.connect() as connection:
            source_id = connection.execute(
                text("SELECT source_id FROM tda.fetch_run WHERE id = :i"), {"i": run_id}
            ).scalar_one_or_none()
        if source_id is None:
            raise LookupError(f"no fetch_run {run_id}")
        cls = connector_class(source_id)
        plan = rollback_run(
            engine, run_id, owned_tables=cls.owned_tables if cls else (), dry_run=dry_run, source_id=source_id
        )
    finally:
        engine.dispose()
    for line in plan.lines():
        typer.echo(line)
