"""
Article -> ClassifiedEvent, via the Claude API's structured-output path
(client.messages.parse with a Pydantic output_format) -- the response is
guaranteed to validate against ClassifiedEvent, so there's no free-text
JSON parsing to get wrong.

Model: claude-opus-5. A classification call here runs roughly 300-800
input tokens (article title + summary + a short system prompt) and
~100-250 output tokens (the JSON object) -- at $5/$25 per 1M tokens that's
well under $0.01 per article classified. claude-haiku-4-5 ($1/$5 per 1M)
would cut that further for high-volume production use; switching is a
one-line change to CLASSIFICATION_MODEL if cost becomes a concern.
"""

import logging
import os

from anthropic import Anthropic

from .models import Article, ClassifiedEvent

logger = logging.getLogger("news_pipeline")

CLASSIFICATION_MODEL = os.environ.get("CLAUDE_CLASSIFIER_MODEL", "").strip() or "claude-opus-5"

# Below this confidence, force price_relevant=False regardless of what the
# model itself said -- per the brief: "reject or down-weight classifications
# with low confidence rather than letting a single ambiguous article swing
# the price."
MIN_CONFIDENCE_FOR_PRICE_IMPACT = 0.5

SYSTEM_PROMPT = """You are a news classifier for an oil-crisis and EV/lithium-transition \
simulation platform. You read one news article at a time and extract a structured \
assessment of its relevance to crude oil prices or the EV/lithium supply chain.

Guidance:
- severity: sign is direction (negative = bearish for crude price / supply increase, \
positive = bullish for crude price / supply decrease), magnitude is how large the \
expected impact is. A confirmed major supply disruption at a chokepoint might be \
+0.6 to +0.9. A routine, already-priced-in OPEC statement might be +0.1 to +0.2. An \
article about ample supply or demand destruction would be negative.
- confidence: how clearly THIS article (not your general knowledge) supports your \
read. A single unconfirmed report, a vague analyst-opinion piece, or an article with \
conflicting signals should get LOW confidence (well under 0.5), even if the topic is \
on-point. Reserve high confidence (0.7+) for articles reporting a clear, specific, \
fairly certain event.
- price_relevant: false for articles that are on-topic but don't describe anything \
that should move a price (pure background/analysis pieces, duplicated/no-new-information \
stories, or anything where your own confidence is too low to act on).
- Only list chokepoints/countries/companies in affected_entities that the article \
actually names or clearly implies -- don't infer entities that aren't there.
- summary: one plain-language sentence a non-expert could read on a dashboard."""


_client: Anthropic | None = None


def is_available() -> bool:
    """Cheap check the poller uses once per cycle to decide whether to even
    attempt classification -- avoids calling classify_article() (and
    logging the same RuntimeError) once per article when there's no key."""
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set -- classification requires a real Anthropic "
                "API key (see backend/.env.example)."
            )
        _client = Anthropic()
    return _client


def classify_article(article: Article) -> ClassifiedEvent:
    return classify_with_usage(article)[0]


def classify_with_usage(article: Article) -> tuple[ClassifiedEvent, int, int]:
    """(event, input tokens, output tokens): the token counts are what the API reported, used by claude_governor to count spend."""
    client = _get_client()

    response = client.messages.parse(
        model=CLASSIFICATION_MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Title: {article.title}\n\n"
                    f"Description: {article.description}\n\n"
                    f"Source: {article.source}, published {article.published_at}"
                ),
            }
        ],
        output_format=ClassifiedEvent,
    )
    event = response.parsed_output

    # Defensive clamp -- never trust a single LLM call to stay perfectly
    # in-range even though the schema declares bounds.
    event.severity = max(-1.0, min(1.0, event.severity))
    event.confidence = max(0.0, min(1.0, event.confidence))

    if event.confidence < MIN_CONFIDENCE_FOR_PRICE_IMPACT and event.price_relevant:
        logger.info(
            "Down-weighting '%s': confidence %.2f below %.2f threshold, forcing price_relevant=False",
            article.title,
            event.confidence,
            MIN_CONFIDENCE_FOR_PRICE_IMPACT,
        )
        event.price_relevant = False

    logger.info(
        "Classified [%s] conf=%.2f sev=%+.2f price_relevant=%s :: %s -- %s",
        event.event_type.value,
        event.confidence,
        event.severity,
        event.price_relevant,
        article.title,
        event.summary,
    )
    u = getattr(response, "usage", None)
    return event, int(getattr(u, "input_tokens", 0) or 0), int(getattr(u, "output_tokens", 0) or 0)
