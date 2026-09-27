"""Small builders shared by tests. Nothing here is a real source."""

from __future__ import annotations

from datetime import date
from typing import Any

from tda.config.models import Source

APPROVAL = {
    "status": "approved",
    "terms_reviewed_by": "test",
    "terms_reviewed_at": date(2026, 1, 1),
    "attribution_text": "Test data",
}


def make_source(**overrides: Any) -> Source:
    """A valid proposed ``rest`` source; pass ``**APPROVAL`` to approve it."""
    fields: dict[str, Any] = {
        "id": "test-src",
        "catalog_id": "S-999",
        "name": "Test source",
        "kind": "rest",
        "url": "https://data.example.test/feed.json",
        "store_policy": "ttl:30d",
        "store_policy_reason": "test fixture",
        "owner": "test",
    }
    fields.update(overrides)
    return Source.model_validate(fields)
