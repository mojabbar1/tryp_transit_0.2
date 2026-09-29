"""Direct-route trips between two stops (P4a task 2; D-6, REV-06, 02 §8.3). Only trips a rider can board.

Inputs: an origin and a destination stop, a local date, and a target (``arrive_by`` or ``depart_at``, local
``HH:MM``), plus the access buffer (05 assumption ``transit.access_buffer_min``) and the current time.

- **Candidates:** trips that serve the origin before the destination (by ``stop_sequence``) on a service that
  runs on the date, plus the previous service day's trips that depart on the date (times of 24:00:00 or
  later). A trip that passes the origin more than once is boarded at its last pass before the destination
  (the shortest ride).
- **Boardable:** the origin departure is at least ``now + access buffer`` (never a bus that has already left),
  pickup is allowed at the origin, and drop-off at the destination. ``pickup_type``/``drop_off_type`` 1 (none)
  and 2 (phone the agency first) don't allow it; 0, empty, and 3 (tell the driver) do.
- **Choice:** for ``arrive_by``, the latest arrival at or before the target (ties: the later departure); for
  ``depart_at``, the earliest departure at or after the target, where the target is the time at the origin
  stop (ties: the earlier arrival). The next three boardable trips in the same order are the alternatives. A
  trip is offered once per service day.
- **Times:** departure at the origin (its arrival time if the departure is blank) and arrival at the
  destination (or its departure time). A blank non-timepoint time is interpolated between the trip's timed
  neighbors, by ``shape_dist_traveled`` when all three stops have it and by stop order otherwise (GTFS allows
  blank non-timepoint times and expects consumers to interpolate); such a trip is marked ``interpolated``.
- **No fabrication:** without a boardable direct trip, the result is a reason instead: ``unknown_stop`` (not a
  boardable stop of the active feed), ``transfer_required`` (no trip serves the origin and then the
  destination), ``no_service`` (none of those trips runs on the date), or ``no_boardable_trip``. This release
  is direct-route only (D-6 (a)).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from sqlalchemy import Connection, text

from tda.metrics.feeds import ActiveFeed, active_service_ids, boardable_stop_ids, service_time

Mode = Literal["arrive_by", "depart_at"]
Reason = Literal["no_boardable_trip", "transfer_required", "no_service", "unknown_stop"]
BOARDING_ALLOWED = frozenset({None, 0, 3})
ALTERNATIVES = 3


@dataclass(frozen=True)
class TripOption:
    """One boardable direct trip. Times are aware datetimes in the agency's time zone."""

    trip_id: str
    route_id: str
    route_short_name: str | None
    route_long_name: str | None
    headsign: str | None
    direction_id: int | None
    service_date: date
    departure: datetime
    arrival: datetime
    interpolated: bool

    @property
    def in_vehicle_min(self) -> float:
        # Elapsed time: datetimes in one zone subtract by wall clock, which is wrong across a DST change.
        return (self.arrival.timestamp() - self.departure.timestamp()) / 60


@dataclass(frozen=True)
class Comparison:
    """The chosen trip and its alternatives, or a reason and no trips."""

    mode: Mode
    target: datetime
    best: TripOption | None
    alternatives: list[TripOption] = field(default_factory=list)
    reason: Reason | None = None


@dataclass
class _Visit:
    sequence: int
    arrival_s: int | None
    departure_s: int | None
    pickup_type: int | None
    drop_off_type: int | None


@dataclass
class _Trip:
    route_id: str
    route_short_name: str | None
    route_long_name: str | None
    headsign: str | None
    direction_id: int | None
    service_id: str
    origins: dict[int, _Visit] = field(default_factory=dict)
    destinations: dict[int, _Visit] = field(default_factory=dict)


