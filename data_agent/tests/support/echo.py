"""``EchoConnector``: a test-only connector with an in-memory payload (never registered, never networked)."""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from sqlalchemy import Connection

from tda.connectors.base import Connector, FetchResult, LoadStats, PriorRun, Row, ValidationFailed
from tda.http.polite_client import NotModified, RequestBudget
from tda.store.observations import insert_observations

ECHO_TABLE = "echo_obs"
ECHO_COLUMNS = ["name text NOT NULL", "value text"]


class EchoConnector(Connector):
    """Loads ``{"items": [{"name": ..., "value": ...}]}`` into ``tda.echo_obs``."""

    source_id = "echo"
    owned_tables = (ECHO_TABLE,)

    def __init__(self, *args: Any, payload: Any = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.payload = payload if payload is not None else {"items": [{"name": "a", "value": "1"}]}
        self.fetches: list[PriorRun | None] = []
        self.fail_with: Exception | None = None
        self.not_modified = False
        self.budget: RequestBudget | None = None
        self.fail_load_after: int | None = None

    def request_budget(self) -> RequestBudget | None:
        return self.budget

    def fetch(self, prior: PriorRun | None, budget: RequestBudget | None) -> FetchResult | NotModified:
        self.fetches.append(prior)
        if budget is not None:
            budget.spend()
        if self.fail_with is not None:
            raise self.fail_with
        if self.not_modified:
            return NotModified("https://echo.test/feed", '"e1"', None)
        body = self.payload if isinstance(self.payload, bytes) else json.dumps(self.payload).encode()
        return FetchResult(body, "json", http_status=200, etag='"e1"')

    def normalize(self, raw: bytes) -> Iterable[Row]:
        items = json.loads(raw).get("items")
        if not isinstance(items, list) or not items:
            raise ValidationFailed("items must be a non-empty list")
        for item in items:
            if not isinstance(item.get("name"), str):
                raise ValidationFailed(f"item without a name: {item!r}")
            yield {"name": item["name"], "value": item.get("value")}

    def load(self, connection: Connection, rows: list[Row], run_id: int) -> LoadStats:
        if self.fail_load_after is not None:
            insert_observations(connection, ECHO_TABLE, rows[: self.fail_load_after], run_id)
            raise RuntimeError("load failed halfway")
        return LoadStats({ECHO_TABLE: insert_observations(connection, ECHO_TABLE, rows, run_id)})
