"""Snapshots cited by published facts survive retention (02 §7.4); candidates don't protect anything."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import text

from tda.store.raw_store import RawStore
from tda.store.retention import apply_retention, protected_snapshots
from tests.conftest import DbUrls
from tests.support.factories import make_source

NOW = datetime(2026, 9, 27, 12, tzinfo=UTC)


def test_published_facts_protect_their_input_snapshots(db: DbUrls, tmp_path: Path) -> None:
    source = make_source()
    old = RawStore(tmp_path, clock=lambda: NOW - timedelta(days=90))
    engine = db.engine("writer")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO tda.source (id, name, kind, auth, robots_required, store_policy, status, owner) "
                "VALUES ('test-src', 'Test', 'rest', 'none', false, 'ttl:30d', 'approved', 'test')"
            )
        )
        uris = {}
        for status in ("approved", "needs_review", "superseded", "candidate", "rejected", None):
            run = connection.execute(
                text(
                    "INSERT INTO tda.fetch_run (source_id, acquisition, status, finished_at) "
                    "VALUES ('test-src', 'http', 'running', NULL) RETURNING id"
                )
            ).scalar_one()
            ref = old.put(source, run, status.encode() if status else b"orphan", "json")
            connection.execute(
                text(
                    "UPDATE tda.fetch_run SET status = 'success', finished_at = now(), sha256 = :h, "
                    "raw_uri = :u WHERE id = :i"
                ),
                {"h": ref.sha256, "u": ref.uri, "i": run},
            )
            uris[status] = ref.uri
            if status:
                reviewed = status in ("approved", "rejected")
                connection.execute(
                    text(
                        "INSERT INTO tda.fact (key, version, value_num, status, created_by, derived_from, "
                        "reviewed_by, reviewed_at) "
                        "VALUES (:k, 1, 1, :s, 'connector', CAST(:d AS jsonb), :rb, :ra)"
                    ),
                    {
                        "k": f"test.{status}",
                        "s": status,
                        "d": json.dumps({"input_run_ids": [run]}),
                        "rb": "r" if reviewed else None,
                        "ra": NOW if reviewed else None,
                    },
                )
    with engine.connect() as connection:
        assert protected_snapshots(connection, "test-src") == {
            uris["approved"],
            uris["needs_review"],
            uris["superseded"],
        }
        report = apply_retention(connection, RawStore(tmp_path, clock=lambda: NOW), source)
    engine.dispose()
    assert sorted(report.deleted) == sorted([uris["candidate"], uris["rejected"], uris[None]])
    assert len(report.protected) == 3


def test_evidence_of_a_once_published_fact_survives_its_rejection(db: DbUrls, tmp_path: Path) -> None:
    """Review finding F4: approved -> needs_review -> rejected keeps the snapshot; never-published doesn't."""
    source = make_source()
    old = RawStore(tmp_path, clock=lambda: NOW - timedelta(days=90))
    engine = db.engine("writer")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO tda.source (id, name, kind, auth, robots_required, store_policy, status, owner) "
                "VALUES ('test-src', 'Test', 'rest', 'none', false, 'ttl:30d', 'approved', 'test')"
            )
        )
        uris, facts = {}, {}
        for name in ("published", "never"):
            run = connection.execute(
                text(
                    "INSERT INTO tda.fetch_run (source_id, acquisition, status) "
                    "VALUES ('test-src', 'http', 'running') RETURNING id"
                )
            ).scalar_one()
            ref = old.put(source, run, name.encode(), "json")
            connection.execute(
                text(
                    "UPDATE tda.fetch_run SET status = 'success', finished_at = now(), sha256 = :h, "
                    "raw_uri = :u WHERE id = :i"
                ),
                {"h": ref.sha256, "u": ref.uri, "i": run},
            )
            uris[name] = ref.uri
            facts[name] = connection.execute(
                text(
                    "INSERT INTO tda.fact (key, version, value_num, status, created_by, derived_from) "
                    "VALUES (:k, 1, 1, 'candidate', 'connector', CAST(:d AS jsonb)) RETURNING id"
                ),
                {"k": f"test.{name}", "d": json.dumps({"input_run_ids": [run]})},
            ).scalar_one()
        approve = "UPDATE tda.fact SET status = :s, reviewed_by = 'r', reviewed_at = now() WHERE id = :i"
        connection.execute(text(approve), {"s": "approved", "i": facts["published"]})
        connection.execute(
            text("UPDATE tda.fact SET status = 'needs_review' WHERE id = :i"), {"i": facts["published"]}
        )
        for name in ("published", "never"):
            connection.execute(text(approve), {"s": "rejected", "i": facts[name]})
    with engine.connect() as connection:
        assert protected_snapshots(connection, "test-src") == {uris["published"]}
        report = apply_retention(connection, RawStore(tmp_path, clock=lambda: NOW), source)
    engine.dispose()
    assert (report.deleted, report.protected) == ([uris["never"]], [uris["published"]])
