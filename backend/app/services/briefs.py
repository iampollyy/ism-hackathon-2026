"""Builds the brief for one practice call. OWNER: track A."""

from dataclasses import dataclass

from sqlalchemy.orm import Session as DbSession

from app.models import Member


@dataclass
class BuiltBrief:
    variables: dict[str, str | int]  # the practice agent's dynamic variables, as sent
    caller_label: str  # what the phone shows, e.g. "Unknown number"
    caller_number: str  # made up; never a real number or an institution's


async def build_brief(db: DbSession, target: Member, voice_member: Member | None,
                      scenario_key: str, difficulty: int) -> BuiltBrief:
    """Fill the scenario's template (services.scenarios.get_scenario) with the
    family's names, then try agents.director.improve_brief(template, context);
    use the director's brief only if it passes the code checks (no run of six
    or more digits, no listed real bank or institution, tactic keys from the
    fixed list, length limits). Variables: target_name, caller_claim,
    address_as, opening_line, scenario_brief, ask, tactic_order (a
    comma-separated string), difficulty, reveal_line (fixed wording, built in
    code, never by a model). Must never wait more than a few seconds and
    never fail: the template is the fallback.
    Reads only and commits nothing. It awaits the director, so the caller
    must hold no uncommitted writes when calling it (db.py, "Hard rule").
    OWNER: track A."""
    raise NotImplementedError
