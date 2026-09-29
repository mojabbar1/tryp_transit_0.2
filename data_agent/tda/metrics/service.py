"""Headways by route, direction, and time band (P4a task 1), from each approved source's active GTFS feed.

- **Representative day:** for each day type (weekday, Saturday, Sunday), the first date on or after the
  reference date (within 4 weeks) that has service and no ``calendar_dates`` removal, so a holiday doesn't
  stand in for a normal day. A day type with no such date uses its first date with service; one with no
  service gets no value.
- **Headway:** trips on that date are grouped by route and direction and ordered by their first departure.
  Within each time band, the headway is the median gap between consecutive distinct departures that both fall
  in the band; a band needs at least 2 departures. Bands (by departure, in service-day hours): AM 06–09,
  Mid 09–15, PM 15–19, Eve 19–24, and Night (before 06, and 24:00 or later). Night's two stretches are
  separate, so there's no gap across the day.
- **Metrics:** ``route.headway_min.<band>.<daytype>`` with dims ``source_id``, ``route_id``, and
  ``direction_id`` (minutes, 1 decimal place). The lineage is the feed's load run. A value is recorded only
  when it or its lineage changes, and a route or band that no longer has a value gets NULL (withdrawn), as do
  all of a source's headways once it has no active approved feed (:func:`withdraw_inactive`).
"""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from functools import partial
from typing import Any

import structlog
from sqlalchemy import Connection, text

from tda.metrics.feeds import ActiveFeed, NoActiveFeed, active_feed, active_service_ids, has_removals
from tda.metrics.registry import MetricDefinition, MetricRegistry, MetricResult, record_changes, record_metric

log = structlog.get_logger(__name__)

METHOD = "headway.v1"
UNIT = "minutes"
DAYTYPES = ("weekday", "saturday", "sunday")
HOUR = 3600
# (band, start, end) in seconds after the start of the service day; "night" appears twice on purpose.
WINDOWS = (
    ("night", 0, 6 * HOUR),
    ("am", 6 * HOUR, 9 * HOUR),
    ("mid", 9 * HOUR, 15 * HOUR),
    ("pm", 15 * HOUR, 19 * HOUR),
    ("eve", 19 * HOUR, 24 * HOUR),
    ("night", 24 * HOUR, None),
)
BANDS = ("am", "mid", "pm", "eve", "night")
PREFIX = "route.headway_min."
HORIZON_DAYS = 28


def daytype(day: date) -> str:
    """``weekday``, ``saturday``, or ``sunday``."""
    return {5: "saturday", 6: "sunday"}.get(day.weekday(), "weekday")


def metric_key(band: str, kind: str) -> str:
    return f"{PREFIX}{band}.{kind}"


def representative_date(connection: Connection, feed: ActiveFeed, kind: str, start: date) -> date | None:
    """The date that stands for day type ``kind`` (see the module docstring), or None without service."""
    fallback = None
    for offset in range(HORIZON_DAYS):
        day = start + timedelta(days=offset)
        if daytype(day) != kind or not active_service_ids(connection, feed.feed_version_id, day):
            continue
        if not has_removals(connection, feed.feed_version_id, day):
            return day
        fallback = fallback or day
    return fallback


@dataclass(frozen=True)
class Headway:
    """One route and direction's headway in one band on one date."""

    route_id: str
    direction_id: int | None
    band: str
    minutes: Decimal
    departures: int


def first_departures(
    connection: Connection, feed: ActiveFeed, day: date
) -> dict[tuple[str, int | None], list[int]]:
    """Each running trip's first departure (seconds), grouped by (route_id, direction_id), sorted."""
    services = sorted(active_service_ids(connection, feed.feed_version_id, day))
    groups: dict[tuple[str, int | None], list[int]] = defaultdict(list)
    if not services:
        return groups
    rows = connection.execute(
        text(
            "SELECT DISTINCT ON (st.trip_id) t.route_id, t.direction_id, "
            "coalesce(st.departure_s, st.arrival_s) AS start_s "
            "FROM tda.active_gtfs_stop_time st "
            "JOIN tda.active_gtfs_trip t "
            "ON t.feed_version_id = st.feed_version_id AND t.trip_id = st.trip_id "
            "WHERE st.feed_version_id = :v AND t.service_id = ANY(:services) "
            "ORDER BY st.trip_id, st.stop_sequence"
        ),
        {"v": feed.feed_version_id, "services": services},
    )
    for route_id, direction_id, start_s in rows:
        # The loader requires an arrival time at every trip's first stop, so start_s is never NULL.
        groups[(route_id, direction_id)].append(start_s)
    for starts in groups.values():
        starts.sort()
    return groups


def headways(connection: Connection, feed: ActiveFeed, day: date) -> list[Headway]:
    """Every route, direction, and band with at least 2 departures on ``day``."""
    result = []
    for (route_id, direction_id), starts in sorted(
        first_departures(connection, feed, day).items(),
        key=lambda item: (item[0][0], -1 if item[0][1] is None else item[0][1]),
    ):
        gaps: dict[str, list[int]] = defaultdict(list)
        counts: dict[str, int] = defaultdict(int)
        for band, low, high in WINDOWS:
            inside = sorted({s for s in starts if s >= low and (high is None or s < high)})
            counts[band] += len(inside)
            gaps[band].extend(later - earlier for earlier, later in zip(inside, inside[1:], strict=False))
        for band in BANDS:
            if gaps[band]:
                minutes = Decimal(str(statistics.median(gaps[band]))) / 60
                result.append(
                    Headway(
                        route_id,
                        direction_id,
                        band,
                        minutes.quantize(Decimal("0.1"), rounding=ROUND_HALF_EVEN),
                        counts[band],
                    )
                )
    return result


