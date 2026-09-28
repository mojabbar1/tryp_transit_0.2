"""CARTA GTFS static (P3.1, catalog S-1, source ``carta-gtfs``).

Each changed feed (a new sha256) becomes a new ``gtfs_feed_version``, with its rows in seven append-only
tables. It is activated in the same transaction if its service has started (in the agency's time zone). An
unchanged feed is ``not_modified`` (a 304, or the same sha256). Nothing is updated or deleted: activation
appends to ``gtfs_feed_activation``, and rolling back a load makes the previous valid feed active again.

Data-quality checks. Any failure marks the run ``failed`` and loads nothing:
- the body is a zip within the size limit, with agency, stops, routes, trips, and stop_times, plus calendar
  and/or calendar_dates;
- there is at least one stop, and each table's key is unique;
- stop_times reference known trips and stops, and trips reference known routes (no orphans);
- times parse as H:MM:SS, allowing 24:00:00 and later (GTFS service days); dates parse, and start <= end;
- required times are present: ``arrival_time`` at each trip's first and last stop, and both times at every
  exact timepoint (``timepoint`` 1, or empty, which GTFS treats as exact). Only approximate stops
  (``timepoint`` 0) may leave both blank;
- features this loader doesn't store are refused rather than dropped: GTFS-Flex (Flex fields in stop_times,
  or Flex files with rows) and headway-based trips (``frequencies.txt`` with rows). Header-only files, as in
  CARTA's feed, are fine.
A trip whose service_id isn't in calendar or calendar_dates never runs; that is logged, not fatal.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from collections.abc import Callable, Iterable
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from sqlalchemy import Connection, text

from tda.connectors.base import Connector, FetchResult, LoadStats, PriorRun, Row, ValidationFailed
from tda.connectors.registry import register
from tda.http.polite_client import NotModified, RequestBudget
from tda.store.lineage import LineageError, key_lock, lock_input_runs
from tda.store.observations import content_hash, insert_observations

log = structlog.get_logger(__name__)

MAX_UNCOMPRESSED = 512 * 1024 * 1024
REQUIRED = ("agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt")
CHILD_TABLES = (
    "gtfs_stop",
    "gtfs_route",
    "gtfs_trip",
    "gtfs_stop_time",
    "gtfs_calendar",
    "gtfs_calendar_date",
    "gtfs_shape",
)
DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
# GTFS-Flex stop_times fields, plus the earlier Flex draft's fields that some producers still export (empty).
FLEX_FIELDS = (
    "start_pickup_drop_off_window",
    "end_pickup_drop_off_window",
    "location_group_id",
    "location_id",
    "pickup_booking_rule_id",
    "drop_off_booking_rule_id",
    "start_service_area_id",
    "end_service_area_id",
    "start_service_area_radius",
    "end_service_area_radius",
    "min_arrival_time",
    "max_departure_time",
    "mean_duration_factor",
    "mean_duration_offset",
    "safe_duration_factor",
    "safe_duration_offset",
)
UNSUPPORTED_FILES = {
    "location_groups.txt": "GTFS-Flex",
    "location_group_stops.txt": "GTFS-Flex",
    "booking_rules.txt": "GTFS-Flex",
    "frequencies.txt": "headway-based trips",
}
_TIME = re.compile(r"^(\d{1,3}):([0-5]\d):([0-5]\d)$")
_DATE = re.compile(r"^\d{8}$")

Parsed = dict[str, list[dict[str, Any]]]


class _Rows:
    """One GTFS file's rows, with field parsers that name the file, row, and field on failure."""

    def __init__(self, name: str, rows: list[dict[str, str]]) -> None:
        self.name = name
        self.rows = rows

    def fail(self, index: int, message: str) -> ValidationFailed:
        return ValidationFailed(f"{self.name} row {index + 2}: {message}")

    def text(self, index: int, field: str, *, required: bool = False) -> str | None:
        value = self.rows[index].get(field) or None
        if required and value is None:
            raise self.fail(index, f"{field} is required")
        return value

    def number(self, index: int, field: str, kind: Callable[[str], Any], *, required: bool = False) -> Any:
        value = self.text(index, field, required=required)
        if value is None:
            return None
        try:
            return kind(value)
        except ValueError:
            raise self.fail(index, f"{field} {value!r} is not a valid {kind.__name__}") from None

    def day(self, index: int, field: str) -> date:
        value = self.text(index, field, required=True)
        assert value is not None
        try:
            if not _DATE.match(value):
                raise ValueError
            return date(int(value[:4]), int(value[4:6]), int(value[6:]))
        except ValueError:
            raise self.fail(index, f"{field} {value!r} is not a YYYYMMDD date") from None

    def seconds(self, index: int, field: str) -> int | None:
        value = self.text(index, field)
        if value is None:
            return None
        match = _TIME.match(value)
        if not match:
            raise self.fail(index, f"{field} {value!r} is not H:MM:SS")
        hours, minutes, secs = (int(part) for part in match.groups())
        return hours * 3600 + minutes * 60 + secs


