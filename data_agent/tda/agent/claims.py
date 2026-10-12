"""Python port of P1's validate-claims.ts; the unchanged shared vectors are its contract."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

SLOT = re.compile(r"\{\{([a-z][a-z_]*)\}\}")
ID = re.compile(r"[a-z][a-z_]*")
LABEL = re.compile(r"[A-Za-z][A-Za-z '-]*")
FLAGS = ("transitServiceKnown", "transitFaster", "transitCheaper", "offerActive", "trafficNow")


def normalize(value: str) -> str:
    return " ".join(value.split()).lower()


def numeric(value: str) -> bool:
    return any(unicodedata.category(c).startswith("N") for c in value)


def _contradicts(value: str, flags: dict[str, bool]) -> bool:
    patterns = {
        "transitFaster": r"\b(faster|fastest|quicker|quickest)\b",
        "transitCheaper": r"\b(cheap(?:er|est)?|sav(?:e[sd]?|ing[s]?)|less expensive)\b",
        "transitServiceKnown": (
            r"\b(next (?:bus|departure)|(?:transit|bus) (?:time|duration|arriv(?:al|es)))\b"
        ),
        "offerActive": r"\b(rewards?|credits?|ecredits?|gift cards?|discounts?|offers?)\b",
        "trafficNow": r"\btraffic\b",
    }
    return any(not flags[key] and re.search(pattern, value, re.I) for key, pattern in patterns.items())


def validate_claims(nudge: Any, slots: Any, facts: Any, flags: Any) -> dict[str, Any]:
    """Return the same ok/reason result as P1; no substitution on failure."""

    def reject(reason: str) -> dict[str, Any]:
        return {"ok": False, "reason": reason}

    if (
        not isinstance(nudge, str)
        or not isinstance(slots, list)
        or any(not isinstance(s, str) or not ID.fullmatch(s) for s in slots)
        or not isinstance(facts, list)
        or not isinstance(flags, dict)
        or set(flags) != set(FLAGS)
        or any(type(v) is not bool for v in flags.values())
    ):
        return reject("invalid_input")
    for fact in facts:
        if (
            not isinstance(fact, dict)
            or set(fact) != {"id", "label", "phrase"}
            or not all(isinstance(v, str) for v in fact.values())
            or not ID.fullmatch(fact["id"])
            or not LABEL.fullmatch(fact["label"])
            or not fact["phrase"].strip()
            or re.search(r"[{}]", fact["phrase"])
        ):
            return reject("invalid_input")
    if not nudge.strip():
        return reject("empty_nudge")
    if numeric(nudge):
        return reject("digit_in_nudge")
    by_id = {f["id"]: f for f in facts}
    if len(by_id) != len(facts) or len({normalize(f["label"]) for f in facts}) != len(facts):
        return reject("duplicate_fact")
    if len(set(slots)) != len(slots):
        return reject("duplicate_slot")
    if any(s not in by_id for s in slots):
        return reject("unknown_slot")
    referenced = SLOT.findall(nudge)
    remaining = SLOT.sub("", nudge)
    if re.search(r"[{}]", remaining):
        return reject("malformed_slot")
    if any(s not in by_id for s in referenced):
        return reject("unknown_slot")
    if any(s not in slots for s in referenced):
        return reject("missing_slot")
    if any(s not in referenced for s in slots):
        return reject("unused_slot")
    if _contradicts(remaining, flags) or any(
        _contradicts(f"{by_id[s]['label']} {by_id[s]['phrase']}", flags) for s in referenced
    ):
        return reject("flag_conflict")
    sentences = re.split(r"[.!?]", nudge.strip())
    if sentences[-1] == "":
        sentences.pop()
    if not 1 <= len(sentences) <= 2:
        return reject("sentence_count")
    prose = {
        "consider transit": True,
        "compare your options": True,
        "transit timing is unavailable": not flags["transitServiceKnown"],
        "transit is faster": flags["transitServiceKnown"] and flags["transitFaster"],
        "transit is cheaper": flags["transitCheaper"],
        "save with transit": flags["transitCheaper"],
        "check the next bus": flags["transitServiceKnown"],
        "an approved reward is available": flags["offerActive"],
        "an approved credit is available": flags["offerActive"],
        "traffic now": flags["trafficNow"],
    }
    for sentence in sentences:
        for clause in sentence.split(";"):
            match = re.fullmatch(r"(?:([A-Za-z][A-Za-z '-]*):\s*)?\{\{([a-z][a-z_]*)\}\}", clause.strip())
            if match:
                label, slot = match.groups()
                if label and normalize(label) != normalize(by_id[slot]["label"]):
                    return reject("label_mismatch")
            elif normalize(clause) not in prose:
                return reject("unsupported_prose")
            elif not prose[normalize(clause)]:
                return reject("flag_conflict")
    return {"ok": True}


def substitute_claims(
    nudge: str, slots: list[str], facts: list[dict[str, str]], flags: dict[str, bool]
) -> str:
    result = validate_claims(nudge, slots, facts, flags)
    if not result["ok"]:
        raise ValueError(result["reason"])
    phrases = {f["id"]: f["phrase"] for f in facts}
    return SLOT.sub(lambda match: phrases[match[1]], nudge)