def _dims(feed: ActiveFeed, route_id: str, direction_id: int | None) -> dict[str, Any]:
    return {"source_id": feed.source_id, "route_id": route_id, "direction_id": direction_id}


def compute_values(
    connection: Connection, feed: ActiveFeed, reference: date
) -> tuple[dict[tuple[str, str], MetricResult], dict[str, date]]:
    """Every headway metric for the feed, keyed by (metric key, canonical dims), plus the dates used."""
    values: dict[tuple[str, str], MetricResult] = {}
    used: dict[str, date] = {}
    for kind in DAYTYPES:
        day = representative_date(connection, feed, kind, reference)
        if day is None:
            log.info(
                "metrics.headway_no_service", source=feed.source_id, daytype=kind, reference=str(reference)
            )
            continue
        used[kind] = day
        for headway in headways(connection, feed, day):
            dims = _dims(feed, headway.route_id, headway.direction_id)
            values[(metric_key(headway.band, kind), canonical(dims))] = MetricResult(
                headway.minutes, [feed.fetch_run_id], UNIT
            )
    return values, used


def record_headways(connection: Connection, feed: ActiveFeed, reference: date) -> int:
    """Record changed headways for ``feed`` and withdraw ones it no longer has; returns rows written.

    Skipped (0) when ``feed`` is no longer its source's active feed: the views would show none of its trips,
    and every headway would be withdrawn by mistake.
    """
    try:
        still_active = active_feed(connection, feed.source_id).feed_version_id == feed.feed_version_id
    except NoActiveFeed:
        still_active = False
    if not still_active:
        log.info("metrics.headways_skipped", source=feed.source_id, feed_version_id=feed.feed_version_id)
        return 0
    values, used = compute_values(connection, feed, reference)
    current = {
        (row.metric_key, canonical(row.dims)): row
        for row in connection.execute(
            text(
                "SELECT metric_key, dims, value, unit, input_run_ids FROM tda.current_metric_value "
                "WHERE metric_key LIKE :prefix AND dims ->> 'source_id' = :s"
            ),
            {"prefix": PREFIX + "%", "s": feed.source_id},
        )
    }
    desired = dict(values)
    for missing in current.keys() - values.keys():
        # Withdrawn (or still withdrawn): cite this feed's run, even if the value was already NULL.
        desired[missing] = MetricResult(None, [feed.fetch_run_id], UNIT)
    written = record_changes(connection, desired, current, METHOD)
    log.info(
        "metrics.headways",
        source=feed.source_id,
        feed_version_id=feed.feed_version_id,
        dates={kind: str(day) for kind, day in used.items()},
        written=written,
    )
    return written


def withdraw_inactive(connection: Connection, active_source_ids: set[str]) -> int:
    """Withdraw (NULL) the headways of sources with no active approved feed (disabled, or feed gone)."""
    stale = connection.execute(
        text(
            "SELECT metric_key, dims, unit FROM tda.current_metric_value "
            "WHERE metric_key LIKE :prefix AND value IS NOT NULL "
            "AND NOT (dims ->> 'source_id' = ANY(:active)) "
            "ORDER BY metric_key, dims::text"
        ),
        {"prefix": PREFIX + "%", "active": sorted(active_source_ids)},
    ).all()
    for row in stale:
        record_metric(connection, row.metric_key, row.dims, MetricResult(None, [], row.unit), METHOD)
    if stale:
        log.info(
            "metrics.headways_withdrawn",
            sources=sorted({r.dims["source_id"] for r in stale}),
            rows=len(stale),
        )
    return len(stale)


def reference_date(feed: ActiveFeed) -> date:
    """Where a recompute starts looking for representative dates: today in the feed's time zone."""
    return feed.today()


def _recompute(band: str, kind: str, connection: Connection, dims: Mapping[str, Any]) -> MetricResult:
    """Rollback's recompute of one headway from the feed that is active now (None when there's none)."""
    try:
        feed = active_feed(connection, str(dims["source_id"]))
    except NoActiveFeed:
        return MetricResult(None, [], UNIT)
    day = representative_date(connection, feed, kind, reference_date(feed))
    if day is not None:
        for headway in headways(connection, feed, day):
            if (headway.band, headway.route_id, headway.direction_id) == (
                band,
                dims["route_id"],
                dims["direction_id"],
            ):
                return MetricResult(headway.minutes, [feed.fetch_run_id], UNIT)
    return MetricResult(None, [feed.fetch_run_id], UNIT)


def register(registry: MetricRegistry) -> None:
    """Add the headway definitions (used by rollback to recompute a headway)."""
    for band in BANDS:
        for kind in DAYTYPES:
            registry.register(
                MetricDefinition(metric_key(band, kind), METHOD, partial(_recompute, band, kind))
            )


def canonical(dims: Mapping[str, Any]) -> str:
    """Dims as sorted JSON, the way ``record_metric`` stores them."""
    return json.dumps(dict(dims), sort_keys=True)
