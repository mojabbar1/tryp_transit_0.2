"""CARTA GTFS-realtime service alerts (P3.7, catalog S-2, source ``carta-gtfs-rt-alerts``).

The feed is a full snapshot of the active alerts, polled every few minutes over https (the catalog listed
http; https works, 05 §6a). Each changed snapshot is one run of ``service_alert`` rows, and
``current_service_alert`` is the latest successful snapshot.

- **Canonical body:** the feed header's timestamp changes on every poll, so the stored raw snapshot is the
  whole message with that timestamp cleared and entities sorted by id (unknown fields and extensions kept),
  serialized deterministically. An unchanged set of alerts then has the same sha256 and is ``not_modified``.
  Deterministic means repeatable for the pinned protobuf runtime, not a universal canonical form: an upgrade
  may change the bytes, which costs one extra load. A body that doesn't decode, or lacks required fields, is
  stored unchanged, so a failed run keeps the evidence.
- **Nothing known is dropped:** each row keeps typed columns for querying, plus the complete alert as JSON.
- **Untrusted text** (02 §7.3): alert text is stored as data only.

Data-quality checks. Any failure marks the run ``failed`` and loads nothing:
- the body parses as a GTFS-realtime FeedMessage (version 1.0 or 2.0) with every required field and a
  FULL_DATASET header;
- every entity has a unique id and carries an alert and no other payload, and isn't deleted;
- each alert has at least one informed entity. Each one selects something real: empty IDs and empty trips
  don't count, and a direction_id needs a route_id. A modified trip is kept;
- every active, communication, and impact period has a bound, each bound is a valid time, and start <= end;
- no text contains a NUL character (PostgreSQL can't store one).
An informed entity naming a route or stop that the active GTFS feed doesn't have is logged
(``gtfs_rt.unknown_references``), not fatal: an alert can refer to service the schedule doesn't list yet.
"""

from __future__ import annotations

import dataclasses
import json
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

import structlog
from google.protobuf.json_format import MessageToDict
from google.protobuf.message import DecodeError, EncodeError
from google.transit import gtfs_realtime_pb2 as rt
from sqlalchemy import Connection, text

from tda.connectors.base import Connector, FetchResult, LoadStats, PriorRun, Row, ValidationFailed
from tda.connectors.registry import register
from tda.http.polite_client import NotModified, RequestBudget
from tda.store.observations import insert_observations

log = structlog.get_logger(__name__)

VERSIONS = ("1.0", "2.0")
PERIODS = ("active_period", "communication_period", "impact_period")
IDS = ("agency_id", "route_id", "stop_id")
TRIP_IDS = ("trip_id", "route_id", "start_time", "start_date")
MODIFIED_TRIP_IDS = ("modifications_id", "affected_trip_id", "start_time", "start_date")


def canonical(raw: bytes) -> bytes:
    """The whole feed, header timestamp cleared and entities sorted by id; ``raw`` if that can't be done."""
    message = rt.FeedMessage()
    try:
        message.ParseFromString(raw)
    except DecodeError:
        return raw
    if not message.IsInitialized():
        return raw
    out = rt.FeedMessage()
    out.CopyFrom(message)
    out.header.ClearField("timestamp")
    del out.entity[:]
    for entity in sorted(message.entity, key=lambda e: e.id):
        out.entity.add().CopyFrom(entity)
    try:
        return out.SerializeToString(deterministic=True)
    except EncodeError:
        return raw


