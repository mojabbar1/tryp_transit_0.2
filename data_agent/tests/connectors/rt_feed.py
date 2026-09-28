"""Build synthetic GTFS-realtime alert feeds, with route and stop IDs from the synthetic GTFS fixture."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from google.transit import gtfs_realtime_pb2 as rt

# 2026-09-28 13:00Z and three hours later.
START, END = 1790600400, 1790611200


def detour(alert: Any) -> None:
    """A detour on route R1 at stop FX03, with English and Spanish headers."""
    alert.cause = rt.Alert.CONSTRUCTION
    alert.effect = rt.Alert.DETOUR
    period = alert.active_period.add()
    period.start, period.end = START, END
    alert.informed_entity.add(route_id="R1")
    alert.informed_entity.add(stop_id="FX03")
    alert.header_text.translation.add(text="Route 1 detour", language="en")
    alert.header_text.translation.add(text="Desvío de la ruta 1", language="es")
    alert.description_text.translation.add(text="Use FX04 while FX03 is closed.", language="en")


def open_ended(alert: Any) -> None:
    """An alert on route R2 with no end, no language, and a trip selector."""
    alert.effect = rt.Alert.REDUCED_SERVICE
    alert.active_period.add().start = START
    alert.informed_entity.add().trip.CopyFrom(rt.TripDescriptor(trip_id="T3", route_id="R2"))
    alert.header_text.translation.add(text="Fewer trips on route 2")


def feed(
    alerts: dict[str, Callable[[Any], None]] | None = None,
    *,
    timestamp: int = START,
    version: str = "2.0",
    edit: Callable[[Any], None] | None = None,
) -> bytes:
    """A FULL_DATASET FeedMessage: by default the detour (``A1``) and the open-ended alert (``A2``)."""
    message = rt.FeedMessage()
    message.header.gtfs_realtime_version = version
    message.header.incrementality = rt.FeedHeader.FULL_DATASET
    message.header.timestamp = timestamp
    for entity_id, build in (alerts if alerts is not None else {"A1": detour, "A2": open_ended}).items():
        entity = message.entity.add(id=entity_id)
        build(entity.alert)
    if edit is not None:
        edit(message)
    return message.SerializeToString()
