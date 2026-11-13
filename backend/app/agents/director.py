"""Director job: scenario plus person to the brief for one call. OWNER: track C."""

from typing import Any


async def improve_brief(template_brief: dict[str, Any], context: dict[str, Any]) -> dict[str, Any] | None:
    """Ask the director model (4 s limit per model) to improve the scenario's
    filled template for this person.

    template_brief: caller_claim, address_as, opening_line, scenario_brief,
      ask, tactic_order (list of tactic keys).
    context: target_name, relationship, weak_spot, said, tactics_worked
      (list), caller_name, caller_relationship, difficulty, allowed_tactics.
    Returns a dict with the same keys as template_brief, or None on any
    failure or timeout (the caller then keeps the template). Never raises.
    The caller (briefs.build_brief) runs the code checks on the result.
    OWNER: track C."""
    return None