def _open(raw: bytes) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ValidationFailed("the feed is not a zip file") from None
    declared = sum(info.file_size for info in archive.infolist())
    if declared > MAX_UNCOMPRESSED:
        raise ValidationFailed(f"the feed would unpack to {declared} bytes (limit {MAX_UNCOMPRESSED})")
    return archive


def _read(archive: zipfile.ZipFile, name: str) -> _Rows:
    with archive.open(name) as handle:
        reader = csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8-sig", newline=""))
        fields = [field.strip() for field in reader.fieldnames or []]
        reader.fieldnames = fields
        rows = [{k: (v or "").strip() for k, v in row.items() if k is not None} for row in reader]
    return _Rows(name, rows)


def _unique(rows: list[dict[str, Any]], key: tuple[str, ...], name: str) -> None:
    seen: set[tuple[Any, ...]] = set()
    for row in rows:
        value = tuple(row[k] for k in key)
        if value in seen:
            raise ValidationFailed(f"{name}: duplicate {', '.join(key)} {value}")
        seen.add(value)


def _reject_unsupported(archive: zipfile.ZipFile, names: set[str]) -> None:
    """Refuse files whose rows this loader would drop silently (header-only and empty files are fine)."""
    for name, feature in UNSUPPORTED_FILES.items():
        if name in names and _read(archive, name).rows:
            raise ValidationFailed(f"{name} has rows: {feature} isn't supported")
    if "locations.geojson" in names:
        raw = archive.read("locations.geojson").strip()
        if raw:
            try:
                features = json.loads(raw).get("features")
            except (ValueError, AttributeError):
                raise ValidationFailed("locations.geojson is not valid GeoJSON") from None
            if features:
                raise ValidationFailed("locations.geojson has features: GTFS-Flex isn't supported")


def _check_times(src: _Rows, stop_times: list[dict[str, Any]]) -> None:
    """GTFS required times: arrival at each trip's first and last stop, and both times at exact timepoints."""
    trips: dict[str, list[int]] = defaultdict(list)
    for i, stop_time in enumerate(stop_times):
        timepoint = stop_time["timepoint"]
        if timepoint not in (None, 0, 1):
            raise src.fail(i, f"timepoint {timepoint} is not 0 or 1")
        if timepoint != 0:
            for field in ("arrival_time", "departure_time"):
                if stop_time[field] is None:
                    raise src.fail(i, f"{field} is required at an exact timepoint (timepoint 1 or empty)")
        trips[stop_time["trip_id"]].append(i)
    for trip_id, indices in trips.items():
        ordered = sorted(indices, key=lambda i: stop_times[i]["stop_sequence"])
        for i in dict.fromkeys((ordered[0], ordered[-1])):
            if stop_times[i]["arrival_time"] is None:
                raise src.fail(i, f"arrival_time is required at the first and last stop of trip {trip_id}")


