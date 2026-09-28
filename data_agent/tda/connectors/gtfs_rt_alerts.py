"""CARTA GTFS-realtime service alerts (P3.7, catalog S-2, source ``carta-gtfs-rt-alerts``).

The feed is a full snapshot of the active alerts, polled every few minutes over https (the catalog listed
http; https works, 05 §6a). Each changed snapshot is one run of ``service_alert`` rows, and
``current_service_alert`` is the latest successful snapshot.

- **Canonical body:** the feed header's timestamp changes on every poll, so the raw snapshot is stored with
  it cleared, entities sorted by id, and deterministic serialization. An unchanged set of alerts then has
  the same sha256 and is ``not_modified``.
- **Untrusted text** (02 §7.3): header, description, and url translations are stored as data only.

Data-quality checks. Any failure marks the run ``failed`` and loads nothing:
- the body parses as a GTFS-realtime FeedMessage (version 1.0 or 2.0) with a FULL_DATASET header;
- every entity has a unique id and is an alert, not deleted;
- each alert has at least one informed entity, and each one selects something;
- each active period is valid (start <= end when both are set, within the datetime range);
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
from google.protobuf.message import DecodeError
from google.transit import gtfs_realtime_pb2 as rt
from sqlalchemy import Connection, text

from tda.connectors.base import Connector, FetchResult, LoadStats, PriorRun, Row, ValidationFailed
from tda.connectors.registry import register
from tda.http.polite_client import NotModified, RequestBudget
from tda.store.observations import insert_observations

log = structlog.get_logger(__name__)

VERSIONS = ("1.0", "2.0")
SELECTORS = ("agency_id", "route_id", "route_type", "direction_id", "stop_id")
TRIP_FIELDS = ("trip_id", "route_id", "direction_id", "start_time", "start_date")


def canonical(raw: bytes) -> bytes:
    """The feed with its header timestamp cleared and entities sorted by id; unchanged if it doesn't parse."""
    message = rt.FeedMessage()
    try:
        message.ParseFromString(raw)
    except DecodeError:
        return raw
    out = rt.FeedMessage()
    out.header.CopyFrom(message.header)
    out.header.ClearField("timestamp")
    for entity in sorted(message.entity, key=lambda e: e.id):
        out.entity.add().CopyFrom(entity)
    return out.SerializeToString(deterministic=True)


def parse_alerts(raw: bytes) -> list[dict[str, Any]]:
    """Validate a FeedMessage and return one ``service_alert`` row per alert. Raises ValidationFailed."""
    message = rt.FeedMessage()
    try:
        message.ParseFromString(raw)
    except DecodeError:
        raise ValidationFailed("the body is not a GTFS-realtime FeedMessage") from None
    header = message.header
    if header.gtfs_realtime_version not in VERSIONS:
        raise ValidationFailed(f"unsupported gtfs_realtime_version {header.gtfs_realtime_version!r}")
    if header.incrementality != rt.FeedHeader.FULL_DATASET:
        raise ValidationFailed("only FULL_DATASET feeds are supported")
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
        if not entity.HasField("alert") or entity.HasField("trip_update") or entity.HasField("vehicle"):
            raise ValidationFailed(f"entity {entity.id!r} is not an alert")
        rows.append(_alert_row(entity.id, entity.alert))
    return rows


def _alert_row(alert_id: str, alert: Any) -> dict[str, Any]:
    periods = []
    for period in alert.active_period:
        start = period.start if period.HasField("start") else None
        end = period.end if period.HasField("end") else None
        if start is not None and end is not None and start > end:
            raise ValidationFailed(f"alert {alert_id!r}: an active period starts after it ends")
        periods.append({"start": start, "end": end})
    if not alert.informed_entity:
        raise ValidationFailed(f"alert {alert_id!r} has no informed_entity")
    starts, ends = [p["start"] for p in periods], [p["end"] for p in periods]
    return {
        "alert_id": _plain(alert_id, alert_id),
        "cause": _enum(alert, "cause", rt.Alert.Cause),
        "effect": _enum(alert, "effect", rt.Alert.Effect),
        "severity_level": _enum(alert, "severity_level", rt.Alert.SeverityLevel),
        # Open when there are no periods, or when any period is open on that side.
        "active_from": _time(alert_id, min(starts)) if periods and None not in starts else None,
        "active_until": _time(alert_id, max(ends)) if periods and None not in ends else None,
        "active_periods": _json(alert_id, periods),
        "informed_entities": _json(alert_id, [_selector(alert_id, s) for s in alert.informed_entity]),
        "header_text": _json(alert_id, _translations(alert, "header_text")),
        "description_text": _json(alert_id, _translations(alert, "description_text")),
        "url": _json(alert_id, _translations(alert, "url")),
    }


def _selector(alert_id: str, selector: Any) -> dict[str, Any]:
    chosen: dict[str, Any] = {f: getattr(selector, f) for f in SELECTORS if selector.HasField(f)}
    if selector.HasField("trip"):
        chosen["trip"] = {f: getattr(selector.trip, f) for f in TRIP_FIELDS if selector.trip.HasField(f)}
    if not chosen:
        raise ValidationFailed(f"alert {alert_id!r}: an informed_entity selects nothing")
    return chosen


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


def _plain(alert_id: str, value: str) -> str:
    if "\x00" in value:
        raise ValidationFailed(f"alert {alert_id!r} contains a NUL character")
    return value


def _json(alert_id: str, value: Any) -> str:
    """Canonical JSON for a jsonb column (sorted keys), refusing NUL, which jsonb can't store."""
    dumped = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    if "\\u0000" in dumped:
        raise ValidationFailed(f"alert {alert_id!r} contains a NUL character")
    return dumped


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
