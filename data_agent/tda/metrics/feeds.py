"""The active GTFS feed of each approved source (the ``active_gtfs_*`` views): lookup, service days, stops.

Shared by the metrics, the read API, and ``tda gtfs export-stops``. Everything here only reads.

- **Service days (GTFS reference):** a service runs on a local date when ``calendar.txt`` covers the date
  and its weekday, unless ``calendar_dates.txt`` removes it (``exception_type`` 2); ``calendar_dates.txt``
  can also add it (``exception_type`` 1).
- **Times:** a GTFS time is measured from "noon minus 12h" of its service day in the agency's time zone, and
  can be 24:00:00 or later. :func:`service_time` turns one into an aware datetime (correct on DST days too).
- **Stops:** only boardable stops (``location_type`` 0 or empty) are listed; stations and entrances aren't.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, text

EARTH_RADIUS_M = 6_371_008.8


class FeedError(LookupError):
    """No GTFS feed can answer: none is active, or the request is ambiguous."""


class NoActiveFeed(FeedError):
    """No approved GTFS source has an active feed version (or not the requested one)."""


class AmbiguousFeed(FeedError):
    """Several approved GTFS sources have an active feed; the caller must name one."""


@dataclass(frozen=True)
class ActiveFeed:
    """One approved source's active feed version. ``fetch_run_id`` is its load run (the lineage)."""

    source_id: str
    feed_version_id: int
    fetch_run_id: int
    feed_label: str | None
    feed_start: date
    feed_end: date
    timezone: str
    loaded_at: datetime

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def today(self, now: datetime | None = None) -> date:
        """The agency's local date at ``now`` (default: the current time)."""
        return (now or datetime.now(UTC)).astimezone(self.zone).date()


def active_feeds(connection: Connection) -> list[ActiveFeed]:
    """Every approved GTFS source's active feed, by source id."""
    rows = connection.execute(
        text(
            "SELECT source_id, feed_version_id, fetch_run_id, feed_label, feed_start, feed_end, "
            "agency_timezone AS timezone, loaded_at FROM tda.active_gtfs_feed ORDER BY source_id"
        )
    ).mappings()
    return [ActiveFeed(**row) for row in rows]


def active_feed(connection: Connection, source_id: str | None = None) -> ActiveFeed:
    """The active feed of ``source_id``, or of the only approved GTFS source when it's None."""
    feeds = active_feeds(connection)
    if source_id is not None:
        feeds = [feed for feed in feeds if feed.source_id == source_id]
    if not feeds:
        which = f"source {source_id}" if source_id else "any approved GTFS source"
        raise NoActiveFeed(f"no active GTFS feed for {which}")
    if len(feeds) > 1:
        names = ", ".join(feed.source_id for feed in feeds)
        raise AmbiguousFeed(f"several GTFS feeds are active ({names}); name one with source_id")
    return feeds[0]


def active_service_ids(connection: Connection, feed_version_id: int, day: date) -> frozenset[str]:
    """The services that run on the local date ``day`` (calendar, then calendar_dates exceptions)."""
    services = set(
        connection.execute(
            text(
                "SELECT service_id FROM tda.active_gtfs_calendar WHERE feed_version_id = :v "
                "AND start_date <= :d AND :d <= end_date "
                "AND (ARRAY[monday, tuesday, wednesday, thursday, friday, saturday, sunday])[:dow]"
            ),
            {"v": feed_version_id, "d": day, "dow": day.isoweekday()},
        ).scalars()
    )
    for service_id, exception_type in connection.execute(
        text(
            "SELECT service_id, exception_type FROM tda.active_gtfs_calendar_date "
            "WHERE feed_version_id = :v AND date = :d"
        ),
        {"v": feed_version_id, "d": day},
    ):
        if exception_type == 1:
            services.add(service_id)
        else:
            services.discard(service_id)
    return frozenset(services)


def has_removals(connection: Connection, feed_version_id: int, day: date) -> bool:
    """Whether ``calendar_dates.txt`` removes any service on ``day`` (a holiday, typically)."""
    return (
        connection.execute(
            text(
                "SELECT 1 FROM tda.active_gtfs_calendar_date "
                "WHERE feed_version_id = :v AND date = :d AND exception_type = 2 LIMIT 1"
            ),
            {"v": feed_version_id, "d": day},
        ).first()
        is not None
    )


def service_time(service_day: date, seconds: int, zone: ZoneInfo) -> datetime:
    """The instant of a GTFS time on ``service_day``: noon minus 12 hours, plus ``seconds``, as local time."""
    noon = datetime.combine(service_day, time(12), tzinfo=zone).astimezone(UTC)
    return (noon - timedelta(hours=12) + timedelta(seconds=seconds)).astimezone(zone)


@dataclass(frozen=True)
class Stop:
    """A boardable stop of the active feed. ``distance_m`` is set by :func:`nearest_stops` only."""

    stop_id: str
    code: str | None
    name: str | None
    lat: float
    lng: float
    route_short_names: tuple[str, ...] = ()
    distance_m: float | None = None


_STOP_COLUMNS = "stop_id, stop_code AS code, stop_name AS name, stop_lat AS lat, stop_lon AS lng"
_BOARDABLE = "coalesce(location_type, 0) = 0"


