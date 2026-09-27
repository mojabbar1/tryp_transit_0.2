"""``tda sources``: list, validate, and sync the source registry (``sources.yaml`` is the source of truth)."""

from __future__ import annotations

from collections import Counter

import typer

from tda.cli_support import cli_errors
from tda.config.registry import load_region, load_sources
from tda.config.settings import get_settings
from tda.store.db import writer_engine
from tda.store.sources import sync_sources

sources_app = typer.Typer(help="The source registry (sources.yaml).", no_args_is_help=True)


@sources_app.command("list")
@cli_errors
def list_sources() -> None:
    """Every source with its status, kind, cadence, and store policy."""
    registry = load_sources(settings=get_settings())
    typer.echo(f"{'id':<28} {'catalog':<8} {'kind':<8} {'status':<9} {'store':<12} cadence")
    for s in registry.sources:
        typer.echo(
            f"{s.id:<28} {s.catalog_id:<8} {s.kind:<8} {s.status:<9} {s.store_policy:<12} {s.cadence or '-'}"
        )
    counts = Counter(s.status for s in registry.sources)
    typer.echo(
        f"{len(registry.sources)} sources: " + ", ".join(f"{n} {k}" for k, n in sorted(counts.items()))
    )


@sources_app.command()
@cli_errors
def validate() -> None:
    """Validate sources.yaml and the configured region file; exit 2 on the first error."""
    settings = get_settings()
    registry = load_sources(settings=settings)
    counts = Counter(s.status for s in registry.sources)
    typer.echo(f"sources.yaml: {len(registry.sources)} sources OK ({dict(sorted(counts.items()))})")
    region = load_region(settings=settings)
    typer.echo(f"region {region.id}: OK ({len(region.corridors)} corridors)")


@sources_app.command()
@cli_errors
def sync() -> None:
    """Mirror sources.yaml into tda.source; sources no longer listed become disabled (never deleted)."""
    settings = get_settings()
    engine = writer_engine(settings)
    try:
        with engine.begin() as connection:
            report = sync_sources(connection, load_sources(settings=settings))
    finally:
        engine.dispose()
    for label, ids in (
        ("inserted", report.inserted),
        ("updated", report.updated),
        ("disabled", report.disabled),
    ):
        typer.echo(f"{label}: {', '.join(ids) if ids else '-'}")
