"""The generated stops module stays valid TypeScript whatever the feed says (review F4)."""

from __future__ import annotations

import re
import shutil
import subprocess
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from tda.connectors.gtfs_cli import render_stops_ts
from tda.metrics.feeds import ActiveFeed, Stop

HOSTILE = "release\nnot valid TypeScript\r\u2028still a comment\u2029end"
FEED = ActiveFeed(
    source_id="carta-gtfs",
    feed_version_id=1,
    fetch_run_id=1,
    feed_label=HOSTILE,
    feed_start=date(2026, 1, 1),
    feed_end=date(2026, 12, 31),
    timezone="America/New_York",
    loaded_at=datetime(2026, 9, 1, tzinfo=UTC),
)
STOPS = [
    Stop("S\u20281", None, 'A "quoted" \\ name\u2029x', 32.7, -79.9),
    Stop("S2", None, None, 32.8, -79.8),
]
LINE = re.compile(
    r'^  \{ id: "(?:[^"\\\n]|\\.)*", name: "(?:[^"\\\n]|\\.)*", lat: -?[0-9.e-]+, lng: -?[0-9.e-]+ \},$'
)


def test_every_line_is_a_comment_a_declaration_or_a_stop() -> None:
    text = render_stops_ts(FEED, STOPS, "Attribution\nwith a break")
    assert not re.search("[\r\u2028\u2029]", text), "no raw line terminator anywhere"
    lines = text.split("\n")
    assert lines[2] == (
        "// Source: carta-gtfs, feed release not valid TypeScript still a comment end, "
        "valid 2026-01-01 to 2026-12-31."
    )
    assert lines[3] == "// Attribution with a break"
    fixed = {
        "export type FallbackStop = { id: string; name: string; lat: number; lng: number };",
        "",
        "export const fallbackStops: readonly FallbackStop[] = [",
        "];",
    }
    for line in lines:
        assert line.startswith("// ") or line in fixed or LINE.match(line), line
    assert '  { id: "S2", name: "S2", lat: 32.8, lng: -79.8 },' in lines, (
        "a missing name falls back to the id"
    )


def test_node_parses_it(tmp_path: Path) -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node isn't installed here (the structural test above still runs)")
    # Strip the two type annotations, then let Node's parser check the rest as JavaScript.
    js = render_stops_ts(FEED, STOPS, "Attribution\nwith a break").replace(
        "export type FallbackStop = { id: string; name: string; lat: number; lng: number };", ""
    )
    path = tmp_path / "stops.mjs"
    path.write_text(js.replace(": readonly FallbackStop[]", ""), encoding="utf-8")
    subprocess.run([node, "--check", str(path)], check=True, capture_output=True)
