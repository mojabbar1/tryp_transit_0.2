"""Deterministic metrics (P4a), recorded in ``metric_value``.

Importing the package registers every metric definition in :data:`tda.metrics.registry.METRICS`, so a rollback
recomputes these metrics from the current views instead of withdrawing them (``rollback_run``).
"""

from tda.metrics import service
from tda.metrics.registry import METRICS

service.register(METRICS)
