"""Headline tagger for route news: a pure function (no network, no logging, no shared state).

Deliberately separate from the existing NewsAPI classification pipeline (backend/news/): that classifier is tuned for
price impact (event types such as chokepoint_disruption / opec_decision, severity and confidence), has no "attack" or
"shipping" tag, logs every call, and its public entry point can call the Claude API. This one only answers
"what kind of headline is this?" for the route panel, from the headline text alone.

Tags (priority order, first match wins): attack > sanctions > disruption > shipping > general.
Whole-word matching, so "targeted sanctions" is not an attack and "closer" is not a closure.
"""

import re

TAGS = ("attack", "sanctions", "disruption", "shipping", "general")

# (tag, [regex, ...]) in priority order.
_RULES: list[tuple[str, list[str]]] = [
    ("attack", [
        r"attack(?:s|ed|ing)?", r"drones?", r"missiles?", r"air ?strikes?", r"strikes? on", r"strikes?", r"seiz(?:e|es|ed|ure|ures)",
        r"hijack\w*", r"explosions?", r"struck by", r"torpedo\w*", r"rocket fire", r"shelling",
    ]),
    ("sanctions", [
        r"sanction(?:s|ed|ing)?", r"embargo(?:es|ed)?", r"price cap", r"export bans?", r"blacklist(?:s|ed)?", r"shadow fleet",
    ]),
    ("disruption", [
        r"closures?", r"closed", r"shut(?:s|ting)?(?: down)?", r"blockad\w*", r"block(?:s|ed|ing)?", r"disrupt\w*",
        r"halt(?:s|ed|ing)?", r"suspen(?:d|ds|ded|sion)", r"divert\w*", r"re-?rout\w*", r"outages?", r"delays?",
        r"delayed", r"congestion", r"stranded", r"paus(?:e|es|ed)", r"avoid(?:s|ing)?", r"stoppage", r"damag(?:e|es|ed|ing)",
    ]),
    ("shipping", [
        r"tankers?", r"shipping", r"vessels?", r"freight", r"cargo(?:es)?", r"transit(?:s|ed|ing)?", r"voyages?",
        r"container ships?", r"fleet", r"ports?", r"charter\w*", r"ships?", r"flows?", r"exports?", r"throughput",
        r"supertankers?", r"vlcc",
    ]),
]

_COMPILED = [(tag, [re.compile(rf"\b{p}\b", re.IGNORECASE) for p in pats]) for tag, pats in _RULES]

# 'strike' is military by default in this news ("US could strike Iran"). It is a labour action only with a labour word,
# checked first so "port workers strike" is a disruption, not an attack.
_LABOUR_STRIKE = re.compile(
    r"\b(?:workers?|unions?|dockers?|dock ?workers?|port workers|crews?|pilots?|staff|drivers?|labou?r|walkout|seafarers?)\b.*\bstrikes?\b"
    r"|\bstrikes?\b.*\b(?:over pay|by workers|industrial action)\b", re.IGNORECASE)


def classify_headline(title: str) -> tuple[str, str | None]:
    """Returns (tag, matched_text). matched_text is None for the 'general' fallback."""
    if _LABOUR_STRIKE.search(title):
        return "disruption", "labour strike"
    for tag, patterns in _COMPILED:
        for p in patterns:
            m = p.search(title)
            if m:
                return tag, m.group(0).lower()
    return "general", None
