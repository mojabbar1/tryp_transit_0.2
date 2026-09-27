"""Connector base (P2 T6): fetch, land, normalize, load; one ``fetch_run`` row per attempt.

- A source that isn't ``approved`` is ``skipped_disabled``, always, and nothing is fetched.
- ``live`` is the only switch that lets a connector reach the network. Without it an approved source is not
  fetched and no run is recorded, so dev and CI can't call out by accident.
- The same sha256 as the last successful run means ``not_modified``: nothing is loaded.
- A failed validation marks the run ``failed``. The load and the ``success`` update commit in one transaction,
  so there are no partial loads.
- Rollback (:func:`rollback_run`) works by status and never deletes anything.

Lineage convention (shared with retention): a fact lists every run it depends on, transitively, in
``derived_from.input_run_ids``; a metric lists them in ``metric_value.input_run_ids``.
"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar, Literal

import structlog
import yaml
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import DBAPIError

from tda.config.models import Source
from tda.config.settings import Settings, get_settings
from tda.http.polite_client import (
    BudgetExceeded,
    FetchResponse,
    NotModified,
    PoliteClient,
    RequestBudget,
    RobotsDisallowed,
)
from tda.metrics.registry import METRICS, MetricRegistry, MetricResult, record_metric
from tda.store.lineage import key_lock
from tda.store.observations import sql_ident
from tda.store.raw_store import RawStore
from tda.store.sources import upsert_source

log = structlog.get_logger(__name__)

Row = Mapping[str, Any]
Acquisition = Literal["http", "manual"]
ERROR_MAX = 500
ROLLBACK_ATTEMPTS = 3
RETRYABLE_SQLSTATES = ("40P01", "40001")  # deadlock_detected, serialization_failure


class ValidationFailed(Exception):
    """A data-quality check failed; the run is ``failed`` and nothing is loaded."""


class RollbackRefused(Exception):
    """The run can't be rolled back (it isn't a ``success`` run)."""


@dataclass(frozen=True)
class FetchResult:
    """A fetched (or supplied) raw body and what the server said about it."""

    body: bytes
    ext: str
    http_status: int | None = None
    etag: str | None = None
    last_modified: str | None = None

    @classmethod
    def from_response(cls, response: FetchResponse, ext: str) -> FetchResult:
        """Wrap a polite-client response."""
        return cls(response.body, ext, response.status, response.etag, response.last_modified)


@dataclass(frozen=True)
class PriorRun:
    """The source's latest ``success`` run: its checksum and HTTP validators."""

    id: int
    sha256: str | None
    etag: str | None
    last_modified: str | None


@dataclass(frozen=True)
class LoadStats:
    """Rows inserted per table."""

    rows: dict[str, int] = field(default_factory=dict)

    @property
    def total(self) -> int:
        """All rows inserted."""
        return sum(self.rows.values())


@dataclass(frozen=True)
class RunOutcome:
    """How one ``run`` ended. ``status`` is a ``fetch_run`` status, or ``not_live`` (nothing recorded)."""

    source_id: str
    status: str
    run_id: int | None
    rows_loaded: int = 0
    message: str | None = None


class ManualMeta(BaseModel):
    """The required ``<file>.meta.yaml`` sidecar for a human-supplied file (03 §3)."""

    model_config = ConfigDict(extra="forbid")

    supplied_by: str = Field(min_length=1)
    original_url: HttpUrl | None = None
    notes: str | None = None

    @classmethod
    def for_file(cls, path: Path) -> ManualMeta:
        """Read and validate the sidecar next to ``path``; a missing sidecar is an error."""
        sidecar = path.with_name(f"{path.name}.meta.yaml")
        if not sidecar.is_file():
            raise FileNotFoundError(f"{path.name} needs a sidecar {sidecar.name} (supplied_by, original_url)")
        return cls.model_validate(yaml.safe_load(sidecar.read_text(encoding="utf-8")) or {})


def _describe(error: BaseException) -> str:
    return f"{type(error).__name__}: {error}"[:ERROR_MAX]


