"""Deciding the outcome of a practice call, by rule. OWNER: track C."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class OutcomeDecision:
    outcome: str | None  # one of schemas.OUTCOMES, or None: use the scorer's outcome
    seconds_to_challenge: float | None


def decide_outcome(events: list[dict[str, Any]], ended_by: str | None,
                   answered_at: datetime | None, ended_at: datetime | None) -> OutcomeDecision:
    """Apply the rules in backend.md ("Deciding the outcome, by rule"):
    1. ended_by == "user" before any `outcome` event: hung_up.
    2. Otherwise the first `outcome` event's outcome (the agent's practice_result).
    3. Neither: outcome None (the scorer's outcome is used).
    4. seconds_to_challenge: server time of the first `outcome` event (its
       created_at), or ended_at for hung_up, minus answered_at; None for
       hesitated and agreed, or when answered_at is missing.
    `events` are the dicts from app.events.list_events(call_id), in seq order.
    Pure function: no database, no network. OWNER: track C."""
    raise NotImplementedError
