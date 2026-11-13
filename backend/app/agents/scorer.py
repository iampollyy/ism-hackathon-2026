"""Scorer job: practice transcript to outcome check, lesson, debrief. OWNER: track C.

Numbers come from code: the pipeline decides the outcome by rule first and
uses the scorer's outcome only when the rule has none. The scorer writes
the words: the lesson and the debrief.

Fallback (ai.md): the rule's outcome with a fixed lesson per outcome.
"""

import logging
from typing import Any

from app.agents import llm
from app.agents.shapes import Score
from app.schemas import OUTCOMES, TACTIC_LABELS, TACTICS

log = logging.getLogger("app.agents.scorer")

JOB = "scorer"
PROMPT_VERSION = "scorer.v1"
FALLBACK_VERSION = "fallback"
LESSON_WORDS = 20
# With no rule outcome and no model: neither went along with it nor challenged it.
DEFAULT_OUTCOME = "hesitated"

HABIT = "Next time, hang up and call the family number, or ask for the family word."

# One fixed lesson per outcome, each at most 20 words, naming the habit.
LESSONS: dict[str, str] = {
    "asked_safe_word": "You asked for the family word: that is the habit. Keep doing it on every urgent call.",
    "hung_up": "You hung up to check, which is exactly right. Then ring the family number to be sure.",
    "asked_personal_question": "Testing the caller was smart. Even better: hang up and call the family number, "
                               "or ask for the family word.",
    "hesitated": "When a call asks for money, hang up and call the family number, or ask for the family word.",
    "agreed": "When a caller asks for money or a code, hang up and ring the family number first.",
}

WHAT_YOU_DID: dict[str, str] = {
    "asked_safe_word": "You asked for the family word, which the caller could not give.",
    "hung_up": "You stopped the call to check, instead of going along with it.",
    "asked_personal_question": "You tested the caller with a question only the real person could answer.",
    "hesitated": "You were unsure, but you did not challenge the caller.",
    "agreed": "You started to go along with the request, which is what these calls are built for.",
}


def fallback_lesson(outcome: str) -> str:
    return LESSONS.get(outcome, LESSONS[DEFAULT_OUTCOME])


def fallback_debrief(outcome: str, tactics: list[str]) -> str:
    labels = [TACTIC_LABELS[key].lower() for key in tactics if key in TACTIC_LABELS]
    if labels:
        caller = f"The caller used pressure: {', '.join(labels)}."
    else:
        caller = "The caller tried to rush you into doing something today."
    return f"{caller} {WHAT_YOU_DID.get(outcome, WHAT_YOU_DID[DEFAULT_OUTCOME])} {HABIT}"


def _tactic_list(values: Any) -> list[str]:
    """Known tactic keys only, no repeats, order kept."""
    result: list[str] = []
    for key in values or []:
        if key in TACTICS and key not in result:
            result.append(key)
    return result


def _rule_outcome(context: dict[str, Any]) -> str | None:
    outcome = context.get("rule_outcome", context.get("outcome"))
    return outcome if outcome in OUTCOMES else None


def fallback_score(context: dict[str, Any]) -> dict[str, Any]:
    """The rule's outcome (or hesitated), the marked tactics, a fixed lesson."""
    outcome = _rule_outcome(context) or DEFAULT_OUTCOME
    tactics = _tactic_list(context.get("tactics_marked"))
    return {
        "outcome": outcome,
        "tactics_used": tactics,
        "tactics_worked": [],
        "lesson": fallback_lesson(outcome),
        "debrief": fallback_debrief(outcome, tactics),
        "scorer_version": FALLBACK_VERSION,
    }


def _lesson_ok(lesson: str) -> bool:
    # A little slack over the prompt's 20 words; anything longer is not one line.
    return bool(lesson) and len(lesson.split()) <= LESSON_WORDS + 5


def clean_score(score: Score, context: dict[str, Any]) -> dict[str, Any]:
    """The model's score, checked: known tactics only, and a fixed lesson if
    the model's is empty or far too long. The words are kept even when the
    rule decided another outcome (the model was told the recorded one)."""
    tactics_used = _tactic_list(score.tactics_used)
    lesson = " ".join(str(score.lesson or "").split())
    debrief = " ".join(str(score.debrief or "").split())
    rule = _rule_outcome(context)
    if not _lesson_ok(lesson):
        lesson = fallback_lesson(rule or score.outcome)
    return {
        "outcome": score.outcome,
        "tactics_used": tactics_used,
        "tactics_worked": _tactic_list(score.tactics_worked),
        "lesson": lesson,
        "debrief": debrief or fallback_debrief(rule or score.outcome, tactics_used),
        "scorer_version": PROMPT_VERSION,
    }


def _user_message(transcript: str, context: dict[str, Any]) -> str:
    parts = [f"<transcript>\n{transcript}\n</transcript>"]
    if context.get("scenario"):
        parts.append(f"<scenario>{context['scenario']}</scenario>")
    if context.get("tactics_marked"):
        parts.append(f"<tactics_marked_by_caller>{', '.join(context['tactics_marked'])}</tactics_marked_by_caller>")
    rule = _rule_outcome(context)
    if rule is not None:
        parts.append(f"<recorded_outcome>{rule}</recorded_outcome>\n"
                     "The outcome above was recorded during the call. Write the lesson and the debrief for it.")
    return "\n".join(parts)


async def score_call(transcript: str, context: dict[str, Any]) -> dict[str, Any]:
    """Return an ai.md `Score` as a dict (outcome, tactics_used,
    tactics_worked, lesson, debrief) plus `scorer_version` (the prompt
    version, or "fallback").

    context (all optional): rule_outcome (the outcome decided by rule, or
    None), tactics_marked (tactic keys from the call's tactic events),
    scenario. Fallback: the rule's outcome with a fixed lesson per outcome.
    Never raises. OWNER: track C."""
    try:
        if transcript.strip():
            result = await llm.run_job(
                JOB,
                system=llm.load_prompt(JOB),
                user=_user_message(transcript, context),
                schema=Score,
                prompt_version=PROMPT_VERSION,
                max_tokens=4000,
            )
            if isinstance(result, Score):
                return clean_score(result, context)
    except Exception:
        log.exception("scorer failed; using the fallback")
    return fallback_score(context)