def search_stops(
    connection: Connection, feed: ActiveFeed, query: str | None, limit: int | None, *, routes: bool = True
) -> list[Stop]:
    """Stops whose name contains ``query`` (case-insensitive) or whose id or code equals it, best first.

    Without ``query``, every stop by name; ``limit`` None means no limit; ``routes=False`` skips route names.
    """
    params: dict[str, object] = {"v": feed.feed_version_id, "limit": limit}
    if query:
        params |= {"q": query, "like": "%" + _escape_like(query) + "%", "prefix": _escape_like(query) + "%"}
        where = "AND (stop_name ILIKE :like ESCAPE '\\' OR stop_id = :q OR stop_code = :q)"
        # coalesce(..., false): a NULL code or name ranks as "no match" (NULL sorts first in DESC).
        order = (
            "coalesce(stop_id = :q OR stop_code = :q, false) DESC, "
            "coalesce(stop_name ILIKE :prefix ESCAPE '\\', false) DESC, "
        )
    else:
        where, order = "", ""
    rows = connection.execute(
        text(
            f"SELECT {_STOP_COLUMNS} FROM tda.active_gtfs_stop "  # noqa: S608  (fixed fragments only)
            f"WHERE feed_version_id = :v AND {_BOARDABLE} {where} "
            f"ORDER BY {order}stop_name, stop_id LIMIT :limit"
        ),
        params,
    ).mappings()
    found = [Stop(**row) for row in rows]
    return _with_routes(connection, feed, found) if routes else found


def nearest_stops(connection: Connection, feed: ActiveFeed, lat: float, lng: float, limit: int) -> list[Stop]:
    """The ``limit`` stops nearest to (``lat``, ``lng``), by great-circle distance in meters."""
    rows = connection.execute(
        text(
            # least(1, ...): rounding can push the haversine term past 1 near the antipode, outside asin().
            f"SELECT {_STOP_COLUMNS}, {EARTH_RADIUS_M} * 2 * asin(least(1.0, sqrt("  # noqa: S608  (fixed fragments)
            "power(sin(radians(stop_lat - :lat) / 2), 2) + "
            "cos(radians(:lat)) * cos(radians(stop_lat)) * power(sin(radians(stop_lon - :lng) / 2), 2)"
            "))) AS distance_m "
            f"FROM tda.active_gtfs_stop WHERE feed_version_id = :v AND {_BOARDABLE} "
            "ORDER BY distance_m, stop_id LIMIT :limit"
        ),
        {"v": feed.feed_version_id, "lat": lat, "lng": lng, "limit": limit},
    ).mappings()
    return _with_routes(connection, feed, [Stop(**row) for row in rows])


def boardable_stop_ids(connection: Connection, feed: ActiveFeed, stop_ids: list[str]) -> set[str]:
    """Which of ``stop_ids`` are boardable stops of the active feed."""
    return set(
        connection.execute(
            text(
                "SELECT stop_id FROM tda.active_gtfs_stop "  # noqa: S608  (fixed fragments only)
                f"WHERE feed_version_id = :v AND stop_id = ANY(:ids) AND {_BOARDABLE}"
            ),
            {"v": feed.feed_version_id, "ids": stop_ids},
        ).scalars()
    )


def _with_routes(connection: Connection, feed: ActiveFeed, stops: list[Stop]) -> list[Stop]:
    """Fill in the names of the routes that serve each stop: the short name, else the long name, else the id.

    CARTA's real feed has a route with only a long name ("Beach Reach Shuttle"); its id means nothing to
    a rider.
    """
    if not stops:
        return stops
    names: dict[str, set[str]] = {}
    # Each view is read once into a materialized CTE, then hash-joined. Joining the views directly let the
    # planner nest loops over CARTA's real feed (148,842 stop times): 3 to 8 s for the whole list, past the
    # web app's 3 s deadline. This shape takes about 0.2 s for every stop, and milliseconds for a few.
    for stop_id, name in connection.execute(
        text(
            "WITH st AS MATERIALIZED (SELECT DISTINCT trip_id, stop_id FROM tda.active_gtfs_stop_time "
            "WHERE feed_version_id = :v AND stop_id = ANY(:ids)), "
            "trips AS MATERIALIZED (SELECT trip_id, route_id FROM tda.active_gtfs_trip "
            "WHERE feed_version_id = :v), "
            "routes AS MATERIALIZED (SELECT route_id, "
            "coalesce(route_short_name, route_long_name, route_id) AS name "
            "FROM tda.active_gtfs_route WHERE feed_version_id = :v) "
            "SELECT DISTINCT st.stop_id, routes.name FROM st "
            "JOIN trips ON trips.trip_id = st.trip_id JOIN routes ON routes.route_id = trips.route_id"
        ),
        {"v": feed.feed_version_id, "ids": [stop.stop_id for stop in stops]},
    ):
        names.setdefault(stop_id, set()).add(name)
    return [
        Stop(
            **{**stop.__dict__, "route_short_names": tuple(sorted(names.get(stop.stop_id, ()), key=natural))}
        )
        for stop in stops
    ]


def natural(value: str) -> tuple[tuple[int, int | str], ...]:
    """A sort key that orders "2" before "10" (route numbers), and text after numbers."""
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part.lower()) for part in re.findall(r"\d+|\D+", value)
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
