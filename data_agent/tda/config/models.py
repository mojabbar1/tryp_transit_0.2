"""Pydantic models for the region and source registries (the YAML files are the source of truth)."""

from __future__ import annotations

import re
from datetime import date
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.triggers.cron import CronTrigger
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

SLUG = r"^[a-z][a-z0-9-]*$"
STORE_POLICY = re.compile(r"^(none|indefinite|ttl:[1-9][0-9]*d)$")
SourceKind = Literal["gtfs", "gtfs_rt", "socrata", "census", "arcgis", "rest", "html", "pdf", "manual"]
SourceAuth = Literal["none", "free_key", "api_key", "agency", "registration", "paid"]
SourceStatus = Literal["proposed", "approved", "disabled"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BBox(_Strict):
    """WGS84 bounding box, longitude first (the order TomTom and ArcGIS use)."""

    min_lon: float = Field(ge=-180, le=180)
    min_lat: float = Field(ge=-90, le=90)
    max_lon: float = Field(ge=-180, le=180)
    max_lat: float = Field(ge=-90, le=90)

    @model_validator(mode="after")
    def _ordered(self) -> BBox:
        if self.min_lon >= self.max_lon or self.min_lat >= self.max_lat:
            raise ValueError("bbox minimums must be below its maximums")
        return self


class Agency(_Strict):
    id: str = Field(pattern=SLUG)
    name: str
    ntd_id: str | None = Field(default=None, pattern=r"^\d{4,5}$")


class ProbePoint(_Strict):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Corridor(_Strict):
    """A named corridor. Probe points are human-supplied before P3.6; a draft carries none."""

    id: str = Field(pattern=SLUG)
    name: str
    description: str
    probe_points: list[ProbePoint] = []
    status: Literal["draft", "ready"] = "draft"

    @model_validator(mode="after")
    def _ready_has_points(self) -> Corridor:
        if self.status == "ready" and not self.probe_points:
            raise ValueError(f"corridor {self.id}: status ready needs human-supplied probe_points")
        return self


class Region(_Strict):
    id: str = Field(pattern=SLUG)
    name: str
    timezone: str
    bbox: BBox
    agencies: list[Agency]
    corridors: list[Corridor] = []

    @field_validator("timezone")
    @classmethod
    def _known_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(f"unknown time zone {value!r}") from error
        return value


class Source(_Strict):
    """One entry of ``sources.yaml``: the `source` table columns (02 §6.1) plus the terms review (03 §2.4)."""

    id: str = Field(pattern=SLUG)
    catalog_id: str = Field(pattern=r"^S-\d+[a-z]?$")
    name: str
    kind: SourceKind
    url: HttpUrl | None = None
    auth: SourceAuth = "none"
    license: str | None = None
    terms_url: HttpUrl | None = None
    terms_summary: str | None = None
    robots_required: bool = False
    store_policy: str
    store_policy_reason: str
    cadence: str | None = None
    stale_after_hours: int | None = Field(default=None, gt=0)
    status: SourceStatus = "proposed"
    owner: str
    attribution_text: str | None = None
    allowed_hosts: list[str] = []
    rate_limit_per_min: int | None = Field(default=None, gt=0)
    terms_reviewed_by: str | None = None
    terms_reviewed_at: date | None = None
    notes: str | None = None

    @field_validator("store_policy")
    @classmethod
    def _store_policy(cls, value: str) -> str:
        if not STORE_POLICY.match(value):
            raise ValueError("store_policy must be none, indefinite, or ttl:<days>d")
        return value

    @field_validator("cadence")
    @classmethod
    def _cron(cls, value: str | None) -> str | None:
        if value is not None:
            CronTrigger.from_crontab(value, timezone="UTC")
            # APScheduler numbers Monday as 0 but crontab numbers Sunday as 0: a numeric weekday is ambiguous.
            if any(ch.isdigit() for ch in value.split()[4]):
                raise ValueError(
                    f"cadence {value!r}: write the day of the week as a name (mon, tue, ... sun)"
                )
        return value

    @model_validator(mode="after")
    def _policy_rules(self) -> Source:
        if self.kind in ("html", "pdf") and not self.robots_required:
            raise ValueError(f"source {self.id}: html and pdf sources require robots_required: true")
        if self.kind != "manual" and self.status == "approved" and self.url is None:
            raise ValueError(f"source {self.id}: an approved non-manual source needs a url")
        if self.status == "approved" and not (
            self.terms_reviewed_by and self.terms_reviewed_at and self.attribution_text
        ):
            raise ValueError(
                f"source {self.id}: approval needs a terms review (03 §2.4) and attribution_text"
            )
        if (self.cadence is None) != (self.stale_after_hours is None):
            raise ValueError(f"source {self.id}: cadence and stale_after_hours are set together")
        return self

    @property
    def ttl_days(self) -> int | None:
        """Retention in days for ``ttl:<N>d``; None for ``none`` and ``indefinite``."""
        return int(self.store_policy[4:-1]) if self.store_policy.startswith("ttl:") else None


class SourceRegistry(_Strict):
    sources: list[Source]

    @model_validator(mode="after")
    def _unique(self) -> SourceRegistry:
        ids = [source.id for source in self.sources]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate source ids: {', '.join(duplicates)}")
        return self

    def get(self, source_id: str) -> Source:
        """The source with this id, or KeyError."""
        for source in self.sources:
            if source.id == source_id:
                return source
        raise KeyError(source_id)
