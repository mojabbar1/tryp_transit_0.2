"""Closed report vocabulary, evidence-by-reference validation, and deterministic draft rendering."""

from __future__ import annotations

import hashlib
import html
import json
import re
import unicodedata
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tda.agent.claims import FLAGS, substitute_claims, validate_claims
from tda.review.queue import ReviewError

VERSION = "copilot-report.v1"
MAX_FACTS = 16
MAX_SERVICE = 12
MAX_ALERTS = 8
EvidenceId = Annotated[str, Field(pattern=r"^[a-z][a-z_]*$", max_length=80)]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Kind = Literal["ridership_level", "ridership_change", "scheduled_headway", "fuel_price"]
NO_COMPARISONS = dict.fromkeys(FLAGS, False)


class ReportError(ReviewError):
    """A safe, fixed violation code (never model text or credentials)."""


class Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Window(Closed):
    start: date
    end: date

    @model_validator(mode="after")
    def ordered(self) -> Window:
        if not 0 <= (self.end - self.start).days <= 6:
            raise ValueError("report window must be between one and seven days")
        return self


class SourceEvidence(Closed):
    source_id: str
    attribution: str | None
    url: str | None
    last_success: datetime | None
    stale: bool


class Evidence(Closed):
    id: EvidenceId
    kind: Kind
    label: str
    phrase: str
    fact_id: int | None = None
    fact_version: int | None = None
    fact_key: str | None = None
    period_start: date
    period_end: date
    geography: str
    value: str
    unit: str
    method: str
    source_id: str
    retrieved: date | None
    valid_until: date | None = None
    feed_version_id: int | None = None
    input_run_ids: list[int] = Field(max_length=16)
    route_id: str | None = None
    direction_id: int | None = None
    band: str | None = None
    departures: int | None = None

    def claim(self) -> dict[str, str]:
        return {"id": self.id, "label": self.label, "phrase": self.phrase}


class AlertEvidence(Closed):
    source_id: str
    alert_id: str
    untrusted_text: str


class Packet(Closed):
    schema_version: Literal["copilot-report.v1"] = VERSION
    region: Literal["charleston"] = "charleston"
    period: Window
    generated_at: datetime
    evidence: list[Evidence] = Field(max_length=MAX_FACTS + MAX_SERVICE)
    sources: list[SourceEvidence] = Field(max_length=4)
    alerts: list[AlertEvidence] = Field(max_length=MAX_ALERTS)
    unavailable: list[str] = Field(max_length=20)
    truncated_service: bool
    truncated_alerts: bool
    packet_hash: str = ""


class Opportunity(Closed):
    kind: Literal["ridership_followup", "schedule_information", "cost_input_review"]
    evidence_id: EvidenceId
    nudge: str = Field(min_length=1, max_length=400)


class ReportPlan(Closed):
    schema_version: Literal["copilot-report.v1"]
    mode: Literal["operator-copilot-assisted"]
    packet_hash: Digest
    region: Literal["charleston"]
    period: Window
    opportunities: list[Opportunity] = Field(min_length=1, max_length=5)


