"""The readiness scale and how practice moves it (ai.md). OWNER: track C.

Five items, each 0 to 2, so a person scores out of 10. The welcome call sets
"before"; after that only practice results move the scores:

| Result                  | verify_first           | under_pressure          | Also                  |
|-------------------------|------------------------|-------------------------|-----------------------|
| asked_safe_word         | 2                      | 2 within 30 s, else 1   | safe_word = 2         |
| hung_up                 | 2                      | 2 within 30 s, else 1   |                       |
| asked_personal_question | 1, or 2 if it was 2    | 1                       |                       |
| hesitated               | 1                      | 1                       |                       |
| agreed                  | 0                      | 0                       | payment_caution = 0   |
| family number within 60 s |                      |                         | trusted_contact = 2   |

Also here: what the planner may choose for a person's next practice
(ai.md, "Choosing what the planner may pick"). Every function is pure.
"""

from dataclasses import dataclass
from typing import Any

from app.schemas import READINESS_ITEM_MAX, READINESS_KEYS

# ai.md: "Tapped the family number within a minute: trusted_contact becomes 2".
CALLBACK_WITHIN_SECONDS = 60.0
# ai.md: under_pressure is 2 when the challenge came within 30 seconds.
CHALLENGE_WITHIN_SECONDS = 30.0

SAFE_OUTCOMES = ("asked_safe_word", "hung_up", "asked_personal_question")
MAX_DIFFICULTY = 3
DEFAULT_SCENARIO = "relative_new_number"
# The first practice is the story the person said they would most likely believe.
TRUSTS_TO_SCENARIO = {"bank": "bank_security", "police": "police", "hospital": "hospital"}


# ---------------------------------------------------------------- scores


def clamp(score: Any) -> int:
    """Any value to an item score: an int from 0 to 2 (bad values become 0)."""
    try:
        value = int(score)
    except (TypeError, ValueError):
        return 0
    return max(0, min(READINESS_ITEM_MAX, value))


def normalize(scores: dict[str, Any]) -> dict[str, int]:
    """All five keys, each clamped to 0..2; unknown keys are dropped."""
    return {key: clamp(scores.get(key, 0)) for key in READINESS_KEYS}


def total(scores: dict[str, Any]) -> int:
    return sum(normalize(scores).values())


def _within(seconds: float | None, limit: float) -> bool:
    return seconds is not None and 0 <= seconds <= limit


def apply_result(scores: dict[str, int], outcome: str, seconds_to_challenge: float | None,
                 callback_seconds: float | None) -> dict[str, int]:
    """Return new item scores (keys from schemas.READINESS_KEYS, 0 to 2)
    after one practice result, following ai.md's table, including the
    family-number row (apply_callback). Pure function."""
    new = normalize(scores)
    quick = 2 if _within(seconds_to_challenge, CHALLENGE_WITHIN_SECONDS) else 1
    if outcome == "asked_safe_word":
        new.update(verify_first=2, under_pressure=quick, safe_word=2)
    elif outcome == "hung_up":
        new.update(verify_first=2, under_pressure=quick)
    elif outcome == "asked_personal_question":
        new.update(verify_first=2 if new["verify_first"] == 2 else 1, under_pressure=1)
    elif outcome == "hesitated":
        new.update(verify_first=1, under_pressure=1)
    elif outcome == "agreed":
        new.update(verify_first=0, under_pressure=0, payment_caution=0)
    return normalize(apply_callback(new, callback_seconds))


def apply_callback(scores: dict[str, int], callback_seconds: float | None) -> dict[str, int]:
    """Return new item scores after the family number was tapped:
    trusted_contact becomes 2 when callback_seconds is set and at most 60;
    otherwise the scores are unchanged. Pure function, returns a new dict.
    Used by apply_result and by phone.family_line (track B) when the
    practice's result already exists. Written by the foundation so track B
    does not wait on track C; track C may refine it but keeps the signature."""
    new_scores = dict(scores)
    if callback_seconds is not None and 0 <= callback_seconds <= CALLBACK_WITHIN_SECONDS:
        new_scores["trusted_contact"] = 2
    return new_scores


# ---------------------------------------------------------------- snapshot items


def scores_from_items(items: Any) -> dict[str, int]:
    """[{key, score, ...}] (as stored in items_json or a profile) to clamped scores."""
    scores: dict[str, int] = {}
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and item.get("key") in READINESS_KEYS:
            scores[item["key"]] = clamp(item.get("score"))
    return normalize(scores)


