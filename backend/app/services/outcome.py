"""Deciding the outcome of a practice call, by rule. OWNER: track C.

backend.md, "Deciding the outcome, by rule":
1. If the person ended the call before any `outcome` event: hung_up.
2. Otherwise the agent's `practice_result` outcome (the first `outcome` event).
3. If neither exists (the agent forgot the tool, or the call timed out): the
   scorer's outcome (decide_outcome returns None; the pipeline asks the scorer).
4. seconds_to_challenge is the server time of the first `outcome` event, or of
   the end of the call for hung_up, minus answered_at. It is empty for
   hesitated and agreed. The value the events endpoint stored with the
   event comes first, and it is never past the end of the call (a last
   batch may arrive just after /end).
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.db import parse_time
from app.schemas import OUTCOMES

# Outcomes with no challenge, so no seconds_to_challenge.
NO_CHALLENGE = ("hesitated", "agreed")


@dataclass
class OutcomeDecision:
    outcome: str | None  # one of schemas.OUTCOMES, or None: use the scorer's outcome
    seconds_to_challenge: float | None


def _seconds(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None:
        return None
    return max(0.0, round((end - start).total_seconds(), 1))


def first_outcome_event(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The first `outcome` event with a known outcome, or None."""
    for event in events:
        if event.get("type") != "outcome":
            continue
        if (event.get("data") or {}).get("outcome") in OUTCOMES:
            return event
    return None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _event_time(event: dict[str, Any], answered_at: datetime | None) -> float | None:
    """Seconds from answered_at to the event: the seconds the events
    endpoint stored with it (already capped at the end of the call), else
    its stored server time, else its stamped t."""
    stored = (event.get("data") or {}).get("seconds_to_challenge")
    if _is_number(stored):
        return max(0.0, round(float(stored), 1))
    seconds = _seconds(answered_at, parse_time(event.get("created_at")))
    if seconds is not None:
        return seconds
    t = event.get("t")
    return max(0.0, float(t)) if _is_number(t) else None


def _capped(seconds: float | None, call_seconds: float | None) -> float | None:
    """Never past the end of the call: an outcome event in a batch that
    arrives after /end is stored later than the call ended."""
    if seconds is None or call_seconds is None:
        return seconds
    return min(seconds, call_seconds)


def seconds_for(outcome: str, answered_at: datetime | None, ended_at: datetime | None,
                event: dict[str, Any] | None = None) -> float | None:
    """Rule 4 for one outcome: the event's time (capped at the end of the
    call), or the end of the call for hung_up; None for hesitated and agreed."""
    if outcome in NO_CHALLENGE or answered_at is None:
        return None
    if event is not None:
        return _capped(_event_time(event, answered_at), _seconds(answered_at, ended_at))
    if outcome == "hung_up":
        return _seconds(answered_at, ended_at)
    return None


def decide_outcome(events: list[dict[str, Any]], ended_by: str | None,
                   answered_at: datetime | None, ended_at: datetime | None) -> OutcomeDecision:
    """Apply the four rules above to a call's stored events (the dicts from
    app.events.list_events, in seq order). Pure: no database, no network."""
    event = first_outcome_event(events)
    if event is None and ended_by == "user":
        return OutcomeDecision("hung_up", seconds_for("hung_up", answered_at, ended_at))
    if event is None:
        return OutcomeDecision(None, None)
    outcome = event["data"]["outcome"]
    return OutcomeDecision(outcome, seconds_for(outcome, answered_at, ended_at, event))
