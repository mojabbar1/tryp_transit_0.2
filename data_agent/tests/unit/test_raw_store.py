"""Raw store layout, the ``none`` policy, and TTL retention (P2 T4)."""

from __future__ import annotations

import hashlib
import io
import stat
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from tda.store.raw_store import RawStore
from tests.support.factories import make_source

NOW = datetime(2026, 9, 27, 23, 30, tzinfo=UTC)


def _store(tmp_path: Path, at: datetime = NOW) -> RawStore:
    return RawStore(tmp_path / "raw", clock=lambda: at)


def test_put_lands_at_the_dated_layout_read_only(tmp_path: Path) -> None:
    ref = _store(tmp_path).put(make_source(), 42, b"hello", "json")
    assert ref.uri == "raw://test-src/2026/09/27/42.json"
    assert ref.sha256 == hashlib.sha256(b"hello").hexdigest()
    assert ref.size == 5
    path = tmp_path / "raw/test-src/2026/09/27/42.json"
    assert path.read_bytes() == b"hello"
    assert not path.stat().st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
    assert _store(tmp_path).path(ref.uri) == path
    assert [p.name for p in path.parent.iterdir()] == ["42.json"]


def test_the_date_is_utc(tmp_path: Path) -> None:
    # 21:00 in Charleston on the 27th is already the 28th in UTC.
    local = datetime(2026, 9, 27, 21, 0, tzinfo=ZoneInfo("America/New_York"))
    ref = _store(tmp_path, local).put(make_source(), 1, b"x", "bin")
    assert ref.uri == "raw://test-src/2026/09/28/1.bin"


@pytest.mark.parametrize(
    "content",
    [b"abcdef", bytearray(b"abcdef"), io.BytesIO(b"abcdef"), iter([b"ab", b"cd", b"ef"])],
    ids=["bytes", "bytearray", "file", "chunks"],
)
def test_put_streams_any_content(tmp_path: Path, content: object) -> None:
    ref = _store(tmp_path).put(make_source(), 7, content, "bin")  # type: ignore[arg-type]
    assert (ref.sha256, ref.size) == (hashlib.sha256(b"abcdef").hexdigest(), 6)


def test_policy_none_keeps_only_the_checksum(tmp_path: Path) -> None:
    ref = _store(tmp_path).put(make_source(store_policy="none"), 3, iter([b"secret ", b"body"]), "html")
    assert ref.uri is None
    assert (ref.sha256, ref.size) == (hashlib.sha256(b"secret body").hexdigest(), 11)
    assert not (tmp_path / "raw").exists()


def test_snapshots_are_never_overwritten(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.put(make_source(), 5, b"first", "json")
    with pytest.raises(FileExistsError):
        store.put(make_source(), 5, b"second", "json")
    assert (tmp_path / "raw/test-src/2026/09/27/5.json").read_bytes() == b"first"


@pytest.mark.parametrize(("run_id", "ext"), [(0, "json"), (1, "../x"), (1, "js/on"), (1, ""), (1, "JSON")])
def test_put_rejects_unsafe_names(tmp_path: Path, run_id: int, ext: str) -> None:
    with pytest.raises(ValueError):
        _store(tmp_path).put(make_source(), run_id, b"x", ext)


@pytest.mark.parametrize(
    "uri",
    ["raw://../etc/passwd", "file:///etc/passwd", "raw://test-src/2026/09/27/../../x", "raw://a/1/2/3/4.x"],
)
def test_path_refuses_anything_outside_the_layout(tmp_path: Path, uri: str) -> None:
    with pytest.raises(ValueError):
        _store(tmp_path).path(uri)


def _seed(tmp_path: Path, source_id: str, ages: dict[int, int]) -> dict[int, str]:
    uris = {}
    for run_id, age in ages.items():
        ref = _store(tmp_path, NOW - timedelta(days=age)).put(make_source(id=source_id), run_id, b"x", "json")
        assert ref.uri is not None
        uris[run_id] = ref.uri
    return uris


def test_retention_deletes_past_the_ttl_but_keeps_protected_snapshots(tmp_path: Path) -> None:
    uris = _seed(tmp_path, "test-src", {1: 45, 2: 31, 3: 30, 4: 1})
    other = _seed(tmp_path, "other-src", {9: 400})
    (tmp_path / "raw/test-src/notes.txt").write_text("not a snapshot")
    report = _store(tmp_path).enforce_retention(make_source(), protected={uris[1]})
    assert report.deleted == [uris[2]]
    assert report.protected == [uris[1]]
    assert sorted(report.kept) == sorted([uris[3], uris[4]])
    assert not _store(tmp_path).path(uris[2]).exists()
    assert _store(tmp_path).path(uris[1]).exists()
    assert _store(tmp_path).path(other[9]).exists()
    assert (tmp_path / "raw/test-src/notes.txt").exists()


def test_indefinite_keeps_everything_and_none_keeps_only_protected(tmp_path: Path) -> None:
    uris = _seed(tmp_path, "test-src", {1: 900, 2: 0})
    report = _store(tmp_path).enforce_retention(make_source(store_policy="indefinite"))
    assert (report.deleted, sorted(report.kept)) == ([], sorted(uris.values()))
    report = _store(tmp_path).enforce_retention(make_source(store_policy="none"), protected={uris[2]})
    assert (report.deleted, report.protected) == ([uris[1]], [uris[2]])
