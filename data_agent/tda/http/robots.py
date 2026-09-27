"""robots.txt evaluation per RFC 9309, used by the polite client.

``urllib.robotparser`` is not RFC 9309 compliant: it has no ``*``/``$`` patterns, doesn't merge repeated
groups, applies the first matching rule instead of the longest, and matches user agents by substring. Here:
- **Groups (§2.1, §2.2.1):** one or more ``user-agent`` lines followed by rules. Every group whose user-agent
  token equals our product token (case-insensitive; ``TrypTransitDataAgent/1.0`` counts) is merged; the
  ``*`` groups apply only when none does; with neither, everything is allowed.
- **Rules (§2.2.2):** ``allow``/``disallow`` paths, where ``*`` matches any sequence and a trailing ``$``
  anchors the end. The longest matching rule (in octets) wins; on a tie, allow wins. No match means allowed.
  An empty rule value is ignored. ``/robots.txt`` itself is always allowed.
- **Encoding (§2.2.2):** paths and rules are compared after percent-encoding non-ASCII octets (UTF-8) and
  decoding percent-encoded unreserved characters; other escapes are kept, with uppercase hex.
- ``crawl-delay`` (not in the RFC) is honored when a matching group sets it; the largest value wins.
"""

from __future__ import annotations

import re
import string
from dataclasses import dataclass, field
from urllib.parse import urlsplit

_UNRESERVED = frozenset(string.ascii_letters + string.digits + "-._~")
_TOKEN = re.compile(r"[A-Za-z_-]+")
_ESCAPE = re.compile(r"%([0-9A-Fa-f]{2})")


def product_token(user_agent: str) -> str:
    """The leading ``[A-Za-z_-]`` run: ``TrypTransitDataAgent/0.1.0 (+…)`` -> ``TrypTransitDataAgent``."""
    match = _TOKEN.match(user_agent.strip())
    return match.group(0) if match else ""


def normalize(path: str) -> str:
    """Encode non-ASCII as UTF-8 escapes and decode escaped unreserved characters (RFC 9309 §2.2.2)."""

    def fix(match: re.Match[str]) -> str:
        char = chr(int(match.group(1), 16))
        return char if char in _UNRESERVED else f"%{match.group(1).upper()}"

    encoded = "".join(c if ord(c) < 128 else "".join(f"%{b:02X}" for b in c.encode()) for c in path)
    return _ESCAPE.sub(fix, encoded)


@dataclass(frozen=True)
class Rule:
    """One ``allow`` or ``disallow`` line of a matching group."""

    allow: bool
    pattern: str

    def matches(self, path: str) -> bool:
        """Whether this rule's pattern matches the normalized ``path`` (anchored at its start)."""
        anchored = self.pattern.endswith("$")
        body = self.pattern[:-1] if anchored else self.pattern
        regex = ".*".join(re.escape(part) for part in body.split("*")) + ("$" if anchored else "")
        return re.match(regex, path, flags=re.DOTALL) is not None


@dataclass
class RobotsRules:
    """The merged rules that apply to one product token."""

    rules: list[Rule] = field(default_factory=list)
    crawl_delay: float | None = None

    def allows(self, url: str) -> bool:
        """Whether ``url`` (or a path) may be fetched."""
        parts = urlsplit(url)
        path = normalize((parts.path or "/") + (f"?{parts.query}" if parts.query else ""))
        if path == "/robots.txt":
            return True
        best: Rule | None = None
        for rule in self.rules:
            if not rule.matches(path):
                continue
            if best is None or len(rule.pattern) > len(best.pattern):
                best = rule
            elif len(rule.pattern) == len(best.pattern) and rule.allow:
                best = rule
        return best is None or best.allow


@dataclass
class _Group:
    agents: list[str] = field(default_factory=list)
    rules: list[Rule] = field(default_factory=list)
    crawl_delay: float | None = None


def parse(text: str, user_agent: str) -> RobotsRules:
    """The rules in ``text`` that apply to ``user_agent``'s product token."""
    groups: list[_Group] = []
    current: _Group | None = None
    in_rules = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if current is None or in_rules:
                current = _Group()
                groups.append(current)
                in_rules = False
            current.agents.append(value)
        elif key in ("allow", "disallow") and current is not None:
            in_rules = True
            if value:
                current.rules.append(Rule(key == "allow", normalize(value)))
        elif key == "crawl-delay" and current is not None:
            in_rules = True
            try:
                current.crawl_delay = max(float(value), 0.0)
            except ValueError:
                pass
    token = product_token(user_agent).lower()
    matching = [g for g in groups if any(product_token(a).lower() == token for a in g.agents if a != "*")]
    if not matching:
        matching = [g for g in groups if "*" in g.agents]
    delays = [g.crawl_delay for g in matching if g.crawl_delay is not None]
    return RobotsRules([rule for g in matching for rule in g.rules], max(delays) if delays else None)
