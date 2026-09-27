"""Metric definitions, keyed by ``metric_key``: how to recompute one metric from the current views.

P2 ships the registry empty. Rollback uses it to recompute metrics that depended on a rolled-back run; a
metric with no definition is withdrawn instead (a NULL value is appended), so no number derived from
rolled-back data stays current.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import Connection


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
