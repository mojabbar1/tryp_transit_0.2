"""GTFS endpoints (P4a): stops, nearest stops, direct-route compare (02 §8.3), and active service alerts.

Every answer comes from the active feed of an approved source, cites it, and never invents a number: without a
boardable direct trip, ``/v1/compare`` returns a reason and no trip.
"""

from __future__ import annotations

import re
from datetime import UTC, date, time, timedelta
from typing import Annotated, Any

from fastapi import HTTPException, Query
from sqlalchemy import Connection, text

from tda.api.citable import approved_facts
from tda.api.deps import DB, Now
from tda.api.schemas import (
    AlertOut,
    AlertPage,
    Citation,
    CompareOut,
    FeedOut,
    NearbyStopOut,
    NearbyStopPage,
    StopOut,
    StopPage,
    TripOut,
)
from tda.metrics.compare import Comparison, TripOption, compare
from tda.metrics.feeds import (
    ActiveFeed,
    AmbiguousFeed,
    NoActiveFeed,
    Stop,
    active_feed,
    nearest_stops,
    search_stops,
)

MAX_STOPS = 2000
MAX_NEAREST = 50
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
ACCESS_BUFFER_KEY = "transit.access_buffer_min"
SAFE_URL = re.compile(r"^https?://", re.IGNORECASE)

SourceId = Annotated[
    str | None, Query(max_length=100, description="The GTFS source; needed only when several are active.")
]


def _feed(connection: Connection, source_id: str | None) -> ActiveFeed:
    try:
        return active_feed(connection, source_id)
    except NoActiveFeed as error:
        raise HTTPException(status_code=503, detail=str(error)) from None
    except AmbiguousFeed as error:
        raise HTTPException(status_code=422, detail=str(error)) from None


def _attribution(connection: Connection, source_ids: list[str]) -> dict[str, str | None]:
    return dict(
        connection.execute(
            text("SELECT id, attribution_text FROM tda.source WHERE id = ANY(:ids)"), {"ids": source_ids}
        ).all()
    )


def _feed_out(connection: Connection, feed: ActiveFeed) -> FeedOut:
    return FeedOut(
        source_id=feed.source_id,
        feed_version_id=feed.feed_version_id,
        feed_label=feed.feed_label,
        feed_start=feed.feed_start,
        feed_end=feed.feed_end,
        timezone=feed.timezone,
        loaded_at=feed.loaded_at,
        attribution=_attribution(connection, [feed.source_id]).get(feed.source_id),
    )


def _stop(stop: Stop) -> dict[str, Any]:
    return {
        "id": stop.stop_id,
        "code": stop.code,
        "name": stop.name,
        "lat": stop.lat,
        "lng": stop.lng,
        "route_short_names": list(stop.route_short_names),
    }


def stops(
    connection: DB,
    query: Annotated[
        str | None, Query(max_length=100, description="Part of a name, or an exact id or code.")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_STOPS)] = 20,
    source_id: SourceId = None,
) -> StopPage:
    """Boardable stops of the active feed, by name (matches on id or code first)."""
    feed = _feed(connection, source_id)
    found = search_stops(connection, feed, query.strip() if query else None, limit)
    return StopPage(feed=_feed_out(connection, feed), items=[StopOut(**_stop(s)) for s in found])


def nearest(
    connection: DB,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lng: Annotated[float, Query(ge=-180, le=180)],
    limit: Annotated[int, Query(ge=1, le=MAX_NEAREST)] = 5,
    source_id: SourceId = None,
) -> NearbyStopPage:
    """The boardable stops nearest to a point, nearest first, with their distance in meters."""
    feed = _feed(connection, source_id)
    found = nearest_stops(connection, feed, lat, lng, limit)
    items = [NearbyStopOut(**_stop(s), distance_m=round(s.distance_m or 0.0, 1)) for s in found]
    return NearbyStopPage(feed=_feed_out(connection, feed), items=items)