def parse_feed(raw: bytes) -> tuple[dict[str, Any], Parsed]:
    """Validate a GTFS zip and return (feed version row, rows per table). Raises ValidationFailed."""
    archive = _open(raw)
    names = set(archive.namelist())
    missing = [name for name in REQUIRED if name not in names]
    if "calendar.txt" not in names and "calendar_dates.txt" not in names:
        missing.append("calendar.txt or calendar_dates.txt")
    if missing:
        raise ValidationFailed(f"required files missing: {', '.join(missing)}")
    _reject_unsupported(archive, names)

    agency = _read(archive, "agency.txt")
    if not agency.rows:
        raise ValidationFailed("agency.txt has no rows")
    timezone = agency.text(0, "agency_timezone", required=True)
    try:
        ZoneInfo(timezone or "")
    except (ZoneInfoNotFoundError, ValueError):
        raise ValidationFailed(f"agency.txt: unknown agency_timezone {timezone!r}") from None

    tables: Parsed = {}
    src = _read(archive, "stops.txt")
    tables["gtfs_stop"] = [
        {
            "stop_id": src.text(i, "stop_id", required=True),
            "stop_code": src.text(i, "stop_code"),
            "stop_name": src.text(i, "stop_name"),
            "stop_lat": src.number(i, "stop_lat", float),
            "stop_lon": src.number(i, "stop_lon", float),
            "zone_id": src.text(i, "zone_id"),
            "location_type": src.number(i, "location_type", int),
            "parent_station": src.text(i, "parent_station"),
            "wheelchair_boarding": src.number(i, "wheelchair_boarding", int),
        }
        for i in range(len(src.rows))
    ]
    for i, stop in enumerate(tables["gtfs_stop"]):
        kind = stop["location_type"] or 0
        if kind not in (0, 1, 2, 3, 4):
            raise src.fail(i, f"location_type {kind} is not 0-4")
        coords = (stop["stop_lat"], stop["stop_lon"])
        if kind in (0, 1, 2) and None in coords:
            raise src.fail(i, "stop_lat and stop_lon are required")
        lat, lon = coords
        if (lat is not None and not -90 <= lat <= 90) or (lon is not None and not -180 <= lon <= 180):
            raise src.fail(i, f"coordinates {coords} are out of range")
    if not tables["gtfs_stop"]:
        raise ValidationFailed("stops.txt has no stops")

    src = _read(archive, "routes.txt")
    tables["gtfs_route"] = [
        {
            "route_id": src.text(i, "route_id", required=True),
            "agency_id": src.text(i, "agency_id"),
            "route_short_name": src.text(i, "route_short_name"),
            "route_long_name": src.text(i, "route_long_name"),
            "route_type": src.number(i, "route_type", int, required=True),
            "route_color": src.text(i, "route_color"),
            "route_text_color": src.text(i, "route_text_color"),
        }
        for i in range(len(src.rows))
    ]

    src = _read(archive, "trips.txt")
    tables["gtfs_trip"] = [
        {
            "trip_id": src.text(i, "trip_id", required=True),
            "route_id": src.text(i, "route_id", required=True),
            "service_id": src.text(i, "service_id", required=True),
            "trip_headsign": src.text(i, "trip_headsign"),
            "direction_id": src.number(i, "direction_id", int),
            "block_id": src.text(i, "block_id"),
            "shape_id": src.text(i, "shape_id"),
        }
        for i in range(len(src.rows))
    ]

    src = _read(archive, "stop_times.txt")
    for i, row in enumerate(src.rows):
        flex = [field for field in FLEX_FIELDS if row.get(field)]
        if flex:
            raise src.fail(i, f"uses GTFS-Flex ({', '.join(flex)}), which isn't supported")
    stop_times = []
    for i in range(len(src.rows)):
        sequence = src.number(i, "stop_sequence", int, required=True)
        if sequence < 0:
            raise src.fail(i, "stop_sequence is negative")
        stop_times.append(
            {
                "trip_id": src.text(i, "trip_id", required=True),
                "stop_sequence": sequence,
                "stop_id": src.text(i, "stop_id", required=True),
                "arrival_time": src.text(i, "arrival_time"),
                "departure_time": src.text(i, "departure_time"),
                "arrival_s": src.seconds(i, "arrival_time"),
                "departure_s": src.seconds(i, "departure_time"),
                "pickup_type": src.number(i, "pickup_type", int),
                "drop_off_type": src.number(i, "drop_off_type", int),
                "shape_dist_traveled": src.number(i, "shape_dist_traveled", float),
                "timepoint": src.number(i, "timepoint", int),
            }
        )
    _check_times(src, stop_times)
    tables["gtfs_stop_time"] = stop_times

    tables["gtfs_calendar"] = []
    if "calendar.txt" in names:
        src = _read(archive, "calendar.txt")
        for i in range(len(src.rows)):
            row: dict[str, Any] = {"service_id": src.text(i, "service_id", required=True)}
            for day in DAYS:
                flag = src.text(i, day, required=True)
                if flag not in ("0", "1"):
                    raise src.fail(i, f"{day} must be 0 or 1, not {flag!r}")
                row[day] = flag == "1"
            row["start_date"], row["end_date"] = src.day(i, "start_date"), src.day(i, "end_date")
            if row["start_date"] > row["end_date"]:
                raise src.fail(i, "start_date is after end_date")
            tables["gtfs_calendar"].append(row)

    tables["gtfs_calendar_date"] = []
    if "calendar_dates.txt" in names:
        src = _read(archive, "calendar_dates.txt")
        for i in range(len(src.rows)):
            exception = src.number(i, "exception_type", int, required=True)
            if exception not in (1, 2):
                raise src.fail(i, f"exception_type must be 1 or 2, not {exception}")
            tables["gtfs_calendar_date"].append(
                {
                    "service_id": src.text(i, "service_id", required=True),
                    "date": src.day(i, "date"),
                    "exception_type": exception,
                }
            )

    tables["gtfs_shape"] = []
    if "shapes.txt" in names:
        src = _read(archive, "shapes.txt")
        tables["gtfs_shape"] = [
            {
                "shape_id": src.text(i, "shape_id", required=True),
                "shape_pt_sequence": src.number(i, "shape_pt_sequence", int, required=True),
                "shape_pt_lat": src.number(i, "shape_pt_lat", float, required=True),
                "shape_pt_lon": src.number(i, "shape_pt_lon", float, required=True),
                "shape_dist_traveled": src.number(i, "shape_dist_traveled", float),
            }
            for i in range(len(src.rows))
        ]

    for table, key in (
        ("gtfs_stop", ("stop_id",)),
        ("gtfs_route", ("route_id",)),
        ("gtfs_trip", ("trip_id",)),
        ("gtfs_stop_time", ("trip_id", "stop_sequence")),
        ("gtfs_calendar", ("service_id",)),
        ("gtfs_calendar_date", ("service_id", "date")),
        ("gtfs_shape", ("shape_id", "shape_pt_sequence")),
    ):
        _unique(tables[table], key, table)
    _check_references(tables)
    return _version(archive, names, raw, timezone or "", tables), tables


