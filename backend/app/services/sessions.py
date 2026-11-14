"""Builds the session object the phone page passes to startSession().
OWNER: track A.

- overrides carry only the voice: {"tts": {"voiceId": ...}} for a practice
  call (the voice member's clone, or the scenario's library voice), {} for
  welcome and family-line calls, and {} when no voice is set (the agent's
  own default voice speaks).
- dynamic_variables: every value a string or a number, never a safe word.
- max_seconds = schemas.MAX_SECONDS[kind]; reveal only for practice calls.
- A shield call (a practice call with a call_shield row, track 3) gets the
  shield reveal_line and reveal.kind "shield"; every other practice
  reveal.kind "practice".
"""

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.config import Settings, get_settings
from app.models import Call, CallEvent, Family, Member, Result
from app.services import briefs, elevenlabs, shield
from app.services import scenarios as scenario_files

log = logging.getLogger("app.sessions")

AGENT_SETTINGS = {
    "welcome": "elevenlabs_welcome_agent_id",
    "practice": "elevenlabs_practice_agent_id",
    "family_line": "elevenlabs_family_line_agent_id",
}

# What the family line tells the caller they did (ai.md: never blame).
OUTCOME_SENTENCES = {
    "asked_safe_word": "They asked for the family word, which is exactly the right check.",
    "hung_up": "They hung up to check, which is exactly the right thing to do.",
    "asked_personal_question": "They tested the caller with a question only the real person could answer.",
    "hesitated": "They hesitated and did not go along with it straight away.",
    "agreed": "They went along with the request at first, and calling the family number now is the right move.",
}

Variables = dict[str, str | int | float]


# ---------------------------------------------------------------- helpers


def agent_id_for(kind: str, settings: Settings) -> str:
    """The agent id for a kind of call. Raises ElevenLabsError (503
    agent_not_configured) if it is not set, unless ElevenLabs is faked."""
    if kind not in AGENT_SETTINGS:
        raise ValueError(f"unknown call kind {kind!r}")
    agent_id = getattr(settings, AGENT_SETTINGS[kind])
    if not agent_id and not settings.fake_elevenlabs:
        raise elevenlabs.ElevenLabsError(
            f"{AGENT_SETTINGS[kind].upper()} is not set, so a {kind} call cannot start.",
            status_code=503, code="agent_not_configured",
        )
    return agent_id


def _plain(value: Any) -> str | int | float:
    """A dynamic variable must be a string or a number."""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float, str)):
        return value
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    return json.dumps(value)


def plain_variables(values: dict[str, Any]) -> Variables:
    return {str(key): _plain(value) for key, value in values.items()}


def _family_members(db: DbSession, family_id: str) -> list[Member]:
    query = select(Member).where(Member.family_id == family_id).order_by(Member.created_at, Member.id)
    return list(db.execute(query).scalars())


def _organiser_name(db: DbSession, family_id: str, not_id: str | None = None) -> str | None:
    """The organiser's name; failing that, another member's (not `not_id`)."""
    members = _family_members(db, family_id)
    organiser = next((m for m in members if m.is_organiser), None)
    if organiser is not None:
        return organiser.name
    other = next((m for m in members if m.id != not_id), None)
    return other.name if other else None


def _family_name(db: DbSession, family_id: str) -> str:
    """The family's name without a leading "The" ("The Kovacs" -> "Kovacs"),
    because the prompts say "the {{family_name}} family"."""
    family = db.get(Family, family_id)
    return briefs.family_display_name(family.name) if family else ""


def usable_clone(member: Member | None) -> str | None:
    """The member's clone id, unless it is gone or its owner has opted out."""
    if member is None or not member.voice_id or member.opted_out_at:
        return None
    if member.voice_status in ("deleted", "failed"):
        return None
    return member.voice_id


# ---------------------------------------------------------------- per kind


def _stored_brief(call: Call) -> dict[str, Any] | None:
    if not call.brief_json:
        return None
    try:
        brief = json.loads(call.brief_json)
    except ValueError:
        log.error("call %s has a brief that is not JSON; using the template", call.id)
        return None
    return brief if isinstance(brief, dict) else None


