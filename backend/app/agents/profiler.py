"""Profiler job: welcome transcript to a readiness profile. OWNER: track C.

Fallback (ai.md): all items 0, consent from the `consent` event only.
"""

import logging
from typing import Any

from app.agents import llm
from app.agents.shapes import Profile
from app.schemas import READINESS_KEYS
from app.services import readiness

log = logging.getLogger("app.agents.profiler")

JOB = "profiler"
PROMPT_VERSION = "profiler.v1"
NOT_ANSWERED = "not answered"
EVIDENCE_WORDS = 15
SAID_WORDS = 20
TRUSTS_MOST = ("family", "bank", "police", "hospital", "unknown")
FALLBACK_WEAK_SPOT = "Not known yet: the first practice call will show where to start."
FALLBACK_SOURCE = "fallback"  # `source` of a profile made without a model


def clip_words(text: Any, limit: int) -> str:
    """At most `limit` words, trimmed."""
    words = str(text or "").split()
    return " ".join(words[:limit])


def fallback_profile(consent_from_event: bool | None) -> dict[str, Any]:
    """All items 0; consent only from the consent_result event."""
    return {
        "consent_practice": consent_from_event is True,
        "consent_quote": "",
        "items": [{"key": key, "score": 0, "evidence": NOT_ANSWERED} for key in READINESS_KEYS],
        "trusts_most": "unknown",
        "said": "",
        "weak_spot": FALLBACK_WEAK_SPOT,
        "source": FALLBACK_SOURCE,
    }


def _clean_items(items: list[Any]) -> list[dict[str, Any]]:
    """Exactly the five keys, in order, scores clamped; missing ones are 0."""
    found: dict[str, dict[str, Any]] = {}
    for item in items:
        if item.key in READINESS_KEYS and item.key not in found:
            evidence = clip_words(item.evidence, EVIDENCE_WORDS) or NOT_ANSWERED
            found[item.key] = {"key": item.key, "score": readiness.clamp(item.score), "evidence": evidence}
    return [found.get(key, {"key": key, "score": 0, "evidence": NOT_ANSWERED}) for key in READINESS_KEYS]


def clean_profile(profile: Profile, consent_from_event: bool | None) -> dict[str, Any]:
    """The model's profile, checked. Consent needs a clear yes from the model,
    and an explicit no from the consent event always wins."""
    consent = bool(profile.consent_practice) and consent_from_event is not False
    return {
        "consent_practice": consent,
        "consent_quote": clip_words(profile.consent_quote, SAID_WORDS),
        "items": _clean_items(profile.items),
        "trusts_most": profile.trusts_most if profile.trusts_most in TRUSTS_MOST else "unknown",
        "said": clip_words(profile.said, SAID_WORDS),
        "weak_spot": str(profile.weak_spot or "").strip() or FALLBACK_WEAK_SPOT,
        "source": PROMPT_VERSION,
    }


async def build_profile(transcript: str, consent_from_event: bool | None) -> dict[str, Any]:
    """Return an ai.md `Profile` as a dict (plus `source`: the prompt version,
    or "fallback"). Fallback: all items 0, consent from the `consent` event
    only. Never raises. OWNER: track C."""
    try:
        if not transcript.strip():
            return fallback_profile(consent_from_event)
        result = await llm.run_job(
            JOB,
            system=llm.load_prompt(JOB),
            user=f"<transcript>\n{transcript}\n</transcript>",
            schema=Profile,
            prompt_version=PROMPT_VERSION,
        )
        if isinstance(result, Profile):
            return clean_profile(result, consent_from_event)
    except Exception:
        log.exception("profiler failed; using the fallback")
    return fallback_profile(consent_from_event)
