"""``sources.yaml`` -> ``tda.source``: insert, update, disable what left; the catalog fits the schema."""

from __future__ import annotations

from sqlalchemy import Engine

from tda.config.models import SourceRegistry
from tda.config.registry import load_sources
from tda.store.sources import sync_sources
from tests.db.conftest import rows
from tests.support.factories import make_source


def _sync(engine: Engine, registry: SourceRegistry):
    with engine.begin() as connection:
        return sync_sources(connection, registry)


def test_sync_mirrors_the_registry_and_never_deletes(writer_engine: Engine) -> None:
    a, b = make_source(id="a-src"), make_source(id="b-src")
    report = _sync(writer_engine, SourceRegistry(sources=[a, b]))
    assert (report.inserted, report.updated, report.disabled) == (["a-src", "b-src"], [], [])
    report = _sync(writer_engine, SourceRegistry(sources=[a, b]))
    assert (report.inserted, report.updated, report.disabled) == ([], [], []), "a second sync is a no-op"
    renamed = make_source(id="a-src", name="Renamed")
    report = _sync(writer_engine, SourceRegistry(sources=[renamed]))
    assert (report.updated, report.disabled) == (["a-src"], ["b-src"])
    assert {tuple(r) for r in rows(writer_engine, "SELECT id, status FROM tda.source")} == {
        ("a-src", "proposed"),
        ("b-src", "disabled"),
    }


def test_the_whole_catalog_syncs_and_stays_proposed(writer_engine: Engine) -> None:
    registry = load_sources()
    report = _sync(writer_engine, registry)
    assert len(report.inserted) == len(registry.sources) > 0
    statuses = {r[0] for r in rows(writer_engine, "SELECT DISTINCT status FROM tda.source")}
    assert statuses == {"proposed"}