def skip_disabled(engine: Engine, source: Source, meta: ManualMeta | None = None) -> RunOutcome:
    """Record a ``skipped_disabled`` run for a source that isn't approved. No network, no file is read."""
    with engine.begin() as connection:
        upsert_source(connection, source)
        run_id = connection.execute(
            text(
                "INSERT INTO tda.fetch_run (source_id, acquisition, supplied_by, original_url, status, "
                "finished_at, error) VALUES (:s, :a, :by, :url, 'skipped_disabled', now(), :e) RETURNING id"
            ),
            {
                "s": source.id,
                "a": "manual" if meta else "http",
                "by": meta.supplied_by if meta else None,
                "url": str(meta.original_url) if meta and meta.original_url else None,
                "e": f"source status is {source.status}; only approved sources run",
            },
        ).scalar_one()
    log.info("ingest.skipped_disabled", source=source.id, run_id=run_id, status=source.status)
    return RunOutcome(source.id, "skipped_disabled", run_id, message=f"source is {source.status}")


class Connector(ABC):
    """Subclass per source (P3): set ``source_id`` and ``owned_tables``; implement fetch, normalize, load."""

    source_id: ClassVar[str]
    owned_tables: ClassVar[tuple[str, ...]] = ()

    def __init__(
        self,
        source: Source,
        *,
        engine: Engine,
        store: RawStore,
        client: PoliteClient | None = None,
        settings: Settings | None = None,
        metrics: MetricRegistry = METRICS,
    ) -> None:
        if source.id != self.source_id:
            raise ValueError(f"{type(self).__name__} is for {self.source_id}, not {source.id}")
        self.source = source
        self.engine = engine
        self.store = store
        self.client = client
        self.settings = settings or get_settings()
        self.metrics = metrics

    @abstractmethod
    def fetch(self, prior: PriorRun | None, budget: RequestBudget | None) -> FetchResult | NotModified:
        """Get the raw body, conditionally on ``prior``'s validators (see :meth:`http_get`)."""

    @abstractmethod
    def normalize(self, raw: bytes) -> Iterable[Row]:
        """Parse and validate the raw body into rows; raise :class:`ValidationFailed` on bad data."""

    @abstractmethod
    def load(self, connection: Connection, rows: list[Row], run_id: int) -> LoadStats:
        """Append the rows for ``run_id`` (see ``insert_observations``); runs inside the run's transaction."""

    def request_budget(self) -> RequestBudget | None:
        """A per-run request budget; None means unlimited (only rate limits apply)."""
        return None

    def http_get(
        self, prior: PriorRun | None, budget: RequestBudget | None, *, ext: str, url: str | None = None
    ) -> FetchResult | NotModified:
        """The usual ``fetch``: a polite conditional GET of the source URL (or ``url``)."""
        if self.client is None:
            raise RuntimeError("a live run needs the polite client")
        response = self.client.fetch(
            self.source,
            url,
            etag=prior.etag if prior else None,
            last_modified=prior.last_modified if prior else None,
            budget=budget,
        )
        return response if isinstance(response, NotModified) else FetchResult.from_response(response, ext)

    def run(self, *, live: bool) -> RunOutcome:
        """One scheduled or CLI run: skipped unless approved, and not fetched unless ``live``."""
        if self.source.status != "approved":
            return skip_disabled(self.engine, self.source)
        if not live:
            return RunOutcome(self.source.id, "not_live", None, message="approved; pass --live to fetch")
        prior = self._prior()
        run_id = self._start("http")
        try:
            fetched = self.fetch(prior, self.request_budget())
        except RobotsDisallowed as error:
            return self._finish(run_id, "skipped_robots", error=_describe(error))
        except BudgetExceeded as error:
            return self._finish(run_id, "skipped_budget", error=_describe(error))
        except Exception as error:
            return self._finish(run_id, "failed", error=_describe(error))
        if isinstance(fetched, NotModified):
            if prior is None:
                return self._finish(
                    run_id,
                    "failed",
                    http_status=304,
                    error="304 Not Modified, but no usable prior success run",
                )
            return self._confirm(
                run_id,
                prior,
                http_status=304,
                etag=fetched.etag or prior.etag,
                last_modified=fetched.last_modified or prior.last_modified,
                sha256=prior.sha256,
            )
        return self._land(run_id, fetched, prior)

    def run_manual(self, path: Path) -> RunOutcome:
        """Ingest a human-supplied file with its ``.meta.yaml`` sidecar (``acquisition = manual``)."""
        meta = ManualMeta.for_file(path)
        if self.source.status != "approved":
            return skip_disabled(self.engine, self.source, meta)
        size = path.stat().st_size
        limit = self.settings.max_response_mb * 1024 * 1024
        prior = self._prior()
        run_id = self._start("manual", meta)
        if size > limit:
            return self._finish(run_id, "failed", error=f"{path.name} is {size} bytes (cap {limit})")
        ext = path.suffix.lstrip(".").lower() or "bin"
        return self._land(run_id, FetchResult(path.read_bytes(), ext), prior)

    def rollback(self, run_id: int, *, dry_run: bool) -> RollbackPlan:
        """Roll back one of this source's runs (see :func:`rollback_run`)."""
        return rollback_run(
            self.engine,
            run_id,
            owned_tables=self.owned_tables,
            dry_run=dry_run,
            metrics=self.metrics,
            source_id=self.source.id,
        )

    def _prior(self) -> PriorRun | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT id, sha256, etag, last_modified FROM tda.fetch_run "
                    "WHERE source_id = :s AND status = 'success' ORDER BY finished_at DESC, id DESC LIMIT 1"
                ),
                {"s": self.source.id},
            ).one_or_none()
        return PriorRun(*row) if row else None

    def _start(self, acquisition: Acquisition, meta: ManualMeta | None = None) -> int:
        with self.engine.begin() as connection:
            upsert_source(connection, self.source)
            return connection.execute(
                text(
                    "INSERT INTO tda.fetch_run (source_id, acquisition, supplied_by, original_url, status) "
                    "VALUES (:s, :a, :by, :url, 'running') RETURNING id"
                ),
                {
                    "s": self.source.id,
                    "a": acquisition,
                    "by": meta.supplied_by if meta else None,
                    "url": str(meta.original_url) if meta and meta.original_url else None,
                },
            ).scalar_one()

    def _land(self, run_id: int, fetched: FetchResult, prior: PriorRun | None) -> RunOutcome:
        digest = hashlib.sha256(fetched.body).hexdigest()
        facts: dict[str, Any] = {
            "http_status": fetched.http_status,
            "bytes": len(fetched.body),
            "sha256": digest,
            "etag": fetched.etag,
            "last_modified": fetched.last_modified,
        }
        if prior is not None and prior.sha256 == digest:
            return self._confirm(run_id, prior, message=f"same sha256 as run {prior.id}", **facts)
        try:
            facts["raw_uri"] = self.store.put(self.source, run_id, fetched.body, fetched.ext).uri
            rows = list(self.normalize(fetched.body))
        except Exception as error:
            return self._finish(run_id, "failed", error=_describe(error), **facts)
        try:
            with self.engine.begin() as connection:
                stats = self.load(connection, rows, run_id)
                self._update(connection, run_id, "success", **facts)
        except Exception as error:
            return self._finish(run_id, "failed", error=_describe(error), **facts)
        log.info("ingest.success", source=self.source.id, run_id=run_id, rows=stats.rows)
        return RunOutcome(self.source.id, "success", run_id, stats.total)

    def _confirm(
        self, run_id: int, prior: PriorRun, *, message: str | None = None, **fields: Any
    ) -> RunOutcome:
        """Finish ``not_modified`` confirming ``prior``, or ``failed`` if it was rolled back meanwhile."""
        try:
            return self._finish(run_id, "not_modified", message=message, validates_run_id=prior.id, **fields)
        except DBAPIError as error:
            if "must confirm a success run" not in str(error.orig):
                raise
            reason = f"run {prior.id}, which this run would confirm, is no longer a success"
            return self._finish(run_id, "failed", error=reason, **fields)

    def _finish(self, run_id: int, status: str, *, message: str | None = None, **fields: Any) -> RunOutcome:
        with self.engine.begin() as connection:
            self._update(connection, run_id, status, **fields)
        log.info(f"ingest.{status}", source=self.source.id, run_id=run_id, error=fields.get("error"))
        return RunOutcome(self.source.id, status, run_id, message=message or fields.get("error"))

    @staticmethod
    def _update(connection: Connection, run_id: int, status: str, **fields: Any) -> None:
        allowed = {
            "http_status",
            "bytes",
            "sha256",
            "raw_uri",
            "error",
            "etag",
            "last_modified",
            "validates_run_id",
        }
        unknown = set(fields) - allowed
        if unknown:
            raise ValueError(f"unknown fetch_run fields: {sorted(unknown)}")
        assignments = "".join(f", {name} = :{name}" for name in sorted(fields))
        updated = connection.execute(
            text(
                f"UPDATE tda.fetch_run SET status = :status, finished_at = now(){assignments} "  # noqa: S608
                "WHERE id = :id AND status = 'running'"
            ),
            {"id": run_id, "status": status, **fields},
        ).rowcount
        if updated != 1:
            raise RuntimeError(f"fetch_run {run_id} is not running")