def compare(
    connection: Connection,
    feed: ActiveFeed,
    *,
    origin: str,
    dest: str,
    day: date,
    mode: Mode,
    at: time,
    access_buffer: timedelta,
    now: datetime,
) -> Comparison:
    """The best boardable direct trip for the request, with up to 3 alternatives, or a reason."""
    if origin == dest:
        raise ValueError("the origin and destination are the same stop")
    target = datetime.combine(day, at, tzinfo=feed.zone)
    if boardable_stop_ids(connection, feed, [origin, dest]) != {origin, dest}:
        return Comparison(mode, target, None, reason="unknown_stop")
    trips = _direct_trips(connection, feed, origin, dest)
    if not trips:
        return Comparison(mode, target, None, reason="transfer_required")
    services = {
        d: active_service_ids(connection, feed.feed_version_id, d) for d in (day - timedelta(days=1), day)
    }
    times = _times(connection, feed, trips)
    options: list[tuple[TripOption, bool]] = []
    for trip_id, trip in trips.items():
        for service_day, running in services.items():
            if trip.service_id not in running:
                continue
            for option, allowed in _options(feed, trip_id, trip, service_day, times):
                if service_day == day or option.departure.date() == day:
                    options.append((option, allowed))
    if not options:
        return Comparison(mode, target, None, reason="no_service")
    # Compare instants, never wall-clock times: datetimes in one zone compare by wall clock (fold is
    # ignored), which is wrong in the hour a DST change repeats. So the buffer is added in UTC too.
    earliest = (now.astimezone(UTC) + access_buffer).timestamp()
    deadline = target.timestamp()
    boardable = [
        option for option, allowed in options if allowed and option.departure.timestamp() >= earliest
    ]
    if mode == "arrive_by":
        chosen = sorted(
            (o for o in boardable if o.arrival.timestamp() <= deadline),
            key=lambda o: (-o.arrival.timestamp(), -o.departure.timestamp(), o.trip_id),
        )
    else:
        chosen = sorted(
            (o for o in boardable if o.departure.timestamp() >= deadline),
            key=lambda o: (o.departure.timestamp(), o.arrival.timestamp(), o.trip_id),
        )
    unique: list[TripOption] = []
    seen: set[tuple[str, date]] = set()
    for option in chosen:
        if (option.trip_id, option.service_date) not in seen:
            seen.add((option.trip_id, option.service_date))
            unique.append(option)
    if not unique:
        return Comparison(mode, target, None, reason="no_boardable_trip")
    return Comparison(mode, target, unique[0], unique[1 : 1 + ALTERNATIVES])


def _direct_trips(connection: Connection, feed: ActiveFeed, origin: str, dest: str) -> dict[str, _Trip]:
    """Every trip with a visit to ``origin`` before a visit to ``dest``, with those visits."""
    rows = connection.execute(
        text(
            "SELECT o.trip_id, t.route_id, r.route_short_name, r.route_long_name, t.trip_headsign, "
            "t.direction_id, t.service_id, "
            "o.stop_sequence AS o_seq, o.arrival_s AS o_arr, o.departure_s AS o_dep, "
            "o.pickup_type, o.drop_off_type AS o_drop, "
            "d.stop_sequence AS d_seq, d.arrival_s AS d_arr, d.departure_s AS d_dep, "
            "d.pickup_type AS d_pick, d.drop_off_type "
            "FROM tda.active_gtfs_stop_time o "
            "JOIN tda.active_gtfs_stop_time d ON d.feed_version_id = o.feed_version_id "
            "AND d.trip_id = o.trip_id AND d.stop_sequence > o.stop_sequence "
            "JOIN tda.active_gtfs_trip t ON t.feed_version_id = o.feed_version_id AND t.trip_id = o.trip_id "
            "LEFT JOIN tda.active_gtfs_route r "
            "ON r.feed_version_id = t.feed_version_id AND r.route_id = t.route_id "
            "WHERE o.feed_version_id = :v AND o.stop_id = :origin AND d.stop_id = :dest"
        ),
        {"v": feed.feed_version_id, "origin": origin, "dest": dest},
    )
    trips: dict[str, _Trip] = {}
    for row in rows:
        trip = trips.setdefault(
            row.trip_id,
            _Trip(
                row.route_id,
                row.route_short_name,
                row.route_long_name,
                row.trip_headsign,
                row.direction_id,
                row.service_id,
            ),
        )
        trip.origins[row.o_seq] = _Visit(row.o_seq, row.o_arr, row.o_dep, row.pickup_type, row.o_drop)
        trip.destinations[row.d_seq] = _Visit(row.d_seq, row.d_arr, row.d_dep, row.d_pick, row.drop_off_type)
    return trips


