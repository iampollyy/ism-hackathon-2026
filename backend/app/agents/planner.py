"""Planner job: profiles and results to each person's plan. OWNER: track C."""

from typing import Any


async def plan_family(family_input: dict[str, Any]) -> dict[str, Any]:
    """Return an ai.md `FamilyPlan` as a dict (members[MemberPlan],
    family_tasks). Fallback: the rule's choice with a fixed reason.
    Never raises. OWNER: track C."""
    raise NotImplementedError