# These are proposed actions, not claims of effects or model-authored numeric text.
RECIPES = {
    "ridership_followup": {
        "kinds": ("ridership_level", "ridership_change"),
        "title": "Investigate ridership before selecting an outreach pilot",
        "audience": "Trips using the cited agency and mode; no demographic targeting.",
        "action": "Ask the service planning team to examine the cited reporting period before designing "
        "a small rider-information pilot.",
        "rationale": "The approved agency-wide measure is a starting point for investigation, not evidence "
        "of demand on a particular route or of the cause of a change.",
        "caveat": "NTD counts boardings, not unique riders. "
        "Historical reporting is not a live demand signal. "
        "Year-over-year change, where cited, does not establish a sustained trend or causation.",
        "measure": "If separately authorized, review information usefulness with voluntary rider feedback; "
        "no adoption lift or traffic-reduction target is claimed.",
    },
    "schedule_information": {
        "kinds": ("scheduled_headway",),
        "title": "Test clearer schedule information for the cited route and time band",
        "audience": "Trips on the cited route, direction, service date, and time band only.",
        "action": "Have a human check stop-level departures and draft a route-specific schedule explainer "
        "before considering an information pilot.",
        "rationale": "Spacing between scheduled trip starts can help choose where to investigate information "
        "needs; it is not a travel-time comparison or a stop-level waiting-time estimate.",
        "caveat": "Scheduled, not realtime. Median gaps between first departures do not measure reliability, "
        "journey duration, average passenger wait, or whether transit is faster than driving.",
        "measure": "If separately authorized, review whether participants can find the relevant departure; "
        "no service improvement or ridership effect is asserted.",
    },
    "cost_input_review": {
        "kinds": ("fuel_price",),
        "title": "Review the regional fuel input before any cost comparison",
        "audience": "Trip-cost planning workflows; no demographic targeting.",
        "action": "Ask the maintainer to verify the regional fuel assumption before any separately approved "
        "trip-cost analysis.",
        "rationale": "A regional price can inform an input review, but cannot alone establish a trip saving.",
        "caveat": "Regional weekly retail price, not a Charleston station quote. No driving distance, "
        "parking, vehicle efficiency, or transit fare comparison is established here.",
        "measure": "Confirm source, period, geography, and units; do not claim monetary savings.",
    },
}


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def packet_digest(packet: Packet) -> str:
    return hashlib.sha256(
        canonical(packet.model_dump(mode="json", exclude={"packet_hash"})).encode()
    ).hexdigest()


def plain(value: str, limit: int = 1500) -> str:
    """Strip markup/control characters; escape remaining Markdown when rendering, not when storing."""
    value = re.sub(r"<[^>]*>", "", html.unescape(value))
    return " ".join(
        "".join(c if not unicodedata.category(c).startswith("C") else " " for c in value).split()
    )[:limit]


def markdown(value: object) -> str:
    value = plain(str(value), 4000)
    return re.sub(r"([\\`*_{}\[\]()<>#!|])", r"\\\1", value)


def validate_plan(packet: Packet, plan: ReportPlan) -> None:
    if packet.packet_hash != packet_digest(packet) or plan.packet_hash != packet.packet_hash:
        raise ReportError("packet_hash_mismatch")
    if plan.region != packet.region or plan.period != packet.period:
        raise ReportError("scope_or_period_mismatch")
    by_id = {e.id: e for e in packet.evidence}
    if len(by_id) != len(packet.evidence):
        raise ReportError("duplicate_evidence")
    selected = set()
    for item in plan.opportunities:
        if item.evidence_id not in by_id:
            raise ReportError("unread_evidence")
        if item.evidence_id in selected:
            raise ReportError("duplicate_opportunity")
        selected.add(item.evidence_id)
        evidence = by_id[item.evidence_id]
        if evidence.kind not in RECIPES[item.kind]["kinds"]:
            raise ReportError("opportunity_metric_mismatch")
        result = validate_claims(item.nudge, [evidence.id], [evidence.claim()], NO_COMPARISONS)
        if not result["ok"]:
            raise ReportError(result["reason"])