def _times(
    connection: Connection, feed: ActiveFeed, trips: dict[str, _Trip]
) -> dict[tuple[str, int], tuple[int, bool]]:
    """(trip_id, stop_sequence) -> (seconds, interpolated) for the visits whose own times are blank."""
    blank = sorted(
        trip_id
        for trip_id, trip in trips.items()
        if any(
            v.arrival_s is None and v.departure_s is None
            for v in (*trip.origins.values(), *trip.destinations.values())
        )
    )
    if not blank:
        return {}
    stops: dict[str, list[tuple[int, int | None, int | None, float | None]]] = defaultdict(list)
    for row in connection.execute(
        text(
            "SELECT trip_id, stop_sequence, arrival_s, departure_s, shape_dist_traveled "
            "FROM tda.active_gtfs_stop_time WHERE feed_version_id = :v AND trip_id = ANY(:trips) "
            "ORDER BY trip_id, stop_sequence"
        ),
        {"v": feed.feed_version_id, "trips": blank},
    ):
        stops[row.trip_id].append(
            (row.stop_sequence, row.arrival_s, row.departure_s, row.shape_dist_traveled)
        )
    filled: dict[tuple[str, int], tuple[int, bool]] = {}
    for trip_id, visits in stops.items():
        timed = [i for i, (_, arr, dep, _) in enumerate(visits) if arr is not None or dep is not None]
        for i, (sequence, arr, dep, dist) in enumerate(visits):
            if arr is not None or dep is not None:
                continue
            before = max((j for j in timed if j < i), default=None)
            after = min((j for j in timed if j > i), default=None)
            if before is None or after is None:
                continue  # the loader requires times at a trip's first and last stop, so this can't happen
            start = visits[before][2] if visits[before][2] is not None else visits[before][1]
            end = visits[after][1] if visits[after][1] is not None else visits[after][2]
            d0, d1 = visits[before][3], visits[after][3]
            if dist is not None and d0 is not None and d1 is not None and d1 > d0:
                share = (dist - d0) / (d1 - d0)
            else:
                share = (i - before) / (after - before)
            filled[(trip_id, sequence)] = (round(start + share * (end - start)), True)
    return filled


def _options(
    feed: ActiveFeed,
    trip_id: str,
    trip: _Trip,
    service_day: date,
    filled: dict[tuple[str, int], tuple[int, bool]],
) -> list[tuple[TripOption, bool]]:
    """One option per destination visit (boarding at the last origin visit before it), and if it's allowed."""
    result = []
    for d_seq, arrive in sorted(trip.destinations.items()):
        before = [seq for seq in trip.origins if seq < d_seq]
        if not before:
            continue
        board = trip.origins[max(before)]
        departure, dep_interpolated = _time(trip_id, board, filled, prefer="departure")
        arrival, arr_interpolated = _time(trip_id, arrive, filled, prefer="arrival")
        if departure is None or arrival is None:
            continue
        option = TripOption(
            trip_id=trip_id,
            route_id=trip.route_id,
            route_short_name=trip.route_short_name,
            route_long_name=trip.route_long_name,
            headsign=trip.headsign,
            direction_id=trip.direction_id,
            service_date=service_day,
            departure=service_time(service_day, departure, feed.zone),
            arrival=service_time(service_day, arrival, feed.zone),
            interpolated=dep_interpolated or arr_interpolated,
        )
        allowed = board.pickup_type in BOARDING_ALLOWED and arrive.drop_off_type in BOARDING_ALLOWED
        result.append((option, allowed))
    return result


def _time(
    trip_id: str,
    visit: _Visit,
    filled: dict[tuple[str, int], tuple[int, bool]],
    *,
    prefer: Literal["arrival", "departure"],
) -> tuple[int | None, bool]:
    first, second = (
        (visit.departure_s, visit.arrival_s)
        if prefer == "departure"
        else (visit.arrival_s, visit.departure_s)
    )
    if first is not None:
        return first, False
    if second is not None:
        return second, False
    seconds, interpolated = filled.get((trip_id, visit.sequence), (None, False))
    return seconds, interpolated
