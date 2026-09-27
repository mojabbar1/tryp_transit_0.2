"""Read API (P2 T8) against Postgres, running as tda_reader: health, sources, and approved-only facts."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from tda.api.app import create_app
from tda.facts.versions import FactDraft, approve_fact, write_fact
from tda.store.sources import upsert_source
from tests.conftest import DbUrls
from tests.support.factories import APPROVAL, make_source


@pytest.fixture
def reader_engine(db: DbUrls) -> Iterator[Engine]:
    engine = db.engine("reader")
    yield engine
    engine.dispose()


@pytest.fixture
def client(reader_engine: Engine) -> Iterator[TestClient]:
    with TestClient(create_app(engine=reader_engine)) as test_client:
        yield test_client


def _seed_sources(writer: Engine) -> None:
    with writer.begin() as connection:
        upsert_source(
            connection, make_source(id="live-src", cadence="0 * * * *", stale_after_hours=24, **APPROVAL)
        )
        upsert_source(
            connection, make_source(id="idle-src", cadence="0 * * * *", stale_after_hours=24, **APPROVAL)
        )
        upsert_source(connection, make_source(id="new-src"))
        connection.execute(
            text(
                "INSERT INTO tda.fetch_run (source_id, acquisition, status, finished_at) "
                "VALUES ('live-src', 'http', 'success', now() - interval '1 hour')"
            )
        )


def test_health_is_ok_when_nothing_approved_is_stale(client: TestClient, writer_engine: Engine) -> None:
    with writer_engine.begin() as connection:
        upsert_source(connection, make_source(id="new-src"))
    body = client.get("/v1/health").json()
    assert (body["status"], body["database"]) == ("ok", "ok")
    assert [(s["source_id"], s["status"], s["stale"]) for s in body["sources"]] == [
        ("new-src", "proposed", False)
    ]


def test_health_reports_per_source_freshness(client: TestClient, writer_engine: Engine) -> None:
    _seed_sources(writer_engine)
    body = client.get("/v1/health").json()
    assert body["status"] == "degraded"
    by_id = {s["source_id"]: s for s in body["sources"]}
    assert (by_id["live-src"]["stale"], by_id["live-src"]["last_status"]) == (False, "success")
    assert by_id["live-src"]["last_success"] is not None and by_id["live-src"]["cadence"] == "0 * * * *"
    assert (by_id["idle-src"]["stale"], by_id["idle-src"]["last_success"]) == (True, None)
    assert by_id["new-src"]["stale"] is False


def test_sources_lists_approved_ones_with_attribution(client: TestClient, writer_engine: Engine) -> None:
    _seed_sources(writer_engine)
    body = client.get("/v1/sources").json()
    assert [s["id"] for s in body] == ["idle-src", "live-src"]
    assert body[0]["attribution_text"] == APPROVAL["attribution_text"]
    assert set(body[0]) == {
        "id",
        "name",
        "kind",
        "url",
        "license",
        "terms_url",
        "attribution_text",
        "cadence",
    }


def _draft(key: str, value: Any, geography: str = "agency:ntd:40110") -> FactDraft:
    return FactDraft(
        key=key,
        created_by="connector",
        derived_from={"input_run_ids": []},
        value_num=value,
        geography=geography,
        source_ids=["live-src"],
    )


@pytest.fixture
def facts(writer_engine: Engine) -> dict[str, int]:
    """One fact in every status, plus a corrected key (v1 superseded by v2)."""
    _seed_sources(writer_engine)
    ids: dict[str, int] = {}
    with writer_engine.begin() as connection:
        ids["approved"] = write_fact(connection, _draft("carta.upt.bus", 224397), auto_publish=True)
        ids["candidate"] = write_fact(connection, _draft("carta.upt.candidate", 1))
        ids["rejected"] = write_fact(connection, _draft("carta.upt.rejected", 2))
        connection.execute(
            text(
                "UPDATE tda.fact SET status = 'rejected', reviewed_by = 'r', reviewed_at = :t WHERE id = :i"
            ),
            {"i": ids["rejected"], "t": datetime(2026, 9, 27, tzinfo=UTC)},
        )
        ids["needs_review"] = write_fact(connection, _draft("carta.upt.review", 3), auto_publish=True)
        connection.execute(
            text("UPDATE tda.fact SET status = 'needs_review' WHERE id = :i"), {"i": ids["needs_review"]}
        )
        ids["v1"] = write_fact(connection, _draft("carta.fare.base", 2), auto_publish=True)
        ids["v2"] = write_fact(connection, _draft("carta.fare.base", 2.5))
        approve_fact(connection, ids["v2"], "maintainer")
        ids["elsewhere"] = write_fact(
            connection, _draft("cartaXupt", 9, geography="city:x"), auto_publish=True
        )
    return ids


def test_facts_are_only_current_approved_versions(client: TestClient, facts: dict[str, int]) -> None:
    body = client.get("/v1/facts").json()
    returned = {item["id"] for item in body["items"]}
    assert returned == {facts["approved"], facts["v2"], facts["elsewhere"]}
    for hidden in ("candidate", "rejected", "needs_review", "v1"):
        assert facts[hidden] not in returned, hidden
    fare = next(item for item in body["items"] if item["id"] == facts["v2"])
    assert (fare["version"], fare["supersedes_id"], fare["value_num"], fare["status"]) == (
        2,
        facts["v1"],
        2.5,
        "approved",
    )
    upt = next(item for item in body["items"] if item["id"] == facts["approved"])
    assert upt["value_num"] == 224397
    assert upt["sources"] == [
        {"source_id": "live-src", "attribution": APPROVAL["attribution_text"], "retrieved": None}
    ], "no input runs in its lineage, so no retrieval date"
    assert upt["period"] == {"start": None, "end": None}


def test_facts_filter_by_key_prefix_and_geography(client: TestClient, facts: dict[str, int]) -> None:
    keys = {i["key"] for i in client.get("/v1/facts", params={"key_prefix": "carta."}).json()["items"]}
    assert keys == {"carta.upt.bus", "carta.fare.base"}, "the dot is literal, and cartaXupt doesn't match"
    underscore = client.get("/v1/facts", params={"key_prefix": "carta_"}).json()["items"]
    assert underscore == [], "_ is literal, not a LIKE wildcard"
    geo = client.get("/v1/facts", params={"geography": "city:x"}).json()["items"]
    assert [i["id"] for i in geo] == [facts["elsewhere"]]


def test_facts_paginate_with_an_opaque_cursor(client: TestClient, facts: dict[str, int]) -> None:
    seen: list[int] = []
    params: dict[str, Any] = {"limit": 1}
    for _ in range(5):
        page = client.get("/v1/facts", params=params).json()
        seen += [item["id"] for item in page["items"]]
        if page["next_cursor"] is None:
            break
        params["cursor"] = page["next_cursor"]
    assert seen == sorted({facts["approved"], facts["v2"], facts["elsewhere"]})
    assert client.get("/v1/facts", params={"cursor": "not-a-cursor!"}).status_code == 400
    assert client.get("/v1/facts", params={"limit": 501}).status_code == 422


def test_the_api_runs_as_the_reader_and_cannot_write(db: DbUrls, client: TestClient) -> None:
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with engine.connect() as connection:
        assert connection.execute(text("SELECT current_user")).scalar_one() == "tda_reader"
        with pytest.raises(DBAPIError, match="read-only transaction"):
            connection.execute(
                text(
                    "INSERT INTO tda.review_item (kind, ref_id, status, requested_by) "
                    "VALUES ('fact', '1', 'pending', 'x')"
                )
            )
    plain = db.engine("reader")
    with plain.connect() as connection, pytest.raises(DBAPIError, match="permission denied"):
        connection.execute(
            text(
                "INSERT INTO tda.fact (key, version, value_num, status, created_by) "
                "VALUES ('k', 1, 1, 'candidate', 'human')"
            )
        )
    plain.dispose()


def test_a_fact_reports_when_its_inputs_were_retrieved(client: TestClient, writer_engine: Engine) -> None:
    """Review finding F9: 02 §6.3 `sources[].retrieved`, from the reader-safe fact_source_retrieval view."""
    _seed_sources(writer_engine)
    with writer_engine.begin() as connection:
        runs = [
            connection.execute(
                text(
                    "INSERT INTO tda.fetch_run (source_id, acquisition, status, finished_at) "
                    "VALUES ('live-src', 'http', 'success', CAST(:t AS timestamptz)) RETURNING id"
                ),
                {"t": when},
            ).scalar_one()
            for when in ("2026-09-20T23:30:00Z", "2026-09-24T12:00:00Z")
        ]
        draft = FactDraft(
            key="carta.upt.dated",
            created_by="connector",
            derived_from={"input_run_ids": runs},
            value_num=1,
            source_ids=["live-src"],
        )
        fact = write_fact(connection, draft, auto_publish=True)
    item = next(i for i in client.get("/v1/facts").json()["items"] if i["id"] == fact)
    assert item["sources"][0]["retrieved"] == "2026-09-24", (
        "the newest input run from that source, as a UTC date"
    )
