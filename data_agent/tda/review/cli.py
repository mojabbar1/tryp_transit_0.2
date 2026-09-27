"""``tda review``: list, show, approve, reject (the default review surface, D-8)."""

from __future__ import annotations

import json

import typer

from tda.cli_support import cli_errors, whoami
from tda.config.settings import get_settings
from tda.review import queue
from tda.store.db import writer_engine

review_app = typer.Typer(help="The human review queue.", no_args_is_help=True)


@review_app.command("list")
@cli_errors
def list_items(
    status: str = typer.Option("pending", help="pending, approved, rejected, or all."),
    kind: str | None = typer.Option(None, help="source, fact, report, or campaign."),
    markdown: bool = typer.Option(False, "--markdown", help="A Markdown table for a PR."),
) -> None:
    """Queue items, oldest first."""
    engine = writer_engine(get_settings())
    try:
        with engine.connect() as connection:
            items = queue.list_items(connection, status=None if status == "all" else status, kind=kind)
    finally:
        engine.dispose()
    if markdown:
        typer.echo(queue.to_markdown(items), nl=False)
        return
    for item in items:
        typer.echo(f"#{item.id:<6} {item.kind:<9} {item.ref_id:<30} {item.status:<9} by {item.requested_by}")
    if not items:
        typer.echo("nothing to review")


@review_app.command()
@cli_errors
def show(item_id: int) -> None:
    """One item, with its payload."""
    engine = writer_engine(get_settings())
    try:
        with engine.connect() as connection:
            item = queue.show(connection, item_id)
    finally:
        engine.dispose()
    for field in (
        "id",
        "kind",
        "ref_id",
        "status",
        "requested_by",
        "decided_by",
        "decided_at",
        "notes",
        "created_at",
    ):
        value = getattr(item, field)
        typer.echo(f"{field:<13} {value if value is not None else '-'}")
    typer.echo("payload:\n" + json.dumps(item.payload, indent=2, sort_keys=True, default=str))


@review_app.command()
@cli_errors
def approve(
    item_id: int,
    by: str = typer.Option(None, "--by", help="Reviewer (default: your user name)."),
    notes: str = "",
) -> None:
    """Approve an item. A source proposal only writes proposals/sources/<id>.yaml; it enables nothing."""
    settings = get_settings()
    engine = writer_engine(settings)
    try:
        with engine.begin() as connection:
            item = queue.approve(
                connection, item_id, by or whoami(), proposals_dir=settings.proposals_dir, notes=notes or None
            )
    finally:
        engine.dispose()
    typer.echo(f"#{item.id} {item.kind} {item.ref_id}: approved by {item.decided_by}")
    if item.kind == "source":
        typer.echo(
            f"suggested entry: {settings.proposals_dir / 'sources' / (item.ref_id + '.yaml')} (open a PR)"
        )


@review_app.command()
@cli_errors
def reject(
    item_id: int,
    notes: str = typer.Option(..., "--notes", help="Why (required)."),
    by: str = typer.Option(None, "--by", help="Reviewer (default: your user name)."),
) -> None:
    """Reject an item; a reason is required."""
    engine = writer_engine(get_settings())
    try:
        with engine.begin() as connection:
            item = queue.reject(connection, item_id, by or whoami(), notes=notes)
    finally:
        engine.dispose()
    typer.echo(f"#{item.id} {item.kind} {item.ref_id}: rejected by {item.decided_by}")