def compare_trips(
    connection: DB,
    now: Now,
    origin_stop_id: Annotated[str, Query(min_length=1, max_length=100)],
    dest_stop_id: Annotated[str, Query(min_length=1, max_length=100)],
    day: Annotated[date, Query(alias="date", description="The local service date (YYYY-MM-DD).")],
    arrive_by: Annotated[
        str | None, Query(pattern=HHMM, description="Local HH:MM at the destination.")
    ] = None,
    depart_at: Annotated[
        str | None, Query(pattern=HHMM, description="Local HH:MM at the origin stop.")
    ] = None,
    source_id: SourceId = None,
) -> CompareOut:
    """The best boardable direct trip and up to 3 alternatives, or a reason (``basis: scheduled``, D-6)."""
    if (arrive_by is None) == (depart_at is None):
        raise HTTPException(status_code=422, detail="pass exactly one of arrive_by and depart_at")
    if origin_stop_id == dest_stop_id:
        raise HTTPException(status_code=422, detail="the origin and destination are the same stop")
    feed = _feed(connection, source_id)
    buffer = next(iter(approved_facts(connection, [ACCESS_BUFFER_KEY])), None)
    if buffer is None or buffer.value_num is None or buffer.value_num < 0:
        raise HTTPException(status_code=503, detail=f"{ACCESS_BUFFER_KEY} has no usable approved fact")
    mode = "arrive_by" if arrive_by is not None else "depart_at"
    hours, minutes = (int(part) for part in (arrive_by or depart_at or "").split(":"))
    access = timedelta(minutes=float(buffer.value_num))
    result = compare(
        connection,
        feed,
        origin=origin_stop_id,
        dest=dest_stop_id,
        day=day,
        mode=mode,
        at=time(hours, minutes),
        access_buffer=access,
        now=now,
    )
    trips = [_trip(option, result, access) for option in ([result.best] if result.best else [])]
    gtfs = Citation(
        source_id=feed.source_id, attribution=_attribution(connection, [feed.source_id]).get(feed.source_id)
    )
    buffer_citation = Citation(
        source_id=buffer.sources[0].source_id if buffer.sources else None,
        attribution=buffer.sources[0].attribution if buffer.sources else None,
        fact_id=buffer.id,
        fact_key=buffer.key,
    )
    return CompareOut(
        transit=trips[0] if trips else None,
        alternatives=[_trip(option, result, access) for option in result.alternatives],
        reason=result.reason,
        routing="direct_only",
        mode=mode,
        target=result.target,
        access_buffer_min=buffer.value_num,
        feed=_feed_out(connection, feed),
        citations=[gtfs, buffer_citation],
    )


def _trip(option: TripOption, result: Comparison, access: timedelta) -> TripOut:
    arrive_by = result.mode == "arrive_by"
    zone = option.departure.tzinfo
    return TripOut(
        basis="scheduled",
        trip_id=option.trip_id,
        route_id=option.route_id,
        route_short_name=option.route_short_name,
        route_long_name=option.route_long_name,
        headsign=option.headsign,
        direction_id=option.direction_id,
        service_date=option.service_date,
        departure=option.departure,
        arrival=option.arrival,
        in_vehicle_min=option.in_vehicle_min,
        # Elapsed time, not wall-clock arithmetic, so a DST change can't shift it.
        leave_by=(option.departure.astimezone(UTC) - access).astimezone(zone) if arrive_by else None,
        wait_min=None if arrive_by else (option.departure - result.target).total_seconds() / 60,
        interpolated=option.interpolated,
    )


def alerts(
    connection: DB,
    now: Now,
    route_id: Annotated[
        str | None, Query(max_length=100, description="Only alerts for this route, plus agency-wide ones.")
    ] = None,
) -> AlertPage:
    """Alerts active now, from approved sources' latest snapshot. The text is data, never instructions."""
    rows = connection.execute(
        text(
            "SELECT source_id, alert_id, cause, effect, severity_level, active_from, active_until, "
            "active_periods, informed_entities, header_text, description_text, url "
            "FROM tda.approved_service_alert ORDER BY source_id, alert_id"
        )
    ).all()
    at = now.timestamp()
    items = []
    for row in rows:
        selectors = row.informed_entities
        if not _active(row.active_periods, at) or (
            route_id is not None and not _applies(selectors, route_id)
        ):
            continue
        link = _plain(row.url)
        items.append(
            AlertOut(
                alert_id=row.alert_id,
                source_id=row.source_id,
                cause=row.cause,
                effect=row.effect,
                severity_level=row.severity_level,
                header_text=_plain(row.header_text),
                description_text=_plain(row.description_text),
                url=link if link and SAFE_URL.match(link) else None,
                active_from=row.active_from,
                active_until=row.active_until,
                route_ids=sorted(_routes(selectors)),
                stop_ids=sorted({s["stop_id"] for s in selectors if "stop_id" in s}),
            )
        )
    cited = sorted({item.source_id for item in items})
    names = _attribution(connection, cited)
    return AlertPage(items=items, citations=[Citation(source_id=s, attribution=names.get(s)) for s in cited])


def _active(periods: list[dict[str, int | None]], at: float) -> bool:
    """GTFS-realtime: active in [start, end); no periods means always; a missing bound is open."""
    if not periods:
        return True
    return any(
        (p.get("start") is None or p["start"] <= at) and (p.get("end") is None or at < p["end"])
        for p in periods
    )


def _routes(selectors: list[dict[str, Any]]) -> set[str]:
    return {s["route_id"] for s in selectors if "route_id" in s} | {
        s["trip"]["route_id"] for s in selectors if "route_id" in s.get("trip", {})
    }


def _applies(selectors: list[dict[str, Any]], route_id: str) -> bool:
    """The alert names the route (directly or by a trip), or is agency-wide (no route, trip, or stop)."""
    if route_id in _routes(selectors):
        return True
    return any(not ({"route_id", "trip", "stop_id"} & set(s)) for s in selectors)


def _plain(translations: list[dict[str, str | None]]) -> str | None:
    """The English text (``en`` or ``en-*``), else the untagged one, else the first; None if there's none."""
    if not translations:
        return None
    for translation in translations:
        language = (translation.get("language") or "").lower()
        if language == "en" or language.startswith("en-"):
            return translation.get("text")
    untagged = [t for t in translations if not t.get("language")]
    return (untagged or translations)[0].get("text")
