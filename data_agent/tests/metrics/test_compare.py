"""P4a task 2: direct-route trips with boardability rules (REV-06), on the synthetic fixture feed.

Fixture (weekday service WKDY; Saturday SAT; Labor Day 2026-09-07 swaps WKDY for SAT):
- R1 direction 0, FX01 -> FX06, 4 minutes between stops: T1 07:00 (WKDY), T3 09:00 (SAT); extras below.
- R1 direction 1, FX06 -> FX01: T2 17:00 (WKDY), with a blank time at FX04 (shape distance 1.6 of 0.8..2.4).
- R2, FX01 -> FX07 -> FX08 -> FX09 -> FX10: T4 23:50 (WKDY), reaching FX09 at 24:02 and FX10 at 24:06.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Engine

from tda.metrics.compare import Comparison, Mode, compare
from tda.metrics.feeds import ActiveFeed
from tests.support.feeds import LoadFeed, edited, r1_trip

NY = ZoneInfo("America/New_York")
WEDNESDAY = date(2026, 9, 9)
DAY_BEFORE = datetime(2026, 9, 8, 12, 0, tzinfo=NY)  # "now" for requests where nothing has left yet
EXTRAS = edited(
    trips=[r1_trip("A1", "07:15"), r1_trip("A2", "07:30"), r1_trip("A3", "08:00"), r1_trip("A4", "08:30")]
)

Ask = Callable[..., Comparison]


@pytest.fixture
def ask(load_feed: LoadFeed, writer_engine: Engine) -> Callable[..., Ask]:
    """``ask(contents)(origin, dest, day, mode, "HH:MM", now=..., buffer=5)`` on a freshly loaded feed."""

    def with_feed(contents: dict[str, str | None] | None = None) -> Ask:
        feed = load_feed(contents)

        def run(
            origin: str,
            dest: str,
            day: date,
            mode: Mode,
            at: str,
            now: datetime = DAY_BEFORE,
            buffer: int = 5,
        ) -> Comparison:
            return _compare(writer_engine, feed, origin, dest, day, mode, at, now, buffer)

        return run

    return with_feed


def _compare(
    engine: Engine,
    feed: ActiveFeed,
    origin: str,
    dest: str,
    day: date,
    mode: Mode,
    at: str,
    now: datetime,
    buffer: int,
) -> Comparison:
    hours, minutes = (int(part) for part in at.split(":"))
    with engine.connect() as connection:
        return compare(
            connection,
            feed,
            origin=origin,
            dest=dest,
            day=day,
            mode=mode,
            at=time(hours, minutes),
            access_buffer=timedelta(minutes=buffer),
            now=now,
        )


def _at(day: date, hh_mm: str) -> datetime:
    hours, minutes = (int(part) for part in hh_mm.split(":"))
    return datetime(day.year, day.month, day.day, tzinfo=NY) + timedelta(hours=hours, minutes=minutes)


def test_a_direct_trip_has_exact_scheduled_minutes(ask: Callable[..., Ask]) -> None:
    result = ask()("FX01", "FX06", WEDNESDAY, "depart_at", "06:50")
    assert result.reason is None and result.best is not None
    best = result.best
    assert (best.trip_id, best.route_id, best.route_short_name, best.headsign) == (
        "T1",
        "R1",
        "1",
        "Fixture Stop 06",
    )
    assert (best.departure, best.arrival) == (_at(WEDNESDAY, "07:00"), _at(WEDNESDAY, "07:20"))
    assert (best.in_vehicle_min, best.service_date, best.interpolated) == (20.0, WEDNESDAY, False)
    assert result.alternatives == []


def test_depart_at_picks_the_earliest_departure_and_three_alternatives(ask: Callable[..., Ask]) -> None:
    result = ask(EXTRAS)("FX02", "FX05", WEDNESDAY, "depart_at", "07:10")
    assert result.best is not None
    # FX02 is 4 minutes after FX01: departures 07:04, 07:19, 07:34, 08:04, 08:34.
    assert result.best.trip_id == "A1" and result.best.departure == _at(WEDNESDAY, "07:19")
    assert [o.trip_id for o in result.alternatives] == ["A2", "A3", "A4"]
    assert all(o.in_vehicle_min == 12.0 for o in (result.best, *result.alternatives))


def test_arrive_by_picks_the_latest_arrival_at_or_before_the_target(ask: Callable[..., Ask]) -> None:
    result = ask(EXTRAS)("FX01", "FX06", WEDNESDAY, "arrive_by", "08:00")
    assert result.best is not None
    # Arrivals 07:20 (T1), 07:35 (A1), 07:50 (A2), 08:20 (A3): the latest by 08:00 is A2's.
    assert (result.best.trip_id, result.best.arrival) == ("A2", _at(WEDNESDAY, "07:50"))
    assert [o.trip_id for o in result.alternatives] == ["A1", "T1"]


def test_a_bus_that_already_left_is_never_offered(ask: Callable[..., Ask]) -> None:
    run = ask(EXTRAS)
    # At 07:12 with a 5-minute buffer, the earliest usable departure is 07:17: T1 (07:00) and A1 (07:15)
    # have gone.
    now = _at(WEDNESDAY, "07:12")
    late = run("FX01", "FX06", WEDNESDAY, "arrive_by", "07:40", now=now)
    assert (late.best, late.reason) == (None, "no_boardable_trip")
    later = run("FX01", "FX06", WEDNESDAY, "arrive_by", "08:00", now=now)
    assert later.best is not None and later.best.trip_id == "A2"
    assert [o.trip_id for o in later.alternatives] == [], (
        "T1 and A1 have left, so they aren't alternatives either"
    )
    # At 07:11 the earliest usable departure is 07:16, so A1 (07:15) is gone; at 07:10 it is exactly 07:15.
    just = run("FX01", "FX06", WEDNESDAY, "depart_at", "07:00", now=_at(WEDNESDAY, "07:11"))
    assert just.best is not None and just.best.trip_id == "A2"
    caught = run("FX01", "FX06", WEDNESDAY, "depart_at", "07:00", now=_at(WEDNESDAY, "07:10"))
    assert caught.best is not None and caught.best.trip_id == "A1"


def test_a_calendar_dates_removal_uses_the_holiday_service(ask: Callable[..., Ask]) -> None:
    labor_day = date(2026, 9, 7)
    result = ask()("FX01", "FX06", labor_day, "depart_at", "06:50", now=datetime(2026, 9, 6, 12, tzinfo=NY))
    assert result.best is not None
    assert (result.best.trip_id, result.best.departure) == ("T3", _at(labor_day, "09:00")), (
        "SAT runs, WKDY doesn't"
    )


def test_previous_service_day_trips_past_midnight_are_boardable(ask: Callable[..., Ask]) -> None:
    run = ask()
    thursday = date(2026, 9, 10)
    # T4 (Wednesday's service) leaves FX09 at 24:02, which is 00:02 on Thursday.
    after = run("FX09", "FX10", thursday, "depart_at", "00:00", now=DAY_BEFORE)
    assert after.best is not None
    assert (after.best.trip_id, after.best.service_date) == ("T4", WEDNESDAY)
    assert (after.best.departure, after.best.arrival) == (_at(thursday, "00:02"), _at(thursday, "00:06"))
    by = run("FX09", "FX10", thursday, "arrive_by", "00:10", now=DAY_BEFORE)
    assert by.best is not None and by.best.service_date == WEDNESDAY
    # Saturday has no R2 service, but Friday's T4 still leaves FX09 at 00:02 on Saturday.
    saturday = run("FX09", "FX10", date(2026, 9, 12), "depart_at", "00:00", now=DAY_BEFORE)
    assert saturday.best is not None and saturday.best.service_date == date(2026, 9, 11)


def test_the_same_days_late_trip_counts_for_depart_at(ask: Callable[..., Ask]) -> None:
    result = ask()("FX08", "FX10", WEDNESDAY, "depart_at", "23:55")
    assert result.best is not None and result.best.trip_id == "T4"
    assert (result.best.departure, result.best.arrival) == (
        _at(WEDNESDAY, "23:58"),
        _at(date(2026, 9, 10), "00:06"),
    )


def test_a_blank_time_is_interpolated_by_shape_distance(ask: Callable[..., Ask]) -> None:
    # T2 is FX05 17:04 (0.8) -> FX04 blank (1.6) -> FX03 17:12 (2.4): halfway, 17:08.
    result = ask()("FX04", "FX01", WEDNESDAY, "depart_at", "17:00")
    assert result.best is not None and result.best.interpolated
    assert (result.best.departure, result.best.in_vehicle_min) == (_at(WEDNESDAY, "17:08"), 12.0)
    # At distance 1.2 the stop is a quarter of the way: 17:06.
    skewed = edited(replace=[("stop_times.txt", "T2,,,FX04,3,0,0,1.6,0", "T2,,,FX04,3,0,0,1.2,0")])
    quarter = ask(skewed)("FX04", "FX01", WEDNESDAY, "depart_at", "17:00")
    assert quarter.best is not None and quarter.best.departure == _at(WEDNESDAY, "17:06")


def test_without_distances_a_blank_time_is_interpolated_by_stop_order(ask: Callable[..., Ask]) -> None:
    no_distance = edited(replace=[("stop_times.txt", "T2,,,FX04,3,0,0,1.6,0", "T2,,,FX04,3,0,0,,0")])
    result = ask(no_distance)("FX04", "FX01", WEDNESDAY, "depart_at", "17:00")
    assert result.best is not None and result.best.departure == _at(WEDNESDAY, "17:08")


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ("T1,07:00:00,07:00:00,FX01,1,0,0", "T1,07:00:00,07:00:00,FX01,1,1,0"),  # no pickup at the origin
        ("T1,07:00:00,07:00:00,FX01,1,0,0", "T1,07:00:00,07:00:00,FX01,1,2,0"),  # must phone the agency
        (
            "T1,07:20:00,07:20:00,FX06,6,0,0",
            "T1,07:20:00,07:20:00,FX06,6,0,1",
        ),  # no drop-off at the destination
    ],
)
def test_pickup_and_drop_off_rules_are_respected(ask: Callable[..., Ask], old: str, new: str) -> None:
    result = ask(edited(replace=[("stop_times.txt", old, new)]))(
        "FX01", "FX06", WEDNESDAY, "depart_at", "06:50"
    )
    assert (result.best, result.reason) == (None, "no_boardable_trip")


def test_tell_the_driver_still_allows_boarding(ask: Callable[..., Ask]) -> None:
    contents = edited(
        replace=[("stop_times.txt", "T1,07:00:00,07:00:00,FX01,1,0,0", "T1,07:00:00,07:00:00,FX01,1,3,0")]
    )
    result = ask(contents)("FX01", "FX06", WEDNESDAY, "depart_at", "06:50")
    assert result.best is not None and result.best.trip_id == "T1"


def test_a_loop_boards_at_the_last_pass_before_the_destination(ask: Callable[..., Ask]) -> None:
    loop = (
        "R1,WKDY,L1,Loop,0,B7,",
        [
            "L1,08:10:00,08:10:00,FX01,1,0,0,,1",
            "L1,08:14:00,08:14:00,FX02,2,0,0,,0",
            "L1,08:18:00,08:18:00,FX01,3,0,0,,0",
            "L1,08:22:00,08:22:00,FX03,4,0,0,,1",
        ],
    )
    result = ask(edited(trips=[loop]))("FX01", "FX03", WEDNESDAY, "depart_at", "08:00")
    assert result.best is not None and result.best.trip_id == "L1"
    assert (result.best.departure, result.best.in_vehicle_min) == (_at(WEDNESDAY, "08:18"), 4.0)


@pytest.mark.parametrize(
    ("origin", "dest", "day", "reason"),
    [
        ("FX02", "FX07", WEDNESDAY, "transfer_required"),  # R1 and R2 share only FX01
        ("FX06", "FX01", date(2026, 9, 9), None),  # T2 runs the other way on weekdays
        ("FX05", "FX01", WEDNESDAY, None),
        ("FX01", "FX06", date(2026, 9, 13), "no_service"),  # Sunday
        ("FX01", "FX06", date(2027, 1, 6), "no_service"),  # after the calendar ends
        ("FX99", "FX06", WEDNESDAY, "unknown_stop"),
        ("FX01", "NOPE", WEDNESDAY, "unknown_stop"),
    ],
)
def test_reasons_instead_of_invented_numbers(
    ask: Callable[..., Ask], origin: str, dest: str, day: date, reason: str | None
) -> None:
    result = ask()(origin, dest, day, "depart_at", "05:00", now=datetime(2026, 9, 1, tzinfo=NY))
    assert result.reason == reason
    assert (result.best is None) == (reason is not None)


def test_the_same_stop_twice_is_refused(ask: Callable[..., Ask]) -> None:
    with pytest.raises(ValueError, match="same stop"):
        ask()("FX01", "FX01", WEDNESDAY, "depart_at", "06:00")


def test_times_across_the_dst_fall_back_are_elapsed_not_wall_clock(ask: Callable[..., Ask]) -> None:
    # On 2026-11-01 "noon minus 12h" is 01:00 EDT: GTFS 00:50 is 01:50 EDT, and GTFS 01:05 is 01:05 EST (on
    # the wall clock's second pass through 01:00-02:00), so the ride takes 15 minutes, not -45.
    night = (
        "R1,SUN1101,DST1,Fixture Stop 06,0,B6,",
        ["DST1,00:50:00,00:50:00,FX01,1,0,0,,1", "DST1,01:05:00,01:05:00,FX06,2,0,0,,1"],
    )
    service = ("calendar_dates.txt", "SAT,20260907,1", "SAT,20260907,1\nSUN1101,20261101,1")
    fall_back = date(2026, 11, 1)
    run = ask(edited(trips=[night], replace=[service]))
    result = run("FX01", "FX06", fall_back, "depart_at", "00:30", now=datetime(2026, 10, 31, tzinfo=NY))
    assert result.best is not None and result.best.in_vehicle_min == 15.0
    assert result.best.departure.utcoffset() == timedelta(hours=-4) and result.best.arrival.fold == 1
    # "Arrive by 01:30" means the first 01:30 (EDT, 05:30 UTC). The 01:05 EST arrival (06:05 UTC) is later,
    # although its wall-clock time looks earlier, so no trip qualifies.
    late = run("FX01", "FX06", fall_back, "arrive_by", "01:30", now=datetime(2026, 10, 31, tzinfo=NY))
    assert (late.best, late.reason) == (None, "no_boardable_trip")
    on_time = run("FX01", "FX06", fall_back, "arrive_by", "02:00", now=datetime(2026, 10, 31, tzinfo=NY))
    assert on_time.best is not None and on_time.best.trip_id == "DST1"