@dataclass(frozen=True)
class MetricChange:
    """A current metric that depended on the rolled-back run."""

    metric_key: str
    dims: dict[str, Any]
    old_value: Any
    action: Literal["recompute", "withdraw"]
    new_value: Any = None


@dataclass(frozen=True)
class FactRef:
    """One fact version, by id."""

    id: int
    key: str
    version: int


@dataclass
class RollbackPlan:
    """What a rollback changes (dry run) or changed (confirmed). Nothing is ever deleted."""

    run_id: int
    source_id: str
    raw_uri: str | None
    observations: dict[str, int]
    metrics: list[MetricChange]
    facts_to_review: list[FactRef]
    candidate_facts: list[FactRef]
    applied: bool = False

    def lines(self) -> list[str]:
        """A human-readable summary for the CLI."""
        verb = "rolled back" if self.applied else "would roll back"
        out = [f"run {self.run_id} ({self.source_id}): {verb}; success -> rolled_back"]
        if not self.observations:
            out.append("  observation tables: none declared (no connector registered for this source)")
        for table, count in self.observations.items():
            out.append(f"  tda.{table}: {count} row(s) leave current_{table} (kept, not deleted)")
        for change in self.metrics:
            after = change.new_value if change.action == "recompute" else "NULL (withdrawn)"
            shown = after if self.applied or change.action == "withdraw" else "(recomputed on confirm)"
            out.append(
                f"  metric {change.metric_key} {json.dumps(change.dims)}: {change.old_value} -> {shown}"
            )
        for fact in self.facts_to_review:
            out.append(f"  fact {fact.key} v{fact.version} (#{fact.id}): approved -> needs_review")
        for fact in self.candidate_facts:
            out.append(f"  note: candidate fact {fact.key} v{fact.version} (#{fact.id}) cites this run")
        out.append(f"  raw snapshot kept: {self.raw_uri or '(none stored)'}")
        return out


