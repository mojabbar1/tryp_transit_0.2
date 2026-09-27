"""Raw snapshots (02 §5 step 3) at ``raw/<source>/<yyyy>/<mm>/<dd>/<run_id>.<ext>``, per ``store_policy``.

Snapshots are written once (never overwritten) and made read-only. A ``none`` policy keeps only the checksum.
URIs are ``raw://<source>/<yyyy>/<mm>/<dd>/<run_id>.<ext>``, relative to the store root, so they survive a
different mount point in another container.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
from collections.abc import Callable, Collection, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import BinaryIO

from tda.config.models import Source

SCHEME = "raw://"
CHUNK = 1024 * 1024
_SOURCE_ID = re.compile(r"^[a-z][a-z0-9-]*$")
_EXT = re.compile(r"^[a-z0-9]{1,10}(\.[a-z0-9]{1,10})?$")
_KEY = re.compile(
    r"^(?P<source>[a-z][a-z0-9-]*)/(?P<y>\d{4})/(?P<m>\d{2})/(?P<d>\d{2})/(?P<run>[1-9]\d*)\.[a-z0-9.]+$"
)

Content = bytes | bytearray | memoryview | BinaryIO | Iterable[bytes]


@dataclass(frozen=True)
class RawRef:
    """Where a snapshot landed. ``uri`` is None when the policy is ``none`` (checksum only)."""

    uri: str | None
    sha256: str
    size: int


@dataclass
class RetentionReport:
    """What ``enforce_retention`` did for one source."""

    source_id: str
    deleted: list[str] = field(default_factory=list)
    protected: list[str] = field(default_factory=list)
    kept: list[str] = field(default_factory=list)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _chunks(content: Content) -> Iterator[bytes]:
    if isinstance(content, bytes | bytearray | memoryview):
        yield bytes(content)
    elif hasattr(content, "read"):
        while chunk := content.read(CHUNK):  # type: ignore[union-attr]
            yield chunk
    else:
        yield from content  # type: ignore[misc]


class RawStore:
    """The raw snapshot directory (``TDA_RAW_STORE_DIR``, default ``data_agent/raw``)."""

    def __init__(self, root: Path, *, clock: Callable[[], datetime] = _utcnow) -> None:
        self.root = root
        self._clock = clock

    def put(self, source: Source, run_id: int, content: Content, ext: str) -> RawRef:
        """Store one run's raw body (streamed) and return its checksum; honors ``source.store_policy``."""
        if not _SOURCE_ID.match(source.id):
            raise ValueError(f"not a source id: {source.id!r}")
        if not _EXT.match(ext):
            raise ValueError(f"not a safe extension: {ext!r}")
        if run_id < 1:
            raise ValueError("run_id must be a positive fetch_run id")
        digest = hashlib.sha256()
        size = 0
        if source.store_policy == "none":
            for chunk in _chunks(content):
                digest.update(chunk)
                size += len(chunk)
            return RawRef(None, digest.hexdigest(), size)

        day = self._clock().astimezone(UTC)
        key = f"{source.id}/{day:%Y/%m/%d}/{run_id}.{ext}"
        final = self.root / key
        if final.exists():
            raise FileExistsError(f"snapshot {SCHEME}{key} already exists; snapshots are never overwritten")
        final.parent.mkdir(parents=True, exist_ok=True)
        partial = final.with_name(f".{final.name}.{secrets.token_hex(4)}.partial")
        try:
            with partial.open("xb") as out:
                for chunk in _chunks(content):
                    digest.update(chunk)
                    size += len(chunk)
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            partial.chmod(0o444)
            os.replace(partial, final)
        finally:
            partial.unlink(missing_ok=True)
        return RawRef(f"{SCHEME}{key}", digest.hexdigest(), size)

    def path(self, uri: str) -> Path:
        """The file behind a ``raw://`` URI (refuses anything outside the store)."""
        if not uri.startswith(SCHEME) or not _KEY.match(uri[len(SCHEME) :]):
            raise ValueError(f"not a raw snapshot URI: {uri!r}")
        return self.root / uri[len(SCHEME) :]

    def snapshots(self, source_id: str) -> Iterator[tuple[str, date]]:
        """Every stored snapshot of a source as ``(uri, day)``; files outside the layout are ignored."""
        if not _SOURCE_ID.match(source_id):
            raise ValueError(f"not a source id: {source_id!r}")
        base = self.root / source_id
        if not base.is_dir():
            return
        for path in sorted(base.rglob("*")):
            key = path.relative_to(self.root).as_posix()
            match = _KEY.match(key)
            if path.is_file() and match and match["source"] == source_id:
                yield f"{SCHEME}{key}", date(int(match["y"]), int(match["m"]), int(match["d"]))

    def enforce_retention(self, source: Source, *, protected: Collection[str] = ()) -> RetentionReport:
        """Delete snapshots older than the source's TTL (all of them for ``none``), except ``protected``.

        ``protected`` holds the URIs cited by published facts (see ``tda.store.retention``); they are kept
        regardless of TTL (02 §7.4). ``indefinite`` deletes nothing.
        """
        report = RetentionReport(source.id)
        if source.store_policy == "indefinite":
            report.kept = [uri for uri, _ in self.snapshots(source.id)]
            return report
        ttl = 0 if source.store_policy == "none" else source.ttl_days
        assert ttl is not None
        cutoff = self._clock().astimezone(UTC).date() - timedelta(days=ttl)
        for uri, day in self.snapshots(source.id):
            if source.store_policy != "none" and day >= cutoff:
                report.kept.append(uri)
            elif uri in protected:
                report.protected.append(uri)
            else:
                self.path(uri).unlink()
                report.deleted.append(uri)
        return report
