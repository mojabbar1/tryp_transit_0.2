"""Response models for the read API. The committed OpenAPI snapshot (contracts/) is generated from these."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, PlainSerializer

# JSON has no decimal type: facts carry exact numerics in Postgres and are served as JSON numbers (02 §6.3).
JsonNumber = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


class SourceFreshness(BaseModel):
    """One row of the ``source_freshness`` view: the reader's only view of ingestion status."""

    source_id: str
    status: str
    cadence: str | None
    stale_after_hours: int | None
    last_success: datetime | None
    last_status: str | None
    stale: bool


class Health(BaseModel):
    """``ok``: the database answers and no approved source is stale; ``degraded``: one is stale."""

    status: Literal["ok", "degraded", "unavailable"]
    database: Literal["ok", "unreachable"]
    version: str
    sources: list[SourceFreshness]


class SourceOut(BaseModel):
    """An approved source's public fields, with the attribution clients must show."""

    id: str
    name: str
    kind: str
    url: str | None
    license: str | None
    terms_url: str | None
    attribution_text: str | None
    cadence: str | None


class Period(BaseModel):
    start: date | None
    end: date | None


class FactSource(BaseModel):
    """A cited source. ``retrieved`` is the UTC date of the latest successful input run from it, if any."""

    source_id: str
    attribution: str | None
    retrieved: date | None


class FactOut(BaseModel):
    """A citable fact: the current approved version of its key (02 §6.3)."""

    id: int
    key: str
    version: int
    supersedes_id: int | None
    value_num: JsonNumber | None
    value_text: str | None
    unit: str | None
    geography: str | None
    period: Period
    method: str | None
    sources: list[FactSource]
    derived_from: dict[str, Any]
    evidence: dict[str, Any]
    status: Literal["approved"]
    confidence: str | None
    valid_until: date | None


class FactPage(BaseModel):
    """One page of facts; pass ``next_cursor`` back as ``cursor`` for the next page."""

    items: list[FactOut]
    next_cursor: str | None


class Citation(BaseModel):
    """Where a number comes from: a source (with the attribution to show) and, for a fact, its id and key."""

    source_id: str | None
    attribution: str | None
    retrieved: date | None = None
    fact_id: int | None = None
    fact_key: str | None = None


class FeedOut(BaseModel):
    """The active GTFS feed an answer comes from, with the attribution clients must show."""

    source_id: str
    feed_version_id: int
    feed_label: str | None
    feed_start: date
    feed_end: date
    timezone: str
    loaded_at: datetime
    attribution: str | None


class StopOut(BaseModel):
    """A boardable stop of the active feed, with the route short names that serve it."""

    id: str
    code: str | None
    name: str | None
    lat: float
    lng: float
    route_short_names: list[str]


class NearbyStopOut(StopOut):
    """A stop and its great-circle distance from the requested point."""

    distance_m: float


class StopPage(BaseModel):
    feed: FeedOut
    items: list[StopOut]


class NearbyStopPage(BaseModel):
    feed: FeedOut
    items: list[NearbyStopOut]


class TripOut(BaseModel):
    """One boardable direct trip, from the schedule (``basis: scheduled``). Times are local, with an offset.

    ``leave_by`` (``arrive_by`` requests) is the departure minus the access buffer; ``wait_min``
    (``depart_at`` requests) is the time from the target to the departure. ``interpolated`` marks a blank GTFS
    time that was interpolated between the trip's timed stops.
    """

    basis: Literal["scheduled"]
    trip_id: str
    route_id: str
    route_short_name: str | None
    route_long_name: str | None
    headsign: str | None
    direction_id: int | None
    service_date: date
    departure: datetime
    arrival: datetime
    in_vehicle_min: float
    leave_by: datetime | None
    wait_min: float | None
    interpolated: bool


class CompareOut(BaseModel):
    """The best boardable direct trip and up to 3 alternatives, or a ``reason`` and no trip (02 §8.3).

    ``routing`` says this release looks up direct trips only (D-6 (a)): ``transfer_required`` means no single
    trip serves both stops, not that no journey exists.
    """

    transit: TripOut | None
    alternatives: list[TripOut]
    reason: Literal["no_boardable_trip", "transfer_required", "no_service", "unknown_stop"] | None
    routing: Literal["direct_only"]
    mode: Literal["arrive_by", "depart_at"]
    target: datetime
    access_buffer_min: JsonNumber
    feed: FeedOut
    citations: list[Citation]


class AlertOut(BaseModel):
    """An active service alert. Its text is untrusted third-party data (02 §7.3): show it as plain text only.

    ``header_text``, ``description_text``, and ``url`` are the English translation (or else the untagged or
    the first one). ``url`` is dropped unless it is http(s).
    """

    alert_id: str
    source_id: str
    cause: str | None
    effect: str | None
    severity_level: str | None
    header_text: str | None
    description_text: str | None
    url: str | None
    active_from: datetime | None
    active_until: datetime | None
    route_ids: list[str]
    stop_ids: list[str]


class AlertPage(BaseModel):
    items: list[AlertOut]
    citations: list[Citation]


class AssumptionOut(BaseModel):
    """An assumption the web cost and CO2 model uses, and the approved fact behind it (its key can differ)."""

    key: str
    fact: FactOut


class AssumptionsOut(BaseModel):
    """Approved facts only. ``missing`` lists the assumptions with no approved fact (reported as degraded)."""

    items: list[AssumptionOut]
    missing: list[str]


class StatOut(BaseModel):
    """A headline stat: one approved fact, with its citations."""

    id: str
    label: str
    value_num: JsonNumber | None
    value_text: str | None
    unit: str | None
    period: Period
    citations: list[Citation]


class StatsOut(BaseModel):
    """Curated headline stats from approved facts only; a stat without an approved fact is absent."""

    items: list[StatOut]
