"""Deterministic metrics (P4a): headways from GTFS and ridership from NTD, recorded in ``metric_value``.

Importing the package registers every metric definition in :data:`tda.metrics.registry.METRICS`, so a rollback
recomputes these metrics from the current views instead of withdrawing them (``rollback_run``).
"""

from tda.metrics import ridership, service
from tda.metrics.registry import METRICS

service.register(METRICS)
ridership.register(METRICS)
