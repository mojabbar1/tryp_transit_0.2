"""Build GTFS zips from the synthetic fixture in tests/fixtures/carta-gtfs, with per-test edits."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "carta-gtfs"


def files() -> dict[str, str]:
    """The fixture's files by name."""
    return {path.name: path.read_text(encoding="utf-8") for path in sorted(FIXTURE.glob("*.txt"))}


def zipped(contents: dict[str, str | None] | None = None) -> bytes:
    """The fixture as a zip; ``contents`` replaces whole files by name (None removes one)."""
    data: dict[str, str | None] = {**files(), **(contents or {})}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, text in data.items():
            if text is not None:
                archive.writestr(name, text)
    return buffer.getvalue()


def replace(name: str, old: str, new: str) -> dict[str, str | None]:
    """``{name: <fixture file with old replaced by new>}``; fails if ``old`` isn't there."""
    text = files()[name]
    assert old in text, f"{old!r} not in {name}"
    return {name: text.replace(old, new, 1)}


def append(name: str, line: str) -> dict[str, str | None]:
    """``{name: <fixture file plus one line>}``."""
    return {name: files()[name] + line + "\n"}
