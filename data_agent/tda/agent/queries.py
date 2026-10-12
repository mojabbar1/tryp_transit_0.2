"""Bounded, fixed read-only evidence export. No SQL/network/file/write tool is exposed to the model."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Connection, Engine, text

from tda.agent.report import (
    MAX_ALERTS,
    MAX_FACTS,
    MAX_SERVICE,
    AlertEvidence,
    Evidence,
    Packet,
    ReportError,
    SourceEvidence,
    Window,
    packet_digest,
    plain,
)
from tda.api.citable import approved_facts
from tda.api.transit import _active, _plain
from tda.facts.rules.eia_gas import KEY as FUEL_KEY
from tda.metrics.feeds import NoActiveFeed, active_feed
from tda.metrics.service import headways

SOURCE_IDS = ("carta-gtfs", "carta-gtfs-rt-alerts", "eia-gas", "ntd-monthly")
MODES = ("bus", "commuter_bus", "demand_response")
FACT_KEYS = (
    *(f"carta.ridership.upt.monthly.{mode}{suffix}" for mode in MODES for suffix in ("", ".yoy_pct")),
    FUEL_KEY,
)
BAND_LABELS = {
    "am": "AM (06:00–09:00)",
    "mid": "Mid (09:00–15:00)",
    "pm": "PM (15:00–19:00)",
    "eve": "Eve (19:00–24:00)",
    "night": "Night (before 06:00 or after 24:00; separate stretches)",
}


class QueryService:
    """The only preparation interface: one report window, no user-defined query or arbitrary source."""

    def __init__(self, engine: Engine):
        self.engine = engine

    def export(self, period: Window, *, generated_at: datetime | None = None) -> Packet:
        with self.engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
            with connection.begin():
                connection.execute(text("SET TRANSACTION READ ONLY"))
                connection.execute(text("SET LOCAL statement_timeout = '30s'"))
                if connection.execute(text("SELECT current_user")).scalar_one() != "tda_reader":
                    raise ReportError("reader_role_required")
                return _export(connection, period, generated_at or datetime.now(UTC))


def _export(connection: Connection, period: Window, generated_at: datetime) -> Packet:
    now = datetime.now(UTC)
    source_rows = connection.execute(
        text(
            "SELECT s.id, s.attribution_text, s.url, f.last_success, f.stale "
            "FROM tda.source s JOIN tda.source_freshness f ON f.source_id = s.id "
            "WHERE s.id = ANY(:ids) AND s.status = 'approved' ORDER BY s.id LIMIT 4"
        ),
        {"ids": list(SOURCE_IDS)},
    )
    sources = [
        SourceEvidence(
            source_id=row.id,
            attribution=plain(row.attribution_text) if row.attribution_text else None,
            url=row.url,
            last_success=row.last_success,
            stale=row.stale or row.last_success is None,
        )
        for row in source_rows
    ]
    fresh = {s.source_id: s for s in sources if not s.stale}
    unavailable = [
        f"{source_id}: source missing, unapproved, stale, or never successfully retrieved."
        for source_id in SOURCE_IDS
        if source_id not in fresh
    ]
    evidence = []
    for fact in approved_facts(connection, FACT_KEYS):
        expected_source = "eia-gas" if fact.key == FUEL_KEY else "ntd-monthly"
        expected_geography = "region:padd-1c" if fact.key == FUEL_KEY else "agency:ntd:40110"
        if (
            len(fact.sources) != 1
            or fact.sources[0].source_id != expected_source
            or expected_source not in fresh
            or fact.geography != expected_geography
            or fact.value_num is None
            or not fact.value_num.is_finite()
            or not fact.period.start
            or not fact.period.end
            or fact.period.start > fact.period.end
            or (fact.valid_until is not None and fact.valid_until < now.date())
            or not fact.sources[0].retrieved
            or not fact.unit
            or not fact.method
        ):
            unavailable.append(f"{fact.key}: expired or incomplete/unavailable provenance.")
            continue
        if fact.key == FUEL_KEY:
            kind, label, subject = (
                "fuel_price",
                "Regional fuel price",
                "Lower Atlantic PADD 1C regular gasoline",
            )
            evidence_id = "fuel_price"
        else:
            mode = fact.key.split(".")[4]
            change = fact.key.endswith(".yoy_pct")
            kind = "ridership_change" if change else "ridership_level"
            label = "Ridership change" if change else "Monthly boardings"
            subject = f"CARTA {mode.replace('_', ' ')}"
            evidence_id = f"ridership_{mode}_{'change' if change else 'level'}"
        phrase = (
            f"{subject}: {fact.value_num} {fact.unit}; measurement period "
            f"{fact.period.start} through {fact.period.end}; geography {fact.geography}"
        )
        evidence.append(
            Evidence(
                id=evidence_id,
                kind=kind,
                label=label,
                phrase=phrase,
                fact_id=fact.id,
                fact_version=fact.version,
                fact_key=fact.key,
                period_start=fact.period.start,
                period_end=fact.period.end,
                geography=fact.geography,
                value=str(fact.value_num),
                unit=fact.unit,
                method=fact.method,
                source_id=expected_source,
                retrieved=fact.sources[0].retrieved,
                valid_until=fact.valid_until,
                input_run_ids=fact.derived_from.get("input_run_ids", []),
            )
        )
    if len(evidence) > MAX_FACTS:
        raise ReportError("fact_bound_exceeded")
    present = {e.fact_key for e in evidence}
    for key in FACT_KEYS:
        if key not in present and not any(reason.startswith(key + ":") for reason in unavailable):
            unavailable.append(f"{key}: no current approved usable fact.")

    truncated_service = False
    if "carta-gtfs" in fresh:
        try:
            feed = active_feed(connection, "carta-gtfs")
        except NoActiveFeed:
            unavailable.append("Scheduled headways: no approved active feed.")
        else:
            day = period.start
            if not feed.feed_start <= day <= feed.feed_end:
                unavailable.append("Scheduled headways: service date outside the active feed period.")
            else:
                values = sorted(
                    headways(connection, feed, day),
                    key=lambda h: (h.route_id, h.direction_id if h.direction_id is not None else -1, h.band),
                )
                truncated_service = len(values) > MAX_SERVICE
                if not values:
                    unavailable.append(
                        "Scheduled headways: no supported departure gaps for the service date."
                    )
                for index, value in enumerate(values[:MAX_SERVICE]):
                    label = "Scheduled headway"
                    phrase = (
                        f"CARTA route {value.route_id}, direction {value.direction_id}, "
                        f"{BAND_LABELS[value.band]}: {value.minutes} minutes median "
                        "between first departures; "
                        f"{value.departures} distinct departures; service date {day} ({feed.timezone})"
                    )
                    evidence.append(
                        Evidence(
                            id=f"service_{chr(ord('a') + index)}",
                            kind="scheduled_headway",
                            label=label,
                            phrase=phrase,
                            period_start=day,
                            period_end=day,
                            geography="CARTA service area",
                            value=str(value.minutes),
                            unit="minutes between scheduled first departures",
                            method="headway.v1; median consecutive distinct first-departure gaps within band",
                            source_id=feed.source_id,
                            retrieved=feed.loaded_at.date(),
                            feed_version_id=feed.feed_version_id,
                            input_run_ids=[feed.fetch_run_id],
                            route_id=value.route_id,
                            direction_id=value.direction_id,
                            band=value.band,
                            departures=value.departures,
                        )
                    )
    alerts = []
    truncated_alerts = False
    if "carta-gtfs-rt-alerts" in fresh:
        rows = connection.execute(
            text(
                "SELECT source_id, alert_id, header_text, description_text, active_periods "
                "FROM tda.approved_service_alert WHERE source_id = 'carta-gtfs-rt-alerts' "
                "ORDER BY source_id, alert_id LIMIT :limit"
            ),
            {"limit": MAX_ALERTS + 1},
        ).all()
        truncated_alerts = len(rows) > MAX_ALERTS
        for row in rows[:MAX_ALERTS]:
            if _active(row.active_periods, now.timestamp()):
                alerts.append(
                    AlertEvidence(
                        source_id=row.source_id,
                        alert_id=plain(row.alert_id, 100),
                        untrusted_text="UNTRUSTED SOURCE DATA: "
                        + plain(f"{_plain(row.header_text) or ''} {_plain(row.description_text) or ''}"),
                    )
                )
    packet = Packet(
        period=period,
        generated_at=generated_at,
        evidence=evidence,
        sources=sources,
        alerts=alerts,
        unavailable=unavailable,
        truncated_service=truncated_service,
        truncated_alerts=truncated_alerts,
    )
    packet.packet_hash = packet_digest(packet)
    return packet
