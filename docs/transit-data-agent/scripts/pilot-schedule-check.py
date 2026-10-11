"""P4b real-data pilot: replayable schedule queries, checked mechanically against the published GTFS zip.

For each query (fixed future service dates and a fixed, mocked "now"), it compares three answers:
1. an independent reading of the raw CARTA GTFS zip (this file's own parser and rules, not tda code);
2. ``tda.metrics.compare.compare`` on the pilot database's active feed, with the same mocked "now";
3. optionally (``--api``), the running read API's ``/v1/compare``, which uses the wall clock. That's checked only
   for queries whose answer can't depend on the clock (marked ``api``): service dates after both clocks.

Agreement is **mechanical feed agreement**: the database, the API, and a separate reading of the same zip agree.
It is not the G1 human spot-check, which compares answers with CARTA's own published timetables.

Usage, from ``data_agent/`` with the pilot env exported (reader URL; nothing is written):
    uv run python ../docs/transit-data-agent/scripts/pilot-schedule-check.py --raw <zip> [--api http://127.0.0.1:18081]
Exit 0 when every answer agrees.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from tda.api.citable import approved_facts
from tda.config.settings import get_settings
from tda.metrics.compare import compare
from tda.metrics.feeds import active_feed
from tda.store.db import reader_engine

NY = ZoneInfo("America/New_York")
BEFORE = datetime(2026, 10, 12, 12, 0, tzinfo=NY)  # the mocked "now": before every service date below
ALLOWED = {"", "0", "3"}  # pickup/drop-off types a rider can use without phoning ahead

# (label, origin, destination, service date, mode, HH:MM, mocked now, also check the live API)
QUERIES: list[tuple[str, str, str, date, str, str, datetime, bool]] = [
    ("rush-hour 2b candidate (213)", "764293", "764296", date(2026, 10, 13), "arrive_by", "08:30", BEFORE, True),
    ("rush-hour alt origin (213)", "764264", "764296", date(2026, 10, 13), "arrive_by", "08:30", BEFORE, True),
    ("rush-hour nearest stops", "770037", "764287", date(2026, 10, 13), "arrive_by", "08:30", BEFORE, True),
    (
        "rush-hour departed (arrive_by)",
        "764293",
        "764296",
        date(2026, 10, 13),
        "arrive_by",
        "08:30",
        datetime(2026, 10, 13, 8, 0, tzinfo=NY),
        False,
    ),
    (
        "rush-hour departed (depart_at)",
        "764293",
        "764296",
        date(2026, 10, 13),
        "depart_at",
        "08:00",
        datetime(2026, 10, 13, 8, 0, tzinfo=NY),
        False,
    ),
    ("weekend P0 pair", "764867", "2619312", date(2026, 10, 17), "arrive_by", "14:00", BEFORE, True),
    ("weekend beach shuttle, season over", "764507", "2619312", date(2026, 10, 17), "depart_at", "17:00", BEFORE, True),
    (
        "weekend beach shuttle, in season",
        "764507",
        "2619312",
        date(2026, 9, 5),
        "depart_at",
        "17:00",
        datetime(2026, 9, 4, 12, 0, tzinfo=NY),
        False,
    ),
    ("night-out 2b candidate Fri (210)", "764257", "764279", date(2026, 10, 16), "arrive_by", "23:30", BEFORE, True),
    ("night-out Sat (210)", "764257", "764279", date(2026, 10, 17), "arrive_by", "23:30", BEFORE, True),
    ("night-out King St one-way (211)", "764249", "800537", date(2026, 10, 16), "arrive_by", "23:30", BEFORE, True),
    ("DASH 211 Saturday", "764307", "764867", date(2026, 10, 17), "depart_at", "16:00", BEFORE, True),
    ("DASH 211 Thanksgiving", "764307", "764867", date(2026, 11, 26), "depart_at", "16:00", BEFORE, True),
    ("DASH 210 weekday", "764327", "764239", date(2026, 10, 13), "depart_at", "11:00", BEFORE, True),
    ("shared corridor (213, 33)", "764333", "800539", date(2026, 10, 13), "depart_at", "07:00", BEFORE, True),
    ("Express XP1 weekday", "764176", "764871", date(2026, 10, 13), "depart_at", "07:00", BEFORE, True),
    ("Express XP1 Saturday", "764176", "764871", date(2026, 10, 17), "depart_at", "07:00", BEFORE, True),
    ("Express XP2 weekday", "764616", "764315", date(2026, 10, 13), "depart_at", "19:00", BEFORE, True),
    ("Express XP3 weekday", "800540", "764703", date(2026, 10, 13), "depart_at", "17:00", BEFORE, True),
    ("overnight route 10 (24:50)", "764796", "764875", date(2026, 10, 14), "depart_at", "00:40", BEFORE, True),
    ("overnight route 30 Sat->Sun", "764287", "764333", date(2026, 10, 18), "depart_at", "00:00", BEFORE, True),
    ("route 11 weekday", "764851", "764585", date(2026, 10, 13), "depart_at", "13:00", BEFORE, True),
    ("route 12 weekday", "764570", "764740", date(2026, 10, 13), "depart_at", "07:00", BEFORE, True),
    ("route 13 weekday", "764582", "2456406", date(2026, 10, 13), "depart_at", "07:30", BEFORE, True),
    ("route 20 Saturday", "764216", "764429", date(2026, 10, 17), "depart_at", "11:30", BEFORE, True),
    ("route 30 Sunday", "764395", "764230", date(2026, 10, 18), "depart_at", "13:00", BEFORE, True),
    ("route 31 weekday", "764333", "764196", date(2026, 10, 13), "depart_at", "13:00", BEFORE, True),
    ("route 32 weekday", "807758", "794856", date(2026, 10, 13), "depart_at", "06:00", BEFORE, True),
    ("route 33 Saturday", "764333", "764395", date(2026, 10, 17), "depart_at", "11:30", BEFORE, True),
    ("route 40 weekday", "764333", "764489", date(2026, 10, 13), "depart_at", "19:00", BEFORE, True),
    ("route 41 weekday", "764489", "794855", date(2026, 10, 13), "depart_at", "11:00", BEFORE, True),
    ("route 42 Saturday", "764514", "764616", date(2026, 10, 17), "depart_at", "14:00", BEFORE, True),
    ("route 102 weekday", "819712", "794785", date(2026, 10, 13), "depart_at", "17:30", BEFORE, True),
    ("route 103 weekday", "764582", "764529", date(2026, 10, 13), "depart_at", "12:00", BEFORE, True),
    ("route 104 weekday", "819848", "2559088", date(2026, 10, 13), "depart_at", "20:00", BEFORE, True),
    ("route 203 weekday", "764321", "764268", date(2026, 10, 13), "depart_at", "20:00", BEFORE, True),
    ("route 301 weekday", "764502", "764373", date(2026, 10, 13), "depart_at", "08:00", BEFORE, True),
]


class Feed:
    """The raw GTFS zip, read independently of the data agent's loader."""

    def __init__(self, path: str) -> None:
        with zipfile.ZipFile(path) as archive:
            read = lambda name: list(csv.DictReader(io.TextIOWrapper(archive.open(name), "utf-8-sig")))  # noqa: E731
            self.routes = {r["route_id"]: r for r in read("routes.txt")}
            self.trips = {t["trip_id"]: t for t in read("trips.txt")}
            self.calendar = read("calendar.txt")
            self.exceptions = read("calendar_dates.txt")
            self.fares = {f["fare_id"]: f for f in read("fare_attributes.txt")}
            self.fare_rules = read("fare_rules.txt")
            stops = read("stops.txt")
            self.visits: dict[str, dict[str, list[dict[str, str]]]] = defaultdict(lambda: defaultdict(list))
            used = set()
            for row in read("stop_times.txt"):
                self.visits[row["stop_id"]][row["trip_id"]].append(row)
                used.add(row["stop_id"])
        self.boardable = {s["stop_id"] for s in stops if s.get("location_type", "") in ("", "0") and s["stop_id"] in used}

    def services(self, day: date) -> set[str]:
        flag = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[day.weekday()]
        key = day.strftime("%Y%m%d")
        running = {c["service_id"] for c in self.calendar if c["start_date"] <= key <= c["end_date"] and c[flag] == "1"}
        for e in self.exceptions:
            if e["date"] == key:
                (running.add if e["exception_type"] == "1" else running.discard)(e["service_id"])
        return running

    def fare(self, route_id: str) -> Decimal | None:
        rules = [r for r in self.fare_rules if r.get("route_id", "") in ("", route_id)]
        if any(r.get(z) for r in rules for z in ("origin_id", "destination_id", "contains_id")):
            return None
        ids = {r["fare_id"] for r in rules}
        return Decimal(self.fares[ids.pop()]["price"]) if len(ids) == 1 else None


