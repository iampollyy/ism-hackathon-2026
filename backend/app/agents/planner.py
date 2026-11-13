"""Planner job: profiles and results to each person's plan. OWNER: track C.

The code sets the limits (readiness.next_practice: which scenarios, the
highest difficulty; and whose voice may be used); the model chooses within
them and writes the words. Anything outside the limits is replaced by the
rule's choice. Fallback (ai.md): the rule's choice with a fixed sentence as
the reason.

family_input, built by services.pipeline.planner_input():
{
  "family_name": "The Kovacs",
  "safe_word_set": true,
  "members": [{
     "member_id": "mem_...", "name": "Sara", "relationship": "mother",
     "profile": {...} or None,             # members.profile_json
     "results": [{scenario, difficulty, outcome, tactics_worked,
                  seconds_to_challenge}],  # oldest first
     "allowed": {"scenarios": [...],       # for the next practice, rule's pick first
                 "later_scenarios": [...], # every scenario that exists
                 "clone_scenarios": [...], # the ones spoken in a relative's voice
                 "max_difficulty": 1,
                 "voices": ["Jon"]},       # relatives with a ready clone and consent
     "rule": {"scenario", "difficulty", "voice_of", "reason"}
  }]
}
"""

import json
import logging
from typing import Any

from app.agents import llm
from app.agents.shapes import FamilyPlan, MemberPlan
from app.services import readiness

log = logging.getLogger("app.agents.planner")

JOB = "planner"
PROMPT_VERSION = "planner.v1"
MAX_STEPS = 3
MAX_FAMILY_TASKS = 3

FALLBACK_THIS_WEEK = "Save the family number in your phone, so you can ring it after any call that asks for money."
FALLBACK_WEAK_SPOT = "Pausing to check before acting on an urgent call."
FAMILY_TASKS_NO_WORD = [
    "Agree a family word together, in person, and never write it down or say it on a call.",
    "Save the family number in every phone.",
    "Agree that anyone who gets an urgent money call hangs up and rings the family number first.",
]
FAMILY_TASKS_WITH_WORD = [
    "Check together, in person, that everyone still remembers the family word.",
    "Save the family number in every phone.",
    "Agree that anyone who gets an urgent money call hangs up and rings the family number first.",
]


def _weak_spot(member: dict[str, Any]) -> str:
    profile = member.get("profile") or {}
    return str(profile.get("weak_spot") or "").strip() or FALLBACK_WEAK_SPOT


def rule_step(member: dict[str, Any]) -> dict[str, Any]:
    rule = member.get("rule") or {}
    return {
        "when": "today",
        "scenario": rule.get("scenario") or readiness.DEFAULT_SCENARIO,
        "difficulty": readiness.clamp_difficulty(rule.get("difficulty")),
        "voice_of": rule.get("voice_of"),
        "why": readiness.REASONS.get(rule.get("reason", ""), readiness.REASONS["first"]),
        "status": "planned",
    }


def fallback_member_plan(member: dict[str, Any]) -> dict[str, Any]:
    return {
        "member_id": member["member_id"],
        "weak_spot": _weak_spot(member),
        "this_week": FALLBACK_THIS_WEEK,
        "steps": [rule_step(member)],
        "source": "fallback",
    }


def fallback_family_tasks(safe_word_set: bool) -> list[str]:
    return list(FAMILY_TASKS_WITH_WORD if safe_word_set else FAMILY_TASKS_NO_WORD)


def fallback_plan(family_input: dict[str, Any]) -> dict[str, Any]:
    return {
        "members": [fallback_member_plan(member) for member in family_input.get("members") or []],
        "family_tasks": fallback_family_tasks(bool(family_input.get("safe_word_set"))),
    }


def _clean_voice(voice_of: str | None, scenario: str, allowed: dict[str, Any], rule_voice: str | None) -> str | None:
    """A relative's voice only in a clone scenario, and only one allowed."""
    if scenario not in (allowed.get("clone_scenarios") or []):
        return None
    voices = allowed.get("voices") or []
    if voice_of in voices:
        return voice_of
    return rule_voice if rule_voice in voices else (voices[0] if voices else None)


