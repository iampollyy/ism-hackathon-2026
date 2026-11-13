"""Director job: scenario plus person to the brief for one call. OWNER: track C.

The director only improves on the scenario's filled template; the template
alone makes a complete call. The caller (briefs.build_brief, track A) runs
the code checks on what comes back and keeps the template if they fail.
"""

import json
import logging
from typing import Any

from app.agents import llm
from app.agents.shapes import Brief
from app.schemas import TACTICS

log = logging.getLogger("app.agents.director")

JOB = "director"
PROMPT_VERSION = "director.v1"
MAX_TACTICS = 3
TEXT_FIELDS = ("caller_claim", "address_as", "opening_line", "scenario_brief", "ask")


def _user_message(template_brief: dict[str, Any], context: dict[str, Any]) -> str:
    person = {
        "name": context.get("target_name"),
        "place_in_family": context.get("relationship"),
        "weak_spot": context.get("weak_spot"),
        "said": context.get("said"),
        "tactics_that_worked_before": context.get("tactics_worked") or [],
    }
    caller = {"name": context.get("caller_name"), "relationship": context.get("caller_relationship")}
    return (
        f"<scenario_template>\n{json.dumps(template_brief, ensure_ascii=False, indent=2)}\n</scenario_template>\n"
        f"<person>\n{json.dumps(person, ensure_ascii=False, indent=2)}\n</person>\n"
        f"<caller>\n{json.dumps(caller, ensure_ascii=False)}\n</caller>\n"
        f"<difficulty>{context.get('difficulty', 1)}</difficulty>\n"
        f"<allowed_tactics>{', '.join(context.get('allowed_tactics') or TACTICS)}</allowed_tactics>"
    )


def clean_brief(brief: Brief, template_brief: dict[str, Any], allowed: list[str]) -> dict[str, Any] | None:
    """Keep only allowed tactics (at most three, no repeats); an empty text
    field takes the template's. None if nothing usable is left."""
    result: dict[str, Any] = {}
    for field in TEXT_FIELDS:
        value = " ".join(str(getattr(brief, field) or "").split())
        result[field] = value or template_brief.get(field, "")
    tactics: list[str] = []
    for key in brief.tactic_order:
        if key in allowed and key not in tactics:
            tactics.append(key)
    result["tactic_order"] = tactics[:MAX_TACTICS] or list(template_brief.get("tactic_order") or [])
    if not all(result[field] for field in TEXT_FIELDS):
        return None
    return result


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
    try:
        allowed = [key for key in (context.get("allowed_tactics") or TACTICS) if key in TACTICS]
        result = await llm.run_job(
            JOB,
            system=llm.load_prompt(JOB),
            user=_user_message(template_brief, context),
            schema=Brief,
            prompt_version=PROMPT_VERSION,
            max_tokens=4000,
        )
        if isinstance(result, Brief):
            return clean_brief(result, template_brief, allowed)
    except Exception:
        log.exception("director failed; the template is kept")
    return None