def practice_parts(db: DbSession, call: Call, settings: Settings
                   ) -> tuple[dict[str, Any], Variables, schemas.Reveal]:
    """(overrides, dynamic_variables, reveal) for a practice call."""
    target = db.get(Member, call.target_member_id)
    if target is None:
        raise ValueError(f"call {call.id} has no target member")
    # The call was created with this voice owner's consent (the gate), so the
    # reveal names them. If their clone has since gone, another voice speaks.
    voice_member = db.get(Member, call.voice_member_id) if call.voice_member_id else None
    voice_name = voice_member.name if voice_member else None
    clone_id = usable_clone(voice_member)
    if voice_member is not None and clone_id is None:
        log.warning("call %s: %s's clone is not usable; another voice speaks", call.id, voice_member.name)

    scenario = scenario_files.get_scenario(call.scenario or "") or {}
    voice_id = clone_id or scenario_files.library_voice_id(scenario, settings)
    overrides: dict[str, Any] = {"tts": {"voiceId": voice_id}} if voice_id else {}

    brief = _stored_brief(call)
    if brief is None:
        brief = briefs.template_brief(db, target, voice_member,
                                      call.scenario or briefs.FALLBACK_SCENARIO, call.difficulty).variables
    variables = plain_variables(brief)
    variables.setdefault("target_name", target.name)
    variables.setdefault("difficulty", call.difficulty)
    # Always the fixed wording, matching the voice that really speaks. A
    # shield call (track 3) reveals itself as a simulated scam call.
    is_shield = shield.is_shield_call(db, call.id)
    variables["reveal_line"] = briefs.reveal_line(target.name, voice_name, shield=is_shield)
    return overrides, variables, schemas.Reveal(voice_of=voice_name, kind="shield" if is_shield else "practice")


def welcome_variables(db: DbSession, call: Call) -> Variables:
    target = db.get(Member, call.target_member_id)
    if target is None:
        raise ValueError(f"call {call.id} has no target member")
    return {
        "member_name": target.name,
        "organiser_name": _organiser_name(db, target.family_id, not_id=target.id) or target.name,
        "family_name": _family_name(db, target.family_id),
    }


def _first_outcome(db: DbSession, practice: Call) -> str | None:
    result = db.get(Result, practice.id)
    if result is not None:
        return result.outcome
    query = (select(CallEvent.data_json)
             .where(CallEvent.call_id == practice.id, CallEvent.type == "outcome")
             .order_by(CallEvent.seq).limit(1))
    raw = db.execute(query).scalar_one_or_none()
    if raw:
        try:
            outcome = json.loads(raw).get("outcome")
        except (ValueError, AttributeError):
            outcome = None
        if outcome in schemas.OUTCOMES:
            return outcome
    return "hung_up" if practice.ended_by == "user" else None


def describe_practice(db: DbSession, practice: Call | None) -> str:
    """One or two sentences for the family line: the call, and what they did."""
    if practice is None:
        return "It was a Callback practice call."
    voice_member = db.get(Member, practice.voice_member_id) if practice.voice_member_id else None
    scenario = scenario_files.get_scenario(practice.scenario or "") or {}
    voice_part = f" in {voice_member.name}'s voice" if voice_member else ""
    summary = scenario.get("summary")
    text = f"It was a practice call{voice_part}" + (f" {summary}." if summary else ".")
    outcome = _first_outcome(db, practice)
    if outcome in OUTCOME_SENTENCES:
        text += " " + OUTCOME_SENTENCES[outcome]
    return text


def family_line_variables(db: DbSession, call: Call) -> Variables:
    caller = db.get(Member, call.target_member_id)
    if caller is None:
        raise ValueError(f"call {call.id} has no member")
    practice = db.get(Call, call.parent_call_id) if call.parent_call_id else None
    relative = None
    if practice is not None and practice.voice_member_id:
        relative = db.get(Member, practice.voice_member_id)
    relative_name = relative.name if relative else _organiser_name(db, caller.family_id, not_id=caller.id)
    return {
        "caller_name": caller.name,
        "relative_name": relative_name or "your family",
        "what_happened": describe_practice(db, practice),
        "family_name": _family_name(db, caller.family_id),
    }


# ---------------------------------------------------------------- the session


async def build_session(db: DbSession, call: Call) -> schemas.Session:
    """Build the session for a call that is being answered (or a family-line
    call that is starting).

    The caller commits its own writes (status, answered_at, a new family_line
    row) BEFORE calling this, because it awaits the network: never hold
    uncommitted writes across an await (db.py, "Hard rule"). Everything is
    read first; only after the token arrives is call.conversation_id set and
    committed. Raises elevenlabs.ElevenLabsError if the token cannot be had
    (503 agent_not_configured when the agent id is not set)."""
    settings = get_settings()
    agent_id = agent_id_for(call.kind, settings)

    overrides: dict[str, Any] = {}
    reveal: schemas.Reveal | None = None
    if call.kind == "practice":
        overrides, variables, reveal = practice_parts(db, call, settings)
    elif call.kind == "welcome":
        variables = welcome_variables(db, call)
    else:
        variables = family_line_variables(db, call)

    token = await elevenlabs.conversation_token(agent_id)

    if token.conversation_id:
        call.conversation_id = token.conversation_id
        db.commit()
    return schemas.Session(
        kind=call.kind,
        conversation_token=token.token,
        conversation_id=token.conversation_id,
        overrides=overrides,
        dynamic_variables=variables,
        max_seconds=schemas.MAX_SECONDS[call.kind],
        reveal=reveal,
    )