def _clean_step(step: Any, index: int, member: dict[str, Any]) -> dict[str, Any] | None:
    """One planned step within the limits, or None to drop it. The first step
    must use a scenario allowed for the next practice."""
    allowed = member.get("allowed") or {}
    rule = member.get("rule") or {}
    choices = allowed.get("scenarios") if index == 0 else allowed.get("later_scenarios")
    scenario = step.scenario
    if scenario not in (choices or []):
        if index > 0:
            return None
        scenario = rule.get("scenario") or readiness.DEFAULT_SCENARIO
    max_difficulty = readiness.clamp_difficulty(allowed.get("max_difficulty", 1))
    why = " ".join(str(step.why or "").split()) or readiness.REASONS.get(rule.get("reason", ""), "")
    return {
        "when": " ".join(str(step.when or "").split()) or "today",
        "scenario": scenario,
        "difficulty": min(readiness.clamp_difficulty(step.difficulty), max_difficulty),
        "voice_of": _clean_voice(step.voice_of, scenario, allowed, rule.get("voice_of")),
        "why": why,
        "status": "planned",
    }


def clean_member_plan(plan: MemberPlan, member: dict[str, Any]) -> dict[str, Any]:
    steps = []
    for step in plan.steps[:MAX_STEPS]:
        cleaned = _clean_step(step, len(steps), member)
        if cleaned is not None:
            steps.append(cleaned)
    return {
        "member_id": member["member_id"],
        "weak_spot": " ".join(str(plan.weak_spot or "").split()) or _weak_spot(member),
        "this_week": " ".join(str(plan.this_week or "").split()) or FALLBACK_THIS_WEEK,
        "steps": steps or [rule_step(member)],
        "source": PROMPT_VERSION,
    }


def clean_plan(plan: FamilyPlan, family_input: dict[str, Any]) -> dict[str, Any]:
    """Every requested member gets a plan: the model's, checked, or the rule's."""
    by_id = {item.member_id: item for item in plan.members}
    members = []
    for member in family_input.get("members") or []:
        model_plan = by_id.get(member["member_id"])
        members.append(clean_member_plan(model_plan, member) if model_plan else fallback_member_plan(member))
    tasks = [" ".join(str(task).split()) for task in plan.family_tasks if str(task).strip()]
    if len(tasks) < 2:
        tasks = fallback_family_tasks(bool(family_input.get("safe_word_set")))
    return {"members": members, "family_tasks": tasks[:MAX_FAMILY_TASKS]}


def _user_message(family_input: dict[str, Any]) -> str:
    blocks = [f"<family>{family_input.get('family_name', '')}; family word agreed: "
              f"{'yes' if family_input.get('safe_word_set') else 'no'}</family>"]
    for member in family_input.get("members") or []:
        view = {key: member.get(key) for key in ("member_id", "name", "relationship", "profile", "results", "allowed")}
        if isinstance(view.get("profile"), dict):
            view["profile"] = {k: v for k, v in view["profile"].items() if k != "source"}
        blocks.append(f"<member>\n{json.dumps(view, ensure_ascii=False, indent=2)}\n</member>")
    return "\n".join(blocks)


async def plan_family(family_input: dict[str, Any]) -> dict[str, Any]:
    """Return an ai.md `FamilyPlan` as a dict (members[MemberPlan],
    family_tasks). Each step also has status "planned", and each member plan
    a `source` (the prompt version, or "fallback"). Fallback: the rule's
    choice with a fixed reason. Never raises. OWNER: track C."""
    try:
        if not family_input.get("members"):
            return fallback_plan(family_input)
        result = await llm.run_job(
            JOB,
            system=llm.load_prompt(JOB),
            user=_user_message(family_input),
            schema=FamilyPlan,
            prompt_version=PROMPT_VERSION,
        )
        if isinstance(result, FamilyPlan):
            return clean_plan(result, family_input)
    except Exception:
        log.exception("planner failed; using the rule's plan")
    try:
        return fallback_plan(family_input)
    except Exception:
        log.exception("planner fallback failed")
        return {"members": [], "family_tasks": fallback_family_tasks(False)}