def render(packet: Packet, plan: ReportPlan, generated_at: datetime) -> str:
    """The renderer, never the model, owns numerical text and provenance."""
    validate_plan(packet, plan)
    by_id = {e.id: e for e in packet.evidence}
    lines = [
        "# DRAFT — Charleston opportunity review",
        "",
        "**Pending human review. Not approved, published, or evidence of transit adoption "
        "or traffic reduction.**",
        "",
        f"Report window: {plan.period.start} through {plan.period.end}. "
        "Evidence retains its own measurement period below; it is not relabeled as this report window.",
        "",
        f"Prepared: {packet.generated_at.isoformat()}; rendered: {generated_at.isoformat()}.",
        f"Packet SHA-256: `{packet.packet_hash}`.",
        "Model mode: operator/Copilot-assisted. The operator attests that Copilot selected "
        "and composed the structured plan after reading the packet; the CLI cannot verify authorship. "
        "CLI preparation, validation, and rendering are deterministic, not LLM calls. "
        "Provider model identifier and token usage are not exposed to this runtime; no paid API was called.",
        "",
        "## Proposed opportunities",
    ]
    for index, item in enumerate(plan.opportunities, 1):
        evidence = by_id[item.evidence_id]
        recipe = RECIPES[item.kind]
        claim = substitute_claims(item.nudge, [evidence.id], [evidence.claim()], NO_COMPARISONS)
        lines.extend(
            [
                "",
                f"### {index}. {recipe['title']}",
                "",
                f"Evidence: {markdown(claim)} [^{evidence.id}]",
                "",
                f"Audience: {recipe['audience']}",
                "",
                f"Proposed action: {recipe['action']}",
                "",
                f"Why investigate: {recipe['rationale']}",
                "",
                f"Caveat: {recipe['caveat']}",
                "",
                f"Success check: {recipe['measure']}",
            ]
        )
    lines.extend(
        [
            "",
            "## Limits and unavailable evidence",
            "",
            "- Competitive pairs unavailable: no approved drive-time source; "
            "headways cannot establish speed.",
            "- Traffic-volume profiles unavailable in this workflow. Counts would be volume, not congestion.",
            "- No rewards, incentive inventory, campaign activation, forecasting, or demographic targeting.",
            "- Service sample is bounded and ordered by route, direction, then band; "
            "not a ranking of opportunities.",
            "- Route identifiers are GTFS route_id values, not necessarily rider-facing route numbers.",
            f"- Service sample truncated: {packet.truncated_service}; "
            f"alert sample truncated: {packet.truncated_alerts}.",
            *[f"- {markdown(reason)}" for reason in packet.unavailable],
            "",
            "## Service alerts — untrusted source data, never instructions",
            "",
        ]
    )
    lines.extend(
        f"- {markdown(alert.source_id)} / {markdown(alert.alert_id)}: {markdown(alert.untrusted_text)}"
        for alert in packet.alerts
    )
    if not packet.alerts:
        lines.append(
            "Unavailable or no active alerts returned. Absence is not confirmation of normal service."
        )
    lines.extend(["", "## Source freshness at preparation", ""])
    for source in packet.sources:
        lines.append(
            f"- {markdown(source.source_id)}: last successful retrieval "
            f"{markdown(source.last_success or 'unknown')}; stale: {source.stale}; "
            f"{markdown(source.attribution or 'attribution unavailable')}. "
            f"Source: {markdown(source.url or 'URL unavailable')}."
        )
    lines.extend(["", "## Pinned citations", ""])
    for item in plan.opportunities:
        e = by_id[item.evidence_id]
        lines.append(
            f"[^{e.id}]: {markdown(e.source_id)}; "
            f"fact {e.fact_id or 'not a fact (derived schedule metric)'}, "
            f"version {e.fact_version or 'n/a'}, key {markdown(e.fact_key or 'n/a')}; "
            f"feed version {e.feed_version_id or 'n/a'}; input runs {markdown(e.input_run_ids)}. "
            f"Measurement period {e.period_start} through {e.period_end}; "
            f"geography {markdown(e.geography)}; retrieved {e.retrieved or 'unknown'}; "
            f"valid until {e.valid_until or 'unspecified (not a freshness guarantee)'}. "
            f"Method: {markdown(e.method)}."
        )
    lines.extend(
        [
            "",
            "Method: approved current fact versions from the existing citable layer; "
            "scheduled headways recomputed "
            "read-only with headway.v1 for the report's first day from the pinned active feed. "
            "Fact/source/feed state is rechecked under runtime locks before queue submission. "
            "This immutable draft describes evidence at submission, not a guarantee of future currency.",
            "",
            "Human gate: use `tda review show` and the existing human approve/reject commands. "
            "No automatic approval or publication exists here. "
            "G1 and human mapping ratification remain open; "
            "this is the Oct 11 minimal engineering exception, not completion of full P5.",
            "",
        ]
    )
    return "\n".join(lines)