def seconds(value: str) -> int:
    h, m, s = (int(x) for x in value.split(":"))
    return h * 3600 + m * 60 + s


def at_service(day: date, secs: int) -> datetime:
    """GTFS time: seconds after "noon minus 12 h" of the service day, in the agency's zone."""
    noon = datetime.combine(day, time(12), tzinfo=NY)
    return (noon.astimezone(ZoneInfo("UTC")) - timedelta(hours=12) + timedelta(seconds=secs)).astimezone(NY)


def reference(feed: Feed, origin: str, dest: str, day: date, mode: str, hhmm: str, now: datetime) -> dict:
    if origin not in feed.boardable or dest not in feed.boardable:
        return {"reason": "unknown_stop"}
    target = datetime.combine(day, time(*(int(x) for x in hhmm.split(":"))), tzinfo=NY)
    common = set(feed.visits[origin]) & set(feed.visits[dest])
    candidates = []
    for trip_id in common:
        origins = sorted(feed.visits[origin][trip_id], key=lambda r: int(r["stop_sequence"]))
        for arrive in sorted(feed.visits[dest][trip_id], key=lambda r: int(r["stop_sequence"])):
            before = [o for o in origins if int(o["stop_sequence"]) < int(arrive["stop_sequence"])]
            if before:
                board = ([o for o in before if o["pickup_type"] in ALLOWED] or before)[-1]
                candidates.append((trip_id, board, arrive))
    if not candidates:
        return {"reason": "transfer_required"}
    options, runs_today = [], False
    for service_day in (day - timedelta(days=1), day):
        running = feed.services(service_day)
        for trip_id, board, arrive in candidates:
            if feed.trips[trip_id]["service_id"] not in running:
                continue
            runs_today = runs_today or service_day == day
            dep = at_service(service_day, seconds(board["departure_time"] or board["arrival_time"]))
            arr = at_service(service_day, seconds(arrive["arrival_time"] or arrive["departure_time"]))
            if arr < dep or not (service_day == day or dep.date() == day):
                continue
            ok = board["pickup_type"] in ALLOWED and arrive["drop_off_type"] in ALLOWED
            options.append((trip_id, service_day, dep, arr, ok))
    if not options:
        return {"reason": "no_boardable_trip" if runs_today else "no_service"}
    earliest = now + timedelta(minutes=5)
    usable = [o for o in options if o[4] and o[2] >= earliest]
    if mode == "arrive_by":
        chosen = sorted((o for o in usable if o[3] <= target), key=lambda o: (-o[3].timestamp(), -o[2].timestamp(), o[0]))
    else:
        chosen = sorted((o for o in usable if o[2] >= target), key=lambda o: (o[2], o[3], o[0]))
    unique, seen = [], set()
    for o in chosen:
        if (o[0], o[1]) not in seen:
            seen.add((o[0], o[1]))
            unique.append(o)
    if not unique:
        return {"reason": "no_boardable_trip"}
    best = unique[0]
    route = feed.trips[best[0]]["route_id"]
    return {
        "reason": None,
        "trip": best[0],
        "departure": best[2].isoformat(),
        "arrival": best[3].isoformat(),
        "alternatives": [o[0] for o in unique[1:4]],
        "route": feed.routes[route]["route_short_name"] or feed.routes[route]["route_long_name"],
        "fare": feed.fare(route),
    }