def parse_alerts(raw: bytes) -> list[dict[str, Any]]:
    """Validate a FeedMessage and return one ``service_alert`` row per alert. Raises ValidationFailed."""
    message = rt.FeedMessage()
    try:
        message.ParseFromString(raw)
    except DecodeError:
        raise ValidationFailed("the body is not a GTFS-realtime FeedMessage") from None
    if not message.IsInitialized():
        missing = ", ".join(message.FindInitializationErrors()[:5])
        raise ValidationFailed(f"the feed is missing required fields: {missing}")
    header = message.header
    if header.gtfs_realtime_version not in VERSIONS:
        raise ValidationFailed(f"unsupported gtfs_realtime_version {header.gtfs_realtime_version!r}")
    if header.incrementality != rt.FeedHeader.FULL_DATASET:
        raise ValidationFailed("only FULL_DATASET feeds are supported")
    payloads = [f.name for f in rt.FeedEntity.DESCRIPTOR.fields if f.message_type is not None]
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entity in message.entity:
        if not entity.id:
            raise ValidationFailed("an entity has no id")
        if entity.id in seen:
            raise ValidationFailed(f"duplicate entity id {entity.id!r}")
        seen.add(entity.id)
        if entity.is_deleted:
            raise ValidationFailed(f"entity {entity.id!r} is deleted, which a FULL_DATASET feed doesn't use")
        if [name for name in payloads if entity.HasField(name)] != ["alert"]:
            raise ValidationFailed(f"entity {entity.id!r} is not an alert alone")
        rows.append(_alert_row(entity.id, entity.alert))
    return rows


def _alert_row(alert_id: str, alert: Any) -> dict[str, Any]:
    periods = {field: _periods(alert_id, alert, field) for field in PERIODS}
    if not alert.informed_entity:
        raise ValidationFailed(f"alert {alert_id!r} has no informed_entity")
    active = periods["active_period"]
    starts, ends = [p["start"] for p in active], [p["end"] for p in active]
    row = {
        "alert_id": alert_id,
        "cause": _enum(alert, "cause", rt.Alert.Cause),
        "effect": _enum(alert, "effect", rt.Alert.Effect),
        "severity_level": _enum(alert, "severity_level", rt.Alert.SeverityLevel),
        # The envelope of active_period; open when there are none, or when any is open on that side.
        "active_from": _time(alert_id, min(starts)) if active and None not in starts else None,
        "active_until": _time(alert_id, max(ends)) if active and None not in ends else None,
        "active_periods": active,
        "communication_periods": periods["communication_period"],
        "impact_periods": periods["impact_period"],
        "informed_entities": [_selector(alert_id, s) for s in alert.informed_entity],
        "header_text": _translations(alert, "header_text"),
        "description_text": _translations(alert, "description_text"),
        "url": _translations(alert, "url"),
        "alert": MessageToDict(alert, preserving_proto_field_name=True),
    }
    _no_nul(alert_id, row)
    return {
        k: json.dumps(v, sort_keys=True, ensure_ascii=False) if _is_json(k) else v for k, v in row.items()
    }


def _is_json(column: str) -> bool:
    return column not in ("alert_id", "cause", "effect", "severity_level", "active_from", "active_until")


def _periods(alert_id: str, alert: Any, field: str) -> list[dict[str, int | None]]:
    periods = []
    for n, period in enumerate(getattr(alert, field), start=1):
        start = period.start if period.HasField("start") else None
        end = period.end if period.HasField("end") else None
        if start is None and end is None:
            raise ValidationFailed(f"alert {alert_id!r}: {field} {n} has neither start nor end")
        for bound in (start, end):
            if bound is not None:
                _time(alert_id, bound)
        if start is not None and end is not None and start > end:
            raise ValidationFailed(f"alert {alert_id!r}: {field} {n} starts after it ends")
        periods.append({"start": start, "end": end})
    return periods


def _selector(alert_id: str, selector: Any) -> dict[str, Any]:
    chosen: dict[str, Any] = {f: getattr(selector, f) for f in IDS if getattr(selector, f)}
    for field in ("route_type", "direction_id"):
        if selector.HasField(field):
            chosen[field] = getattr(selector, field)
    trip = _trip(selector.trip) if selector.HasField("trip") else {}
    if trip.keys() & {"trip_id", "route_id", "modified_trip"}:
        chosen["trip"] = trip
    if "direction_id" in chosen and "route_id" not in chosen:
        raise ValidationFailed(f"alert {alert_id!r}: an informed_entity has a direction_id but no route_id")
    if not chosen.keys() - {"direction_id"}:
        raise ValidationFailed(f"alert {alert_id!r}: an informed_entity selects nothing")
    return chosen


