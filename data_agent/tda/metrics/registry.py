"""Metric definitions, keyed by ``metric_key``: how to recompute one metric from the current views.

P2 ships the registry empty. Rollback uses it to recompute metrics that depended on a rolled-back run; a
metric with no definition is withdrawn instead (a NULL value is appended), so no number derived from
rolled-back data stays current.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import Connection, text

from tda.store.lineage import lock_input_runs


@dataclass(frozen=True)
class MetricResult:
    """One recomputed value and the runs it was computed from (its lineage)."""

    value: Decimal | None
    input_run_ids: list[int]
    unit: str | None = None


@dataclass(frozen=True)
class MetricDefinition:
    """``compute(connection, dims)`` reads only ``current_*`` views and returns the metric for ``dims``."""

    key: str
    method_version: str
    compute: Callable[[Connection, Mapping[str, Any]], MetricResult]


@dataclass
class MetricRegistry:
    """A name -> definition map; one module-level instance, :data:`METRICS`."""

    definitions: dict[str, MetricDefinition] = field(default_factory=dict)

    def register(self, definition: MetricDefinition) -> MetricDefinition:
        """Add a definition; a key can be registered once."""
        if definition.key in self.definitions:
            raise ValueError(f"metric {definition.key} is already registered")
        self.definitions[definition.key] = definition
        return definition

    def get(self, key: str) -> MetricDefinition | None:
        """The definition for ``key``, if any."""
        return self.definitions.get(key)


METRICS = MetricRegistry()


def record_metric(
    connection: Connection,
    key: str,
    dims: Mapping[str, Any],
    result: MetricResult,
    method_version: str,
) -> int:
    """Append one metric value. Its input runs are locked and must all be ``success`` (see lineage)."""
    lock_input_runs(connection, result.input_run_ids)
    return connection.execute(
        text(
            "INSERT INTO tda.metric_value (metric_key, dims, value, unit, method_version, input_run_ids) "
            "VALUES (:k, CAST(:d AS jsonb), :v, :u, :m, :i) RETURNING id"
        ),
        {
            "k": key,
            "d": json.dumps(dict(dims), sort_keys=True),
            "v": result.value,
            "u": result.unit,
            "m": method_version,
            "i": sorted(set(result.input_run_ids)),
        },
    ).scalar_one()


def record_changes(
    connection: Connection,
    desired: Mapping[tuple[str, str], MetricResult],
    current: Mapping[tuple[str, str], Any],
    method_version: str,
) -> int:
    """Append each desired result whose value, unit, or lineage differs from the current one; count them.

    Keys are (metric key, dims as sorted JSON), and ``current`` holds ``current_metric_value`` rows. The
    caller gives each current key it no longer computes a NULL (withdrawn) result that cites the runs it now
    depends on. So an already-withdrawn value's lineage stays current too, and rolling back the run that
    keeps it uncomputable finds it.
    """
    written = 0
    for (key, dims), result in sorted(desired.items(), key=lambda item: item[0]):
        row = current.get((key, dims))
        wanted = (result.value, result.unit, sorted(set(result.input_run_ids)))
        if row is None or (row.value, row.unit, sorted(row.input_run_ids)) != wanted:
            record_metric(connection, key, json.loads(dims), result, method_version)
            written += 1
    return written
