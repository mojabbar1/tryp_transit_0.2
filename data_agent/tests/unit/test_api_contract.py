"""The committed OpenAPI snapshot matches the code, and health degrades cleanly without a database."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from tda.api.app import create_app
from tda.api.openapi import render, snapshot_path


def test_the_committed_openapi_snapshot_is_current() -> None:
    assert snapshot_path().read_text(encoding="utf-8") == render(), (
        "run `uv run tda api openapi` and commit it"
    )


def test_health_is_503_when_the_database_is_unreachable() -> None:
    engine = create_engine(
        "postgresql+psycopg://tda_reader@127.0.0.1:9/nowhere", connect_args={"connect_timeout": 2}
    )
    with TestClient(create_app(engine=engine)) as client:
        response = client.get("/v1/health")
    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "database": "unreachable",
        "version": "0.1.0",
        "sources": [],
    }
