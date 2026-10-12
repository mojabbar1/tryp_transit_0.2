"""Validate a staged operator/Copilot plan against live evidence, then submit pending only."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

import structlog
from pydantic import ValidationError
from sqlalchemy import Engine, text

from tda.agent.queries import QueryService
from tda.agent.report import VERSION, Packet, ReportError, ReportPlan, render, validate_plan
from tda.review.queue import submit
from tda.store.lineage import key_lock

log = structlog.get_logger(__name__)
AUTHOR = "copilot-assisted-report-runtime"


def parse_plan(raw: str) -> ReportPlan:
    try:
        return ReportPlan.model_validate_json(raw)
    except ValidationError:
        # Pydantic literal errors can contain untrusted model values; never log the raw response.
        log.warning("report.rejected", violation="plan_schema_invalid")
        raise ReportError("plan_schema_invalid") from None


def validate_current(query: QueryService, packet: Packet, plan: ReportPlan) -> None:
    validate_plan(packet, plan)
    now = datetime.now(UTC)
    if packet.generated_at.tzinfo is None or not timedelta(0) <= now - packet.generated_at <= timedelta(
        days=1
    ):
        raise ReportError("packet_expired_or_future")
    current = query.export(packet.period, generated_at=packet.generated_at)
    if current != packet:
        raise ReportError("evidence_changed_or_unavailable")


def run(
    query: QueryService,
    packet: Packet,
    plan: ReportPlan,
    *,
    writer: Engine | None = None,
) -> tuple[int | None, str]:
    """No writer means a read-only dry run; no provider, approval, or publication capability."""
    try:
        if writer is None:
            validate_current(query, packet, plan)
            return None, render(packet, plan, datetime.now(UTC))
        with writer.begin() as connection:
            connection.execute(text("SET LOCAL lock_timeout = '5s'"))
            connection.execute(text("SET LOCAL statement_timeout = '30s'"))
            if connection.execute(text("SELECT current_user")).scalar_one() != "tda_writer":
                raise ReportError("writer_role_required")
            key_lock(connection, "gtfs_activation", "carta-gtfs")
            # Block corrections, source revocations, feed switches, and run rollbacks until commit.
            # The reader snapshot is opened only after these locks are acquired.
            connection.execute(text("LOCK TABLE tda.fact, tda.source, tda.fetch_run IN SHARE MODE"))
            validate_current(query, packet, plan)
            generated_at = datetime.now(UTC)
            draft = render(packet, plan, generated_at)
            plan_hash = hashlib.sha256(plan.model_dump_json().encode()).hexdigest()
            ref = f"copilot-report:{packet.packet_hash}:{plan_hash}"
            item_id = submit(
                connection,
                "report",
                ref,
                AUTHOR,
                {
                    "schema_version": VERSION,
                    "model_mode": "operator-copilot-assisted",
                    "model_identity": "GitHub Copilot assistant; provider model ID not available to runtime",
                    "generation_attestation": "Operator supplies a plan after Copilot reads the packet; "
                    "the CLI cannot attest which assistant produced the file.",
                    "plan": plan.model_dump(mode="json"),
                    "packet": packet.model_dump(mode="json"),
                    "markdown": draft,
                    "draft_sha256": hashlib.sha256(draft.encode()).hexdigest(),
                    "generated_at": generated_at.isoformat(),
                    "fact_ids": [
                        e.fact_id
                        for e in packet.evidence
                        if e.id in {item.evidence_id for item in plan.opportunities} and e.fact_id is not None
                    ],
                },
            )
            connection.execute(
                text(
                    "INSERT INTO tda.agent_run "
                    "(task, provider, model, prompt_version, tools_called, cost_usd, status, "
                    "output_ref, finished_at) VALUES "
                    "('minimal_report', 'copilot-assisted', 'operator-session:unreported-model', :version, "
                    "CAST(:tools AS jsonb), 0, 'success', :ref, now())"
                ),
                {
                    "version": VERSION,
                    "tools": json.dumps(
                        [
                            {
                                "tool": "bounded_evidence_export",
                                "packet_hash": packet.packet_hash,
                                "evidence_ids": [e.id for e in packet.evidence],
                                "cost_basis": "no provider API calls; "
                                "Copilot session billing is outside this runtime",
                            }
                        ]
                    ),
                    "ref": f"review_item:{item_id}",
                },
            )
            return item_id, draft
    except ReportError as error:
        log.warning("report.rejected", violation=str(error))
        raise
