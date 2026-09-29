"""P4a task 1: service days, GTFS times, and headways by route, direction, and band (synthetic feed)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from tda.connectors.base import rollback_run
from tda.connectors.gtfs_static import GtfsStaticConnector
from tda.metrics import service
from tda.metrics.feeds import active_service_ids, service_time
from tda.metrics.registry import METRICS, MetricRegistry
from tda.store.bootstrap import downgrade, upgrade
from tests.conftest import DbUrls
from tests.support.db import rows
from tests.support.feeds import LoadFeed, edited, r1_trip, r2_trip

NY = ZoneInfo("America/New_York")
# Weekday R1 direction 0: 07:00 (the fixture's T1), 07:15, 07:30, 08:00 (AM) and 09:30, 10:30, 12:30 (Mid).
# Weekday R2: 05:30, 23:50 (T4), 24:20, 24:50. Saturday R1: 09:00 (T3) and 09:20.
BUSY = edited(
    trips=[
        r1_trip("A1", "07:15"),
        r1_trip("A2", "07:30"),
        r1_trip("A3", "08:00"),
        r1_trip("M1", "09:30"),
        r1_trip("M2", "10:30"),
        r1_trip("M3", "12:30"),
        r2_trip("N0", "05:30"),
        r2_trip("N1", "24:20"),
        r2_trip("N2", "24:50"),
        r1_trip("S1", "09:20", service="SAT"),
    ]
)


# GTFS times (no database)


@pytest.mark.parametrize(
    ("day", "seconds", "expected"),
    [
        (date(2026, 9, 9), 8 * 3600, datetime(2026, 9, 9, 8, 0, tzinfo=NY)),
        (date(2026, 9, 9), 24 * 3600 + 2 * 60, datetime(2026, 9, 10, 0, 2, tzinfo=NY)),
        # DST ends 2026-11-01: "noon minus 12h" is 01:00 EDT, so 08:00:00 is 08:00 EST (wall clock).
        (date(2026, 11, 1), 8 * 3600, datetime(2026, 11, 1, 8, 0, tzinfo=NY)),
        # DST starts 2026-03-08: "noon minus 12h" is 23:00 EST the day before; 08:00:00 is 08:00 EDT.
        (date(2026, 3, 8), 8 * 3600, datetime(2026, 3, 8, 8, 0, tzinfo=NY)),
    ],
)
def test_gtfs_times_count_from_noon_minus_12_hours(day: date, seconds: int, expected: datetime) -> None:
    got = service_time(day, seconds, NY)
    assert got == expected and got.utcoffset() == expected.utcoffset()


def test_day_types() -> None:
    assert [service.daytype(date(2026, 9, d)) for d in (11, 12, 13, 14)] == [
        "weekday",
        "saturday",
        "sunday",
        "weekday",
    ]


# Service days (Postgres)


def test_service_days_follow_calendar_and_calendar_dates(load_feed: LoadFeed, writer_engine: Engine) -> None:
    feed = load_feed()
    with writer_engine.connect() as connection:
        on = {d: active_service_ids(connection, feed.feed_version_id, d) for d in _dates()}
    assert on == {
        date(2026, 9, 9): {"WKDY"},  # Wednesday
        date(2026, 9, 12): {"SAT"},
        date(2026, 9, 13): set(),  # no Sunday service
        date(2026, 9, 7): {"SAT"},  # Labor Day: WKDY removed, SAT added (calendar_dates)
        date(2027, 1, 4): set(),  # after the calendar's end date
    }


def _dates() -> list[date]:
    return [date(2026, 9, 9), date(2026, 9, 12), date(2026, 9, 13), date(2026, 9, 7), date(2027, 1, 4)]


# Headways (Postgres)


def test_headways_are_median_gaps_within_each_band(load_feed: LoadFeed, writer_engine: Engine) -> None:
    feed = load_feed(BUSY)
    with writer_engine.connect() as connection:
        weekday = service.headways(connection, feed, date(2026, 9, 9))
        saturday = service.headways(connection, feed, date(2026, 9, 12))
        sunday = service.headways(connection, feed, date(2026, 9, 13))
    assert [(h.route_id, h.direction_id, h.band, h.minutes, h.departures) for h in weekday] == [
        ("R1", 0, "am", Decimal("15.0"), 4),  # gaps 15, 15, 30
        ("R1", 0, "mid", Decimal("90.0"), 3),  # gaps 60, 120
        # R2's night: 24:20 and 24:50 (30 min); 05:30 is alone in the early stretch, and no gap spans the day.
        ("R2", 0, "night", Decimal("30.0"), 3),
    ]
    assert [(h.route_id, h.band, h.minutes) for h in saturday] == [("R1", "mid", Decimal("20.0"))]
    assert sunday == []


def test_a_holiday_does_not_stand_in_for_a_normal_day(load_feed: LoadFeed, writer_engine: Engine) -> None:
    feed = load_feed(BUSY)
    with writer_engine.connect() as connection:
        # 2026-09-07 is Labor Day (Saturday service), so the weekday is Tuesday the 8th.
        picked = {
            kind: service.representative_date(connection, feed, kind, date(2026, 9, 7))
            for kind in service.DAYTYPES
        }
    assert picked == {"weekday": date(2026, 9, 8), "saturday": date(2026, 9, 12), "sunday": None}


def _current(engine: Engine) -> dict[tuple[str, str, int | None], tuple[Any, ...]]:
    return {
        (r.metric_key, r.dims["route_id"], r.dims["direction_id"]): (
            r.value,
            r.unit,
            r.input_run_ids,
            r.method_version,
        )
        for r in rows(
            engine,
            "SELECT metric_key, dims, value, unit, input_run_ids, method_version "
            "FROM tda.current_metric_value "
            "WHERE metric_key LIKE 'route.headway_min.%'",
        )
    }


def test_headways_are_recorded_once_with_lineage(load_feed: LoadFeed, writer_engine: Engine) -> None:
    feed = load_feed(BUSY)
    with writer_engine.begin() as connection:
        assert service.record_headways(connection, feed, date(2026, 9, 1)) == 4
    run = [feed.fetch_run_id]
    assert _current(writer_engine) == {
        ("route.headway_min.am.weekday", "R1", 0): (Decimal("15.0"), "minutes", run, "headway.v1"),
        ("route.headway_min.mid.weekday", "R1", 0): (Decimal("90.0"), "minutes", run, "headway.v1"),
        ("route.headway_min.night.weekday", "R2", 0): (Decimal("30.0"), "minutes", run, "headway.v1"),
        ("route.headway_min.mid.saturday", "R1", 0): (Decimal("20.0"), "minutes", run, "headway.v1"),
    }
    dims = rows(writer_engine, "SELECT DISTINCT dims ->> 'source_id' FROM tda.metric_value")
    assert dims == [("carta-gtfs",)]
    with writer_engine.begin() as connection:
        assert service.record_headways(connection, feed, date(2026, 9, 1)) == 0, (
            "unchanged values aren't rewritten"
        )


def test_a_new_feed_rewrites_changes_and_withdraws_what_it_lost(
    load_feed: LoadFeed, writer_engine: Engine
) -> None:
    first = load_feed(BUSY)
    with writer_engine.begin() as connection:
        service.record_headways(connection, first, date(2026, 9, 1))
    # The new feed drops the Saturday extra and the 08:00 weekday trip.
    second = load_feed(edited(trips=[r1_trip("A1", "07:15"), r1_trip("A2", "07:30"), r1_trip("M1", "09:30")]))
    assert second.feed_version_id != first.feed_version_id
    with writer_engine.begin() as connection:
        service.record_headways(connection, second, date(2026, 9, 1))
    new = [second.fetch_run_id]
    assert _current(writer_engine) == {
        ("route.headway_min.am.weekday", "R1", 0): (Decimal("15.0"), "minutes", new, "headway.v1"),
        ("route.headway_min.mid.weekday", "R1", 0): (None, "minutes", new, "headway.v1"),
        ("route.headway_min.night.weekday", "R2", 0): (None, "minutes", new, "headway.v1"),
        ("route.headway_min.mid.saturday", "R1", 0): (None, "minutes", new, "headway.v1"),
    }


def test_rolling_back_the_feed_recomputes_its_headways(
    load_feed: LoadFeed, writer_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry = MetricRegistry()
    service.register(registry)
    monkeypatch.setattr(service, "reference_date", lambda feed: date(2026, 9, 1))
    first = load_feed(BUSY, metrics=registry)
    second = load_feed(edited(trips=[r1_trip("A1", "07:15"), r1_trip("A2", "07:30")]), metrics=registry)
    with writer_engine.begin() as connection:
        service.record_headways(connection, second, date(2026, 9, 1))
    plan = rollback_run(
        writer_engine,
        second.fetch_run_id,
        owned_tables=GtfsStaticConnector.owned_tables,
        dry_run=False,
        metrics=registry,
        source_id="carta-gtfs",
    )
    assert {change.action for change in plan.metrics} == {"recompute"}
    # The first feed is active again, and its headway replaces the rolled-back feed's.
    assert _current(writer_engine)[("route.headway_min.am.weekday", "R1", 0)] == (
        Decimal("15.0"),
        "minutes",
        [first.fetch_run_id],
        "headway.v1",
    )


def test_the_headway_definitions_are_registered() -> None:
    keys = {f"route.headway_min.{band}.{kind}" for band in service.BANDS for kind in service.DAYTYPES}
    assert keys <= set(METRICS.definitions)


# Reader views (Postgres)


def test_the_reader_sees_the_active_feed_views_but_not_the_tables(
    load_feed: LoadFeed, db: DbUrls, writer_engine: Engine
) -> None:
    load_feed()
    reader = db.engine("reader")
    with reader.connect() as connection:
        counts = {
            view: connection.execute(text(f"SELECT count(*) FROM tda.{view}")).scalar_one()
            for view in (
                "active_gtfs_feed",
                "active_gtfs_stop",
                "active_gtfs_route",
                "active_gtfs_trip",
                "active_gtfs_stop_time",
                "active_gtfs_calendar",
                "active_gtfs_calendar_date",
                "approved_service_alert",
            )
        }
        for table in ("gtfs_stop_time", "gtfs_feed_activation", "service_alert", "fetch_run"):
            with pytest.raises(DBAPIError, match="permission denied"):
                connection.execute(text(f"SELECT 1 FROM tda.{table}"))
            connection.rollback()
        privileges = connection.execute(
            text(
                "SELECT c.relname, has_table_privilege('tda_reader', c.oid, 'SELECT'), "
                "has_table_privilege('tda_reader', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE') "
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'tda' AND c.relname = ANY(:views)"
            ),
            {"views": list(counts)},
        ).all()
    reader.dispose()
    assert sorted(privileges) == sorted((view, True, False) for view in counts), "SELECT only"
    assert counts == {
        "active_gtfs_feed": 1,
        "active_gtfs_stop": 10,
        "active_gtfs_route": 2,
        "active_gtfs_trip": 4,
        "active_gtfs_stop_time": 23,
        "active_gtfs_calendar": 2,
        "active_gtfs_calendar_date": 2,
        "approved_service_alert": 0,
    }


def test_only_an_approved_sources_feed_is_active(load_feed: LoadFeed, writer_engine: Engine) -> None:
    load_feed()
    with writer_engine.begin() as connection:
        connection.execute(text("UPDATE tda.source SET status = 'disabled' WHERE id = 'carta-gtfs'"))
    assert rows(writer_engine, "SELECT count(*) FROM tda.active_gtfs_stop") == [(0,)]


def test_the_migration_round_trips(db: DbUrls, writer_engine: Engine) -> None:
    downgrade(db.admin, "0005_eia_gas")
    left = rows(
        writer_engine,
        "SELECT count(*) FROM information_schema.views WHERE table_schema = 'tda' "
        "AND (table_name LIKE 'active_gtfs_%' OR table_name = 'approved_service_alert')",
    )
    assert left == [(0,)]
    upgrade(db.admin)
    assert rows(writer_engine, "SELECT count(*) FROM tda.active_gtfs_feed") == [(0,)]