def _trip(trip: Any) -> dict[str, Any]:
    out: dict[str, Any] = {f: getattr(trip, f) for f in TRIP_IDS if getattr(trip, f)}
    if trip.HasField("direction_id"):
        out["direction_id"] = trip.direction_id
    if trip.HasField("schedule_relationship"):
        out["schedule_relationship"] = rt.TripDescriptor.ScheduleRelationship.Name(trip.schedule_relationship)
    if trip.HasField("modified_trip"):
        modified = {
            f: getattr(trip.modified_trip, f) for f in MODIFIED_TRIP_IDS if getattr(trip.modified_trip, f)
        }
        if modified:
            out["modified_trip"] = modified
    return out


def _translations(alert: Any, field: str) -> list[dict[str, str | None]]:
    if not alert.HasField(field):
        return []
    return [{"text": t.text, "language": t.language or None} for t in getattr(alert, field).translation]


def _enum(message: Any, field: str, enum: Any) -> str | None:
    return enum.Name(getattr(message, field)) if message.HasField(field) else None


def _time(alert_id: str, seconds: int) -> datetime:
    try:
        return datetime.fromtimestamp(seconds, tz=UTC)
    except (OverflowError, OSError, ValueError):
        raise ValidationFailed(f"alert {alert_id!r}: time {seconds} is out of range") from None


def _no_nul(alert_id: str, value: Any) -> None:
    """Refuse a real NUL character anywhere in the alert: PostgreSQL text and jsonb can't store one."""
    if isinstance(value, str):
        if "\x00" in value:
            raise ValidationFailed(f"alert {alert_id!r} contains a NUL character")
    elif isinstance(value, dict):
        for key, item in value.items():
            _no_nul(alert_id, key)
            _no_nul(alert_id, item)
    elif isinstance(value, list):
        for item in value:
            _no_nul(alert_id, item)


@register
class GtfsRtAlertsConnector(Connector):
    """CARTA's GTFS-realtime service alerts, polled every few minutes."""

    source_id = "carta-gtfs-rt-alerts"
    owned_tables = ("service_alert",)

    def fetch(self, prior: PriorRun | None, budget: RequestBudget | None) -> FetchResult | NotModified:
        result = self.http_get(prior, budget, ext="pb")
        if isinstance(result, NotModified):
            return result
        return dataclasses.replace(result, body=canonical(result.body))

    def normalize(self, raw: bytes) -> Iterable[Row]:
        yield from parse_alerts(raw)

    def load(self, connection: Connection, rows: list[Row], run_id: int) -> LoadStats:
        _warn_unknown_references(connection, rows, run_id)
        return LoadStats({"service_alert": insert_observations(connection, "service_alert", rows, run_id)})


def _warn_unknown_references(connection: Connection, rows: list[Row], run_id: int) -> None:
    """Log routes and stops the alerts name that the active GTFS feed doesn't have (not fatal)."""
    selectors = [s for row in rows for s in json.loads(str(row["informed_entities"]))]
    routes = {s["route_id"] for s in selectors if "route_id" in s} | {
        s["trip"]["route_id"] for s in selectors if "route_id" in s.get("trip", {})
    }
    stops = {s["stop_id"] for s in selectors if "stop_id" in s}
    if not routes and not stops:
        return
    active = connection.execute(
        text("SELECT id FROM tda.current_gtfs_feed_version WHERE is_active AND source_id = 'carta-gtfs'")
    ).scalar_one_or_none()
    if active is None:
        log.warning(
            "gtfs_rt.unknown_references", run_id=run_id, reason="no active GTFS feed to check against"
        )
        return
    known_routes = set(
        connection.execute(
            text("SELECT route_id FROM tda.current_gtfs_route WHERE feed_version_id = :v"), {"v": active}
        ).scalars()
    )
    known_stops = set(
        connection.execute(
            text("SELECT stop_id FROM tda.current_gtfs_stop WHERE feed_version_id = :v"), {"v": active}
        ).scalars()
    )
    unknown_routes, unknown_stops = sorted(routes - known_routes), sorted(stops - known_stops)
    if unknown_routes or unknown_stops:
        log.warning(
            "gtfs_rt.unknown_references",
            run_id=run_id,
            feed_version_id=active,
            routes=unknown_routes,
            stops=unknown_stops,
        )