def rollback_run(
    engine: Engine,
    run_id: int,
    *,
    owned_tables: Iterable[str],
    dry_run: bool,
    metrics: MetricRegistry = METRICS,
    source_id: str | None = None,
) -> RollbackPlan:
    """Roll back a ``success`` run by status (02 §7.4, REV-07), in one transaction.

    1. The run becomes ``rolled_back``; its observation rows stay, and the ``current_*`` views drop them.
    2. Current metrics that used the run are recomputed from the current views through the registry, or
       withdrawn (a NULL value is appended) when the metric has no definition.
    3. Approved facts that cite the run become ``needs_review``.
    4. The raw snapshot is kept.
    With ``dry_run``, nothing changes and the plan says what would.

    Rollbacks are serialized by a global transaction lock taken before any run lock, so two rollbacks whose
    recomputations share inputs can't deadlock. A deadlock or serialization failure from anything else
    retries the whole transaction (at most 3 attempts); nothing is applied by an aborted attempt.
    """
    tables = [sql_ident(t) for t in owned_tables]
    for attempt in range(1, ROLLBACK_ATTEMPTS + 1):
        try:
            return _rollback_once(engine, run_id, tables, dry_run, metrics, source_id)
        except DBAPIError as error:
            sqlstate = getattr(error.orig, "sqlstate", None)
            if sqlstate not in RETRYABLE_SQLSTATES or attempt == ROLLBACK_ATTEMPTS:
                raise
            log.warning("runs.rollback_retry", run_id=run_id, attempt=attempt, sqlstate=sqlstate)
    raise AssertionError("unreachable")


