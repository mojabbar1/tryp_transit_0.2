"""robots.txt evaluation per RFC 9309, used by the polite client.

``urllib.robotparser`` is not RFC 9309 compliant: it has no ``*``/``$`` patterns, doesn't merge repeated
groups, applies the first matching rule instead of the longest, and matches user agents by substring. Here:
- **Groups (§2.1, §2.2.1):** one or more ``user-agent`` lines followed by rules. Every group whose user-agent
  token equals our product token (case-insensitive; ``TrypTransitDataAgent/1.0`` counts) is merged; the
  ``*`` groups apply only when none does; with neither, everything is allowed.
- **Rules (§2.2.2):** ``allow``/``disallow`` paths, where ``*`` matches any sequence and a trailing ``$``
  anchors the end. The longest matching rule (in octets) wins; on a tie, allow wins. No match means allowed.
  An empty rule value is ignored. ``/robots.txt`` itself is always allowed.
- **Encoding (§2.2.2, Figure 4):** paths and rules are compared after the same component-aware
  normalization: non-ASCII becomes UTF-8 escapes; escaped unreserved characters are decoded; other escapes
  stay (uppercase hex), so ``%2F`` never equals a ``/`` separator. Reserved characters that can only be data
  are encoded: in path segments everything outside ``pchar`` (such as ``[`` and ``]``), and in query keys and
  values every reserved character (``?baz=https://foo.bar`` -> ``?baz=https%3A%2F%2Ffoo.bar``). ``/``, ``?``,
  ``&``, and ``=`` stay structural. In rules ``*`` is the wildcard and a final ``$`` the anchor; in URIs both
  are data (``%2A``, ``%24``), so a rule matches them literally only when written escaped (§2.2.3).
- **Matching** is linear: ``*`` patterns are matched segment by segment (leftmost greedy, which is exact
  for ``*``-only globs), never via backtracking regular expressions.
- ``crawl-delay`` (not in the RFC) is honored when a matching group sets it; the largest value wins.
"""

from __future__ import annotations

import re
import string
from dataclasses import dataclass, field
from urllib.parse import urlsplit

_UNRESERVED = frozenset(string.ascii_letters + string.digits + "-._~")
_SUB_DELIMS = frozenset("!$&'()*+,;=")
_PCHAR_EXTRA = (_SUB_DELIMS | frozenset(":@")) - frozenset("*$")  # raw in a path segment (RFC 3986 pchar)
_HEX = frozenset(string.hexdigits)
_TOKEN = re.compile(r"[A-Za-z_-]+")


def product_token(user_agent: str) -> str:
    """The leading ``[A-Za-z_-]`` run: ``TrypTransitDataAgent/0.1.0 (+…)`` -> ``TrypTransitDataAgent``."""
    match = _TOKEN.match(user_agent.strip())
    return match.group(0) if match else ""


def _component(text: str, keep: frozenset[str], *, rule: bool) -> str:
    out = []
    i = 0
    while i < len(text):
        char = text[i]
        escape = text[i + 1 : i + 3]
        if char == "%" and len(escape) == 2 and set(escape) <= _HEX:
            decoded = chr(int(escape, 16))
            out.append(decoded if decoded in _UNRESERVED else f"%{escape.upper()}")
            i += 3
            continue
        if rule and char == "*":
            out.append("*")
        elif ord(char) >= 128:
            out.append("".join(f"%{b:02X}" for b in char.encode()))
        elif char in _UNRESERVED or char in keep:
            out.append(char)
        else:
            out.append(f"%{ord(char):02X}")
        i += 1
    return "".join(out)


def normalize(text: str, *, rule: bool = False) -> str:
    """The RFC 9309 §2.2.2 comparison form of a rule (``rule=True``) or of a URI's path and query."""
    anchored = rule and text.endswith("$")
    body = text[:-1] if anchored else text
    path, question, query = body.partition("?")
    normalized = "/".join(_component(segment, _PCHAR_EXTRA, rule=rule) for segment in path.split("/"))
    if question:
        pairs = []
        for pair in query.split("&"):
            key, equals, value = pair.partition("=")
            pairs.append(
                _component(key, frozenset(), rule=rule) + equals + _component(value, frozenset(), rule=rule)
            )
        normalized += "?" + "&".join(pairs)
    return normalized + ("$" if anchored else "")


def wildcard_match(pattern: str, path: str) -> bool:
    """Whether ``pattern`` (``*`` wildcards, optional final ``$``) matches the start of ``path``.

    Leftmost-greedy segment search is exact for ``*``-only globs and runs in linear time (no backtracking).
    """
    anchored = pattern.endswith("$")
    first, *rest = (pattern[:-1] if anchored else pattern).split("*")
    if not path.startswith(first):
        return False
    if not rest:
        return len(path) == len(first) if anchored else True
    position = len(first)
    *middle, last = rest
    for segment in middle:
        if segment:
            found = path.find(segment, position)
            if found < 0:
                return False
            position = found + len(segment)
    if anchored:
        return len(path) - len(last) >= position and path.endswith(last)
    return not last or path.find(last, position) >= 0


@dataclass(frozen=True)
class Rule:
    """One ``allow`` or ``disallow`` line of a matching group."""

    allow: bool
    pattern: str

    def matches(self, path: str) -> bool:
        """Whether this rule's pattern matches the normalized ``path`` (anchored at its start)."""
        return wildcard_match(self.pattern, path)


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
                current.rules.append(Rule(key == "allow", normalize(value, rule=True)))
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