def from_tda(connection, feed, buffer, origin, dest, day, mode, hhmm, now) -> dict:  # noqa: ANN001
    result = compare(
        connection,
        feed,
        origin=origin,
        dest=dest,
        day=day,
        mode=mode,
        at=time(*(int(x) for x in hhmm.split(":"))),
        access_buffer=buffer,
        now=now,
    )
    if result.best is None:
        return {"reason": result.reason}
    best = result.best
    return {
        "reason": None,
        "trip": best.trip_id,
        "departure": best.departure.isoformat(),
        "arrival": best.arrival.isoformat(),
        "alternatives": [o.trip_id for o in result.alternatives],
        "route": best.route_short_name or best.route_long_name,
        "fare": best.fare.price if best.fare else None,
    }


def from_api(base: str, origin: str, dest: str, day: date, mode: str, hhmm: str) -> dict:
    query = urllib.parse.urlencode({"origin_stop_id": origin, "dest_stop_id": dest, "date": day.isoformat(), mode: hhmm})
    with urllib.request.urlopen(f"{base}/v1/compare?{query}", timeout=10) as response:  # noqa: S310 (loopback)
        body = json.load(response)
    trip = body["transit"]
    if trip is None:
        return {"reason": body["reason"]}
    return {
        "reason": None,
        "trip": trip["trip_id"],
        "departure": datetime.fromisoformat(trip["departure"]).isoformat(),
        "arrival": datetime.fromisoformat(trip["arrival"]).isoformat(),
        "alternatives": [a["trip_id"] for a in body["alternatives"]],
        "route": trip["route_short_name"] or trip["route_long_name"],
        "fare": Decimal(str(trip["fare"]["price"])).quantize(Decimal("0.01")) if trip["fare"] else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--raw", required=True, help="the raw GTFS zip the active feed was loaded from")
    parser.add_argument("--api", help="the read API base URL, for example http://127.0.0.1:18081")
    args = parser.parse_args()
    feed_zip = Feed(args.raw)
    engine = reader_engine(get_settings())
    failures = 0
    print("| # | Query | Stops | Date, request | Answer (raw zip) | tda | API |")
    print("|---|-------|-------|---------------|------------------|-----|-----|")
    with engine.connect() as connection:
        feed = active_feed(connection, "carta-gtfs")
        buffer_fact = next(iter(approved_facts(connection, ["transit.access_buffer_min"])))
        buffer = timedelta(minutes=float(buffer_fact.value_num))
        for n, (label, origin, dest, day, mode, hhmm, now, api) in enumerate(QUERIES, 1):
            expected = reference(feed_zip, origin, dest, day, mode, hhmm, now)
            got = from_tda(connection, feed, buffer, origin, dest, day, mode, hhmm, now)
            if got.get("fare") is not None:
                got["fare"] = Decimal(got["fare"]).quantize(Decimal("0.01"))
            if expected.get("fare") is not None:
                expected["fare"] = expected["fare"].quantize(Decimal("0.01"))
            tda_ok = got == expected
            api_cell = "not run (clock-dependent)" if not api else "-"
            if api and args.api:
                api_ok = from_api(args.api, origin, dest, day, mode, hhmm) == expected
                api_cell = "agrees" if api_ok else "DIFFERS"
                failures += not api_ok
            failures += not tda_ok
            if expected["reason"]:
                answer = f"`{expected['reason']}`"
            else:
                dep, arr = expected["departure"][11:19], expected["arrival"][11:19]
                fare = f"fare ${expected['fare']}" if expected["fare"] is not None else "fare unknown"
                answer = f"route {expected['route']}, trip {expected['trip']}, {dep}→{arr}, {fare}"
                answer += f", next {len(expected['alternatives'])}"
            mocked = "" if now == BEFORE else f", now {now:%Y-%m-%d %H:%M}"
            print(
                f"| {n} | {label} | {origin}→{dest} | {day} {mode} {hhmm}{mocked} | {answer} | "
                f"{'agrees' if tda_ok else 'DIFFERS'} | {api_cell} |"
            )
            if not tda_ok:
                print(f"    expected {expected}\n    got      {got}", file=sys.stderr)
    engine.dispose()
    pairs = len({(q[1], q[2]) for q in QUERIES})
    print(f"\n{len(QUERIES)} queries, {pairs} distinct stop pairs, {failures} disagreement(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