def _rollback_once(
    engine: Engine,
    run_id: int,
    tables: list[str],
    dry_run: bool,
    metrics: MetricRegistry,
    source_id: str | None,
) -> RollbackPlan:
    with engine.begin() as connection:
        key_lock(connection, "rollback", "all")
        run = connection.execute(
            text("SELECT id, source_id, status, raw_uri FROM tda.fetch_run WHERE id = :id FOR UPDATE"),
            {"id": run_id},
        ).one_or_none()
        if run is None:
            raise LookupError(f"no fetch_run {run_id}")
        if source_id is not None and run.source_id != source_id:
            raise RollbackRefused(f"run {run_id} belongs to {run.source_id}, not {source_id}")
        if run.status != "success":
            raise RollbackRefused(f"run {run_id} is {run.status}; only a success run can be rolled back")
        observations = {
            table: connection.execute(
                text(f"SELECT count(*) FROM tda.{table} WHERE fetch_run_id = :id"),  # noqa: S608
                {"id": run_id},
            ).scalar_one()
            for table in tables
        }
        affected = connection.execute(
            text(
                "SELECT metric_key, dims, value, unit FROM tda.current_metric_value "
                "WHERE input_run_ids @> ARRAY[CAST(:id AS bigint)] ORDER BY metric_key, dims::text"
            ),
            {"id": run_id},
        ).all()
        cited = connection.execute(
            text(
                "SELECT id, key, version, status FROM tda.fact "
                "WHERE status IN ('approved', 'candidate') "
                "AND derived_from -> 'input_run_ids' @> to_jsonb(CAST(:id AS bigint)) ORDER BY id"
            ),
            {"id": run_id},
        ).all()
        plan = RollbackPlan(
            run_id=run_id,
            source_id=run.source_id,
            raw_uri=run.raw_uri,
            observations=observations,
            metrics=[
                MetricChange(
                    m.metric_key, m.dims, m.value, "recompute" if metrics.get(m.metric_key) else "withdraw"
                )
                for m in affected
            ],
            facts_to_review=[FactRef(f.id, f.key, f.version) for f in cited if f.status == "approved"],
            candidate_facts=[FactRef(f.id, f.key, f.version) for f in cited if f.status == "candidate"],
        )
        if dry_run:
            return plan
        connection.execute(
            text("UPDATE tda.fetch_run SET status = 'rolled_back' WHERE id = :id"), {"id": run_id}
        )
        plan.metrics = [
            _redo_metric(connection, metrics, change, m.unit, run_id)
            for change, m in zip(plan.metrics, affected, strict=True)
        ]
        if plan.facts_to_review:
            # Re-checked after any lock wait: a version superseded meanwhile is no longer flagged.
            flagged = set(
                connection.execute(
                    text(
                        "UPDATE tda.fact SET status = 'needs_review' "
                        "WHERE id = ANY(:ids) AND status = 'approved' RETURNING id"
                    ),
                    {"ids": [f.id for f in plan.facts_to_review]},
                ).scalars()
            )
            plan.facts_to_review = [f for f in plan.facts_to_review if f.id in flagged]
        plan.applied = True
    log.info("runs.rolled_back", run_id=run_id, source=plan.source_id, facts=len(plan.facts_to_review))
    return plan


def _redo_metric(
    connection: Connection, metrics: MetricRegistry, change: MetricChange, unit: str | None, run_id: int
) -> MetricChange:
    definition = metrics.get(change.metric_key)
    if definition is None:
        result, method = MetricResult(None, [], unit), "withdrawn"
    else:
        result, method = definition.compute(connection, change.dims), definition.method_version
        if run_id in result.input_run_ids:
            raise RuntimeError(f"metric {change.metric_key} still read rolled-back run {run_id}")
    record_metric(connection, change.metric_key, change.dims, result, method)
    return MetricChange(change.metric_key, change.dims, change.old_value, change.action, result.value)