def evidence_from_items(items: Any) -> dict[str, str]:
    evidence: dict[str, str] = {}
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and item.get("key") in READINESS_KEYS and item.get("evidence"):
            evidence[item["key"]] = str(item["evidence"])
    return evidence


def items_from_scores(scores: dict[str, Any], evidence: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Clamped scores to the stored form [{key, score, evidence?}], in the fixed order."""
    evidence = evidence or {}
    items: list[dict[str, Any]] = []
    for key, score in normalize(scores).items():
        item: dict[str, Any] = {"key": key, "score": score}
        if evidence.get(key):
            item["evidence"] = evidence[key]
        items.append(item)
    return items


# ---------------------------------------------------------------- what the planner may choose


@dataclass
class PracticeChoice:
    scenarios: list[str]  # allowed for the next practice, the rule's pick first
    difficulty: int  # the rule's pick
    max_difficulty: int  # the highest the planner may choose
    leading_tactic: str | None  # the tactic to bring back, after agreed or hesitated
    reason: str  # first | repeat_tactic | new_story | harder


# The planner's fallback: a fixed sentence per rule, as the step's reason.
REASONS = {
    "first": "A first practice with the kind of call you are most likely to believe.",
    "repeat_tactic": "The same pressure as last time, in a different story.",
    "new_story": "A story you have not had yet, because you handled the last one well.",
    "harder": "A new story, a little more persistent, after two safe results in a row.",
}


def clamp_difficulty(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 1
    return max(1, min(MAX_DIFFICULTY, number))


def _tactics_of(key: str, available: list[dict[str, Any]]) -> list[str]:
    for scenario in available:
        if scenario.get("key") == key:
            return list(scenario.get("allowed_tactics") or [])
    return []


def _first_scenario(trusts_most: str | None, keys: list[str]) -> str:
    wanted = TRUSTS_TO_SCENARIO.get(trusts_most or "", DEFAULT_SCENARIO)
    if wanted in keys:
        return wanted
    return DEFAULT_SCENARIO if DEFAULT_SCENARIO in keys else keys[0]


def _two_safe_at(history: list[dict[str, Any]], difficulty: int) -> bool:
    """The last two results were both safe, both at this difficulty."""
    if len(history) < 2:
        return False
    return all(item.get("outcome") in SAFE_OUTCOMES
               and clamp_difficulty(item.get("difficulty")) == difficulty
               for item in history[-2:])


def next_practice(trusts_most: str | None, history: list[dict[str, Any]],
                  available: list[dict[str, Any]]) -> PracticeChoice:
    """The rule for one person's next practice.

    trusts_most: from the profile (family, bank, police, hospital, unknown).
    history: past practice results, oldest first:
      [{scenario, difficulty, outcome, leading_tactic}].
    available: the scenario files that exist: [{key, allowed_tactics, voice}].

    - First practice: the scenario matching trusts_most, or the relative story.
    - After agreed or hesitated: the same leading tactic, a different
      scenario, the same difficulty.
    - After a safe result: a scenario they have not had; after two safe
      results in a row, difficulty plus one, up to 3.
    The planner may choose up to one level above the rule after a safe
    result (max_difficulty); otherwise no higher than the rule.
    """
    keys = [s["key"] for s in available if s.get("key")] or [DEFAULT_SCENARIO]
    if not history:
        return PracticeChoice([_first_scenario(trusts_most, keys)], 1, 1, None, "first")
    last = history[-1]
    difficulty = clamp_difficulty(last.get("difficulty"))
    others = [key for key in keys if key != last.get("scenario")] or keys
    if last.get("outcome") not in SAFE_OUTCOMES:
        tactic = last.get("leading_tactic")
        with_tactic = [key for key in others if tactic and tactic in _tactics_of(key, available)]
        ordered = with_tactic + [key for key in others if key not in with_tactic]
        return PracticeChoice(ordered, difficulty, difficulty, tactic, "repeat_tactic")
    had = {item.get("scenario") for item in history}
    ordered = [key for key in others if key not in had] or others
    if _two_safe_at(history, difficulty) and difficulty < MAX_DIFFICULTY:
        return PracticeChoice(ordered, difficulty + 1, difficulty + 1, None, "harder")
    return PracticeChoice(ordered, difficulty, min(MAX_DIFFICULTY, difficulty + 1), None, "new_story")