def _check_references(tables: Parsed) -> None:
    trips = {trip["trip_id"] for trip in tables["gtfs_trip"]}
    stops = {stop["stop_id"] for stop in tables["gtfs_stop"]}
    routes = {route["route_id"] for route in tables["gtfs_route"]}
    stop_times, trip_rows = tables["gtfs_stop_time"], tables["gtfs_trip"]
    orphans = [
        ("stop_times with an unknown trip_id", sum(1 for st in stop_times if st["trip_id"] not in trips)),
        ("stop_times with an unknown stop_id", sum(1 for st in stop_times if st["stop_id"] not in stops)),
        ("trips with an unknown route_id", sum(1 for trip in trip_rows if trip["route_id"] not in routes)),
    ]
    found = [f"{count} {what}" for what, count in orphans if count]
    if found:
        raise ValidationFailed("orphans: " + "; ".join(found))
    services = {c["service_id"] for c in tables["gtfs_calendar"]} | {
        c["service_id"] for c in tables["gtfs_calendar_date"]
    }
    idle = sum(1 for trip in tables["gtfs_trip"] if trip["service_id"] not in services)
    if idle:
        log.warning("gtfs.trips_without_service", trips=idle)


def _version(
    archive: zipfile.ZipFile, names: set[str], raw: bytes, timezone: str, tables: Parsed
) -> dict[str, Any]:
    info: dict[str, Any] = {}
    if "feed_info.txt" in names:
        feed_info = _read(archive, "feed_info.txt")
        if feed_info.rows:
            info = {
                "label": feed_info.text(0, "feed_version"),
                "publisher": feed_info.text(0, "feed_publisher_name"),
                "start": feed_info.day(0, "feed_start_date")
                if feed_info.text(0, "feed_start_date")
                else None,
                "end": feed_info.day(0, "feed_end_date") if feed_info.text(0, "feed_end_date") else None,
            }
    exceptions = [c["date"] for c in tables["gtfs_calendar_date"]]
    starts = [c["start_date"] for c in tables["gtfs_calendar"]] + exceptions
    ends = [c["end_date"] for c in tables["gtfs_calendar"]] + exceptions
    start = info.get("start") or (min(starts) if starts else None)
    end = info.get("end") or (max(ends) if ends else None)
    if start is None or end is None:
        raise ValidationFailed("the feed has no service dates")
    if start > end:
        raise ValidationFailed(f"the feed starts ({start}) after it ends ({end})")
    return {
        "feed_sha256": hashlib.sha256(raw).hexdigest(),
        "feed_label": info.get("label"),
        "publisher": info.get("publisher"),
        "feed_start": start,
        "feed_end": end,
        "agency_timezone": timezone,
    }


