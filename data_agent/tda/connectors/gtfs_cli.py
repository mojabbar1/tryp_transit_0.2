"""``tda gtfs``: list feed versions and choose the active one (P3.1)."""

from __future__ import annotations

import typer
from sqlalchemy import text

from tda.cli_support import cli_errors, whoami
from tda.config.settings import get_settings
from tda.connectors.gtfs_static import GtfsStaticConnector, activate
from tda.store.db import writer_engine

gtfs_app = typer.Typer(help="GTFS feed versions: list them, and choose the active one.", no_args_is_help=True)
SOURCE = typer.Option(GtfsStaticConnector.source_id, "--source", help="The GTFS source id.")


@gtfs_app.command()
@cli_errors
def versions(source_id: str = SOURCE) -> None:
    """Current (not rolled-back) feed versions, newest first; `*` marks the active one."""
    engine = writer_engine(get_settings())
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT id, feed_label, feed_start, feed_end, loaded_at, is_active, activated_by "
                    "FROM tda.current_gtfs_feed_version WHERE source_id = :s ORDER BY id DESC"
                ),
                {"s": source_id},
            ).all()
    finally:
        engine.dispose()
    for r in rows:
        mark = "*" if r.is_active else " "
        by = f" (activated by {r.activated_by})" if r.is_active else ""
        typer.echo(
            f"{mark} {r.id:>5}  {r.feed_start} .. {r.feed_end}  loaded {r.loaded_at:%Y-%m-%d %H:%M}Z  "
            f"{r.feed_label or '-'}{by}"
        )
    if not rows:
        typer.echo(f"no current feed versions for {source_id}")


@gtfs_app.command("activate")
@cli_errors
def activate_version(
    feed_version_id: int,
    source_id: str = SOURCE,
    by: str = typer.Option(None, "--by", help="Who is activating it (default: your user name)."),
) -> None:
    """Make a current feed version the active one (appends an activation; nothing is changed or deleted)."""
    engine = writer_engine(get_settings())
    try:
        with engine.begin() as connection:
            activate(connection, source_id, feed_version_id, by or whoami())
    finally:
        engine.dispose()
    typer.echo(f"feed version {feed_version_id} of {source_id} is now active")
