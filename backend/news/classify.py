"""
Single entry point for classification. Everything downstream (poller.py,
main.py's test-inject endpoint) imports classify_article from HERE, never
from either implementation module directly -- that's the swappable seam.

Picks the Claude-based classifier (classifier_claude.py) whenever
ANTHROPIC_API_KEY is configured -- strictly better: real language
understanding, properly calibrated confidence. Falls back to the
rule-based heuristic (classifier_rules.py) otherwise. Both return the
exact same ClassifiedEvent shape, so the price engine, alert feed, and
historical chart never need to know or care which one ran -- they just
log which one did (classifier_used field) so it's visible in testing/audit.
"""

import logging

from services import hosted

from . import claude_governor, classifier_claude, classifier_rules
from .models import Article, ClassifiedEvent

logger = logging.getLogger("news_pipeline")

CLASSIFIER_CLAUDE = "claude"
CLASSIFIER_RULES = "rules"


def active_classifier_name() -> str:
    return CLASSIFIER_CLAUDE if classifier_claude.is_available() and hosted.enabled("anthropic") else CLASSIFIER_RULES


def classify_article(article: Article) -> tuple[ClassifiedEvent, str]:
    """Returns (event, classifier_used) -- the classifier name is returned
    explicitly (not just logged) so callers that persist/display events
    (db.py, the alert feed, the historical chart) can record it too."""
    which = active_classifier_name()
    if which == CLASSIFIER_CLAUDE:
        return claude_governor.classify(article)          # cached per headline, daily and monthly caps, rule-based fallback
    return classifier_rules.classify_article(article), CLASSIFIER_RULES