def _today(timezone: str) -> date:
    return datetime.now(ZoneInfo(timezone)).date()


@register
class GtfsStaticConnector(Connector):
    """CARTA's GTFS zip, fetched with a conditional GET once a day."""

    source_id = "carta-gtfs"
    owned_tables = ("gtfs_feed_version", *CHILD_TABLES)

    def fetch(self, prior: PriorRun | None, budget: RequestBudget | None) -> FetchResult | NotModified:
        return self.http_get(prior, budget, ext="zip")

    def normalize(self, raw: bytes) -> Iterable[Row]:
        version, tables = parse_feed(raw)
        yield {"_table": "gtfs_feed_version", **version}
        for table in CHILD_TABLES:
            for row in tables[table]:
                yield {"_table": table, **row}

    def load(self, connection: Connection, rows: list[Row], run_id: int) -> LoadStats:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            fields = dict(row)
            grouped[fields.pop("_table")].append(fields)
        (version,) = grouped.pop("gtfs_feed_version")
        record = {"source_id": self.source.id, **version}
        version_id = connection.execute(
            text(
                "INSERT INTO tda.gtfs_feed_version (source_id, feed_sha256, feed_label, publisher, "
                "feed_start, feed_end, agency_timezone, content_hash, fetch_run_id) "
                "VALUES (:source_id, :feed_sha256, :feed_label, :publisher, :feed_start, :feed_end, "
                ":agency_timezone, :content_hash, :run) RETURNING id"
            ),
            {**record, "content_hash": content_hash(record), "run": run_id},
        ).scalar_one()
        counts = {"gtfs_feed_version": 1}
        for table in CHILD_TABLES:
            batch = [{**row, "feed_version_id": version_id} for row in grouped.get(table, [])]
            counts[table] = insert_observations(connection, table, batch, run_id)
        if version["feed_start"] <= _today(version["agency_timezone"]):
            activate(connection, self.source.id, version_id, "connector", loading_run=run_id)
        else:
            log.info("gtfs.pending_activation", feed_version_id=version_id, starts=str(version["feed_start"]))
        return LoadStats(counts)


def activate(
    connection: Connection, source_id: str, feed_version_id: int, by: str, *, loading_run: int | None = None
) -> None:
    """Make a feed version active by appending an activation.

    Activations of a source are serialized by a transaction-scoped lock taken first, so the newest by id is
    the newest to commit. During a load (``loading_run``), the version must belong to that run. Otherwise,
    as from ``tda gtfs activate``, its run is locked ``FOR SHARE`` and must still be a success (the lineage
    rule): the same test the current view uses, so any current version can be activated, and an activation
    can't race a rollback of that feed.
    """
    key_lock(connection, "gtfs_activation", source_id)
    run_id = connection.execute(
        text("SELECT fetch_run_id FROM tda.gtfs_feed_version WHERE id = :i AND source_id = :s"),
        {"i": feed_version_id, "s": source_id},
    ).scalar_one_or_none()
    if run_id is None:
        raise LookupError(f"no {source_id} feed version {feed_version_id}")
    if loading_run is not None:
        if run_id != loading_run:
            raise LookupError(f"feed version {feed_version_id} was not loaded by run {loading_run}")
    else:
        try:
            lock_input_runs(connection, [run_id])
        except LineageError:
            raise LookupError(
                f"feed version {feed_version_id} is not current: its load was rolled back"
            ) from None
    connection.execute(
        text(
            "INSERT INTO tda.gtfs_feed_activation (source_id, feed_version_id, activated_by) "
            "VALUES (:s, :i, :by)"
        ),
        {"s": source_id, "i": feed_version_id, "by": by},
    )
