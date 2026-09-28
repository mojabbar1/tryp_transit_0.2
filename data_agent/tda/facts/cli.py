"""``tda facts``: load the human-verified reference facts (P3.5) as candidates for review."""

from __future__ import annotations

from pathlib import Path

import typer

from tda.cli_support import cli_errors, whoami
from tda.config.registry import load_sources
from tda.config.settings import get_settings
from tda.facts.reference import DEFAULT_FILE, check_sources, load_reference, read_reference
from tda.store.db import writer_engine

facts_app = typer.Typer(help="Facts: load the reference facts for human review.", no_args_is_help=True)
FILE = typer.Option(DEFAULT_FILE, "--file", help="The reference facts YAML.")


@facts_app.command("load-reference")
@cli_errors
def load_reference_command(
    file: Path = FILE,
    check: bool = typer.Option(False, "--check", help="Only validate the file; write nothing."),
    by: str = typer.Option(None, "--by", help="Who requests the review (default: your user name)."),
) -> None:
    """Queue every filled, changed entry as a candidate fact with a review item; null values are skipped."""
    settings = get_settings()
    registry = load_sources(settings=settings)
    reference, digest = read_reference(file)
    check_sources(reference, registry)
    filled = sum(1 for entry in reference.facts if entry.filled)
    typer.echo(f"{file.name}: {len(reference.facts)} entries, {filled} filled (sha256 {digest[:12]})")
    if check:
        return
    engine = writer_engine(settings)
    try:
        with engine.begin() as connection:
            report = load_reference(connection, registry, file, requested_by=by or whoami())
    finally:
        engine.dispose()
    for label, keys in (("queued for review", report.loaded), ("unchanged", report.unchanged)):
        typer.echo(f"{label}: {', '.join(keys) if keys else '-'}")
    typer.echo(f"skipped (no value yet): {len(report.skipped)}")
