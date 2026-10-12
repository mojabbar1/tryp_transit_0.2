"""Manual report CLI: export → Copilot plan → dry-run/submit → human review."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError

from tda.agent.queries import QueryService
from tda.agent.report import Packet, ReportError, Window
from tda.agent.runtime import parse_plan, run
from tda.cli_support import cli_errors
from tda.review.queue import show
from tda.store.db import reader_engine, writer_engine

report_app = typer.Typer(
    help="Operator/Copilot-assisted cited drafts only. "
    "No paid provider, scheduler, approval, or publish command."
)
MAX_INPUT_BYTES = 128_000


def _read(path: Path) -> str:
    try:
        with path.open("rb") as handle:
            content = handle.read(MAX_INPUT_BYTES + 1)
        if len(content) > MAX_INPUT_BYTES:
            raise ReportError("input_file_too_large")
        return content.decode("utf-8")
    except (OSError, UnicodeError):
        raise ReportError("input_file_unreadable") from None


def _packet(path: Path) -> Packet:
    try:
        return Packet.model_validate_json(_read(path))
    except ValidationError:
        raise ReportError("packet_schema_invalid") from None


def _write_new(path: Path, content: str) -> None:
    """Explicit operator path only; exclusive create refuses existing files and symlinks."""
    try:
        with path.open("x", encoding="utf-8") as handle:
            handle.write(content)
    except OSError:
        raise ReportError("output_path_unavailable_use_a_new_file_in_an_existing_directory") from None


@report_app.command()
@cli_errors
def prepare(
    start: Annotated[str, typer.Option(help="First report day, YYYY-MM-DD; also the service-metric date.")],
    end: Annotated[str, typer.Option(help="Last report day, at most six days after start.")],
    out: Annotated[Path, typer.Option(help="New evidence JSON file; never overwritten.")],
) -> None:
    """Read the real approved evidence packet using tda_reader; no database writes or LLM calls."""
    try:
        period = Window(start=date.fromisoformat(start), end=date.fromisoformat(end))
    except (ValueError, ValidationError):
        raise ReportError("invalid_report_window") from None
    engine = reader_engine()
    try:
        packet = QueryService(engine).export(period)
        _write_new(out, packet.model_dump_json(indent=2) + "\n")
    finally:
        engine.dispose()
    typer.echo(f"packet={out} hash={packet.packet_hash} evidence={len(packet.evidence)}")


@report_app.command("submit")
@cli_errors
def submit_plan(
    packet: Annotated[Path, typer.Option(help="Previously exported evidence packet.")],
    plan: Annotated[Path, typer.Option(help="Structured Copilot response; not a prompt to a paid provider.")],
    dry_run: Annotated[
        bool, typer.Option(help="Validate current evidence and print a draft; no DB writes.")
    ] = False,
) -> None:
    """Fail closed; runtime alone submits validated output as pending. No silent item dropping."""
    staged_packet, staged_plan = _packet(packet), parse_plan(_read(plan))
    reader = reader_engine()
    writer = None if dry_run else writer_engine()
    try:
        item_id, draft = run(QueryService(reader), staged_packet, staged_plan, writer=writer)
    finally:
        reader.dispose()
        if writer is not None:
            writer.dispose()
    if item_id is None:
        typer.echo(draft)
    else:
        typer.echo(f"review_item={item_id} status=pending; use tda review show {item_id}")


@report_app.command()
@cli_errors
def render(
    item_id: int,
    out: Annotated[Path, typer.Option(help="Explicit new Markdown path; no model-controlled filenames.")],
) -> None:
    """Export the immutable validated draft stored in the review queue; never publish it."""
    engine = writer_engine()  # Reader deliberately has no grant on the human review queue.
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("SET TRANSACTION READ ONLY")
            item = show(connection, item_id)
            if item.kind != "report" or item.requested_by != "copilot-assisted-report-runtime":
                raise ReportError("not_a_validated_minimal_report")
            draft = item.payload.get("markdown")
            if not isinstance(draft, str):
                raise ReportError("report_payload_invalid")
            _write_new(out, draft)
    finally:
        engine.dispose()
    typer.echo(f"draft={out} review_item={item_id} current_review_status={item.status}")
