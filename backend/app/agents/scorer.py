"""Scorer job: practice transcript to outcome check, lesson, debrief. OWNER: track C."""

from typing import Any


async def score_call(transcript: str, context: dict[str, Any]) -> dict[str, Any]:
    """Return an ai.md `Score` as a dict (outcome, tactics_used,
    tactics_worked, lesson, debrief). Fallback: the rule's outcome with a
    fixed lesson per outcome. Never raises. OWNER: track C."""
    raise NotImplementedError
