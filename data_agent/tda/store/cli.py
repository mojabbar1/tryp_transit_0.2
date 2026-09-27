"""``tda db`` (roles, schema, migrations) and ``tda retention`` (raw snapshot TTLs)."""

from __future__ import annotations

import typer

from tda.cli_support import cli_errors
from tda.config.registry import load_sources
from tda.config.settings import get_settings
from tda.store import bootstrap as bootstrap_module
from tda.store.db import MissingDatabaseURL, writer_engine
from tda.store.raw_store import RawStore
from tda.store.retention import apply_retention

db_app = typer.Typer(help="Roles, the tda schema, and migrations.", no_args_is_help=True)
retention_app = typer.Typer(help="Raw snapshot retention (store_policy).", no_args_is_help=True)


def _admin_url() -> str:
    url = get_settings().admin_database_url
    if not url:
        raise MissingDatabaseURL("TDA_ADMIN_DATABASE_URL is not set (a superuser or tda_owner URL)")
    return url


@db_app.command()
@cli_errors
def bootstrap() -> None:
    """Create missing roles (if allowed), the tda schema, and schema grants. Safe to re-run."""
    settings = get_settings()
    for line in bootstrap_module.bootstrap(_admin_url(), settings.database_url, settings.reader_database_url):
        typer.echo(line)


@db_app.command()
@cli_errors
def upgrade(revision: str = typer.Argument("head")) -> None:
    """Migrate to ``revision`` (default head), as tda_owner."""
    bootstrap_module.upgrade(_admin_url(), revision)
    typer.echo(f"upgraded to {revision}")


@db_app.command()
@cli_errors
def downgrade(
    revision: str = typer.Argument("-1"),
    confirm: bool = typer.Option(
        False, "--confirm", help="Required: a downgrade drops tables and their data."
    ),
) -> None:
    """Migrate down to ``revision`` (default: one step). Destructive, so it needs --confirm."""
    if not confirm:
        typer.secho("error: a downgrade drops tables; re-run with --confirm", err=True, fg="red")
        raise typer.Exit(2)
    bootstrap_module.downgrade(_admin_url(), revision)
    typer.echo(f"downgraded to {revision}")


@retention_app.command("run")
@cli_errors
def run_retention(
    source_id: str | None = typer.Option(None, "--source", help="Only this source."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Report what would be deleted; delete nothing."),
) -> None:
    """Delete raw snapshots past each source's TTL, keeping any cited by a published fact."""
    settings = get_settings()
    registry = load_sources(settings=settings)
    sources = [registry.get(source_id)] if source_id else registry.sources
    store = RawStore(settings.raw_store_dir or settings.project_root / "raw")
    engine = writer_engine(settings)
    try:
        with engine.connect() as connection:
            for source in sources:
                report = apply_retention(connection, store, source, dry_run=dry_run)
                verb = "would delete" if dry_run else "deleted"
                typer.echo(
                    f"{source.id} ({source.store_policy}): {verb} {len(report.deleted)}, "
                    f"kept {len(report.kept)}, protected {len(report.protected)}"
                )
    finally:
        engine.dispose()
