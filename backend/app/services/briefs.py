"""Builds the brief for one practice call. OWNER: track A.

The brief is the practice agent's dynamic variables (ai.md, "Variables"):
target_name, caller_claim, address_as, opening_line, scenario_brief, ask,
tactic_order (one comma-separated string), difficulty and reveal_line.

1. The scenario's template, with the family's names filled in. This alone
   makes a complete call and is the fallback for everything below.
2. The director job (track C) may improve it, within DIRECTOR_TIMEOUT_SECONDS.
3. The improved brief is used only if it passes the code checks of
   backend.md rule 4 (brief_problems below); otherwise the template is used.
reveal_line is fixed wording built here, never by a model.
"""

import asyncio
import json
import logging
import random
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.agents import director
from app.models import Call, Family, Member, Result
from app.services import scenarios as scenario_files

log = logging.getLogger("app.briefs")

DIRECTOR_TIMEOUT_SECONDS = 4.0
FALLBACK_SCENARIO = "relative_new_number"

TEXT_FIELDS = ("caller_claim", "address_as", "opening_line", "scenario_brief", "ask")
# Longest allowed value per field: (characters, words). A little above what
# the director prompt asks for, so a good brief is never refused for one word.
LIMITS: dict[str, tuple[int, int]] = {
    "caller_claim": (120, 20),
    "address_as": (40, 5),
    "opening_line": (160, 25),
    "scenario_brief": (500, 80),
    "ask": (200, 35),
}
MAX_TACTICS = 3

# Six or more digits in a row, also when split by spaces, dashes, dots or
# slashes, as in a card or account number ("4111 1111 1111 1111").
DIGIT_RUN = re.compile(r"\d(?:[ \-./]?\d){5,}")
LINK = re.compile(r"https?://|www\.|\.(?:com|net|org|eu|de|uk)\b", re.IGNORECASE)
# Injuries, accidents, arrests, kidnappings, deaths and emergencies (ai.md
# guardrails). Whole words only, so "deadline" still passes.
FORBIDDEN_TOPIC = re.compile(
    r"\b(?:accident\w*|injur\w*|arrest\w*|kidnap\w*|death|killed|murder\w*"
    r"|died|dies|dying|dead|jail\w*|prison\w*|custody|emergenc\w*|crash\w*"
    r"|hit by|ambulance\w*|A&E|intensive care|hospitali[sz]ed|in hospital)\b",
    re.IGNORECASE,
)
# A short list of real banks, payment firms, police forces and other
# institutions that a brief must never name (matched as whole words).
INSTITUTIONS = (
    "barclays", "hsbc", "lloyds", "natwest", "santander", "halifax", "nationwide", "monzo",
    "revolut", "starling", "n26", "deutsche bank", "commerzbank", "sparkasse", "volksbank",
    "postbank", "raiffeisen", "erste bank", "ing bank", "ing-diba", "dkb", "comdirect",
    "bnp paribas", "societe generale", "société générale", "credit agricole", "crédit agricole",
    "unicredit", "intesa sanpaolo", "bbva", "caixabank", "rabobank", "abn amro", "ubs",
    "credit suisse", "jpmorgan", "jp morgan", "chase bank", "bank of america", "wells fargo",
    "citibank", "capital one", "american express", "amex", "visa", "mastercard", "paypal",
    "western union", "moneygram", "klarna", "europol", "interpol", "fbi",
    "scotland yard", "metropolitan police", "met police", "bundespolizei", "bka", "nhs",
    "hmrc", "irs", "finanzamt", "red cross", "charité", "charite", "amazon", "apple",
    "microsoft", "google", "dhl", "fedex", "royal mail", "deutsche post",
)
INSTITUTION_PATTERN = re.compile(
    r"\b(?:" + "|".join(re.escape(name) for name in INSTITUTIONS) + r")\b", re.IGNORECASE,
)


@dataclass
class BuiltBrief:
    variables: dict[str, str | int]  # the practice agent's dynamic variables, as sent
    caller_label: str  # what the phone shows, e.g. "Unknown number"
    caller_number: str  # made up; never a real number or an institution's


# ---------------------------------------------------------------- fixed wording


def reveal_line(target_name: str, voice_name: str | None) -> str:
    """The reveal, exactly as in ai.md. Never written by a model."""
    line = f"{target_name}, this was a Callback practice call. The voice you heard was artificial"
    if voice_name:
        return f"{line}, made with {voice_name}'s permission."
    return f"{line}."


def make_caller_number() -> str:
    """A made-up number in the style of "+00 600 555 0142": +00 is no country's
    code, and 555 01xx is a range kept for fiction."""
    return f"+00 {random.randint(600, 699)} 555 {random.randint(100, 199):04d}"


def family_display_name(name: str) -> str:
    """"The Kovacs" or "Kovacs family" -> "Kovacs", so a prompt can say
    "the Kovacs family"."""
    name = name.strip()
    if name.lower().startswith("the ") and len(name) > 4:
        name = name[4:].strip()
    if name.lower().endswith(" family") and len(name) > 7:
        name = name[:-7].strip()
    return name


# ---------------------------------------------------------------- relationships

# word -> (generation, gender). Generation: 2 grandparents, 1 parents,
# 0 children, siblings and grandchildren (a family list names its youngest
# as the grandparents' grandchildren). Gender: "f", "m" or "".
FAMILY_WORDS: dict[str, tuple[int, str]] = {
    "grandmother": (2, "f"), "grandma": (2, "f"), "gran": (2, "f"), "granny": (2, "f"),
    "nan": (2, "f"), "nana": (2, "f"), "grandfather": (2, "m"), "grandpa": (2, "m"),
    "grandad": (2, "m"), "granddad": (2, "m"), "grandparent": (2, ""),
    "mother": (1, "f"), "mum": (1, "f"), "mom": (1, "f"), "mama": (1, "f"),
    "father": (1, "m"), "dad": (1, "m"), "papa": (1, "m"), "parent": (1, ""),
    "son": (0, "m"), "daughter": (0, "f"), "child": (0, ""),
    "brother": (0, "m"), "sister": (0, "f"), "sibling": (0, ""),
    "grandson": (0, "m"), "granddaughter": (0, "f"), "grandchild": (0, ""),
}
# generation difference (person minus other) -> (female, male, neutral)
RELATION_TERMS: dict[int, tuple[str, str, str]] = {
    2: ("grandmother", "grandfather", "grandparent"),
    1: ("mother", "father", "parent"),
    0: ("sister", "brother", "sibling"),
    -1: ("daughter", "son", "child"),
    -2: ("granddaughter", "grandson", "grandchild"),
}
ADDRESS_TERMS = {"mother": "Mum", "father": "Dad", "grandmother": "Gran", "grandfather": "Grandad"}


def relation_of(person_word: str, other_word: str) -> str:
    """What `person` is to `other`, from each one's place in the family.
    relation_of("son", "mother") == "son"; relation_of("daughter", "son") == "sister"."""
    person = FAMILY_WORDS.get(person_word.strip().lower())
    other = FAMILY_WORDS.get(other_word.strip().lower())
    if person is None:
        return person_word.strip().lower() or "relative"
    if other is None:
        return "relative"
    generation, gender = person
    difference = generation - other[0]
    if difference == 0 and generation >= 1:
        return "partner"
    terms = RELATION_TERMS.get(difference)
    if terms is None:
        return "relative"
    female, male, neutral = terms
    return {"f": female, "m": male}.get(gender, neutral)


def address_as(target: Member, caller_relationship_word: str) -> str:
    """What the caller would call the target: "Mum", "Dad", "Gran", or their name."""
    term = relation_of(target.relationship, caller_relationship_word)
    return ADDRESS_TERMS.get(term, target.name)


# ---------------------------------------------------------------- the template


class _Blank(dict):
    """format_map helper: an unknown placeholder becomes empty, never a crash."""

    def __missing__(self, key: str) -> str:
        log.warning("scenario template uses an unknown placeholder {%s}", key)
        return ""


def _load_scenario(scenario_key: str) -> dict[str, Any]:
    scenario = scenario_files.get_scenario(scenario_key)
    if scenario is None:
        log.error("no scenario %r; using %s", scenario_key, FALLBACK_SCENARIO)
        scenario = scenario_files.get_scenario(FALLBACK_SCENARIO)
    if scenario is None:
        raise RuntimeError(f"scenario file {FALLBACK_SCENARIO}.json is missing")
    return scenario


def _family_members(db: DbSession, family_id: str) -> list[Member]:
    query = select(Member).where(Member.family_id == family_id).order_by(Member.created_at, Member.id)
    return list(db.execute(query).scalars())


def _claimed_caller(db: DbSession, target: Member, voice_member: Member | None,
                    scenario: dict[str, Any]) -> tuple[str, str]:
    """(caller name, caller's place in the family word) for the story.
    The voice's owner if there is one; for the relative story without a clone,
    the organiser or another member; otherwise the scenario's default caller."""
    default = scenario.get("default_caller") or {}
    default_pair = (str(default.get("name") or "Sam"), str(default.get("relationship") or "relative"))
    if not scenario_files.uses_clone(scenario):
        return default_pair
    if voice_member is not None:
        return voice_member.name, voice_member.relationship
    others = [m for m in _family_members(db, target.family_id) if m.id != target.id and not m.opted_out_at]
    others.sort(key=lambda m: not m.is_organiser)
    if others:
        return others[0].name, others[0].relationship
    return default_pair


def _placeholders(db: DbSession, target: Member, voice_member: Member | None,
                  scenario: dict[str, Any]) -> dict[str, str]:
    caller_name, caller_word = _claimed_caller(db, target, voice_member, scenario)
    is_family_caller = scenario_files.uses_clone(scenario)
    family = db.get(Family, target.family_id)
    return {
        "target_name": target.name,
        "target_relation_to_caller": target.name,
        "caller_name": caller_name,
        "caller_relationship": relation_of(caller_word, target.relationship) if is_family_caller else caller_word,
        "address_as": address_as(target, caller_word) if is_family_caller else target.name,
        "family_name": family_display_name(family.name) if family else "",
    }


def fill_template(scenario: dict[str, Any], values: dict[str, str]) -> dict[str, Any]:
    """The scenario's template with the placeholders filled in."""
    template = scenario["template"]
    filled: dict[str, Any] = {}
    for field in TEXT_FIELDS:
        raw = template.get(field, "{address_as}" if field == "address_as" else "")
        filled[field] = " ".join(str(raw).format_map(_Blank(values)).split())
    allowed = scenario.get("allowed_tactics") or list(schemas.TACTICS)
    order = [key for key in template.get("tactic_order", []) if key in schemas.TACTICS and key in allowed]
    filled["tactic_order"] = order[:MAX_TACTICS] or [key for key in allowed if key in schemas.TACTICS][:1]
    return filled


# ---------------------------------------------------------------- the checks


def _tactic_list(value: Any) -> list[str] | None:
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return [item.strip() for item in value]
    return None


def brief_problems(brief: Any, allowed_tactics: list[str]) -> list[str]:
    """Everything wrong with a brief (backend.md rule 4); empty means it may be sent."""
    if not isinstance(brief, dict):
        return ["the brief is not an object"]
    problems: list[str] = []
    for field in TEXT_FIELDS:
        value = brief.get(field)
        if not isinstance(value, str) or not value.strip():
            problems.append(f"{field} is missing or empty")
            continue
        max_chars, max_words = LIMITS[field]
        if len(value) > max_chars or len(value.split()) > max_words:
            problems.append(f"{field} is too long")
        if DIGIT_RUN.search(value):
            problems.append(f"{field} has a run of six or more digits")
        if INSTITUTION_PATTERN.search(value):
            problems.append(f"{field} names a real institution")
        if LINK.search(value):
            problems.append(f"{field} has a link")
        if FORBIDDEN_TOPIC.search(value):
            problems.append(f"{field} mentions an emergency the rules forbid")
        if "{" in value or "}" in value:
            problems.append(f"{field} has a brace")
    tactics = _tactic_list(brief.get("tactic_order"))
    if not tactics:
        problems.append("tactic_order is missing or empty")
    else:
        if len(tactics) > MAX_TACTICS:
            problems.append(f"tactic_order has more than {MAX_TACTICS} tactics")
        if len(set(tactics)) != len(tactics):
            problems.append("tactic_order repeats a tactic")
        unknown = [key for key in tactics if key not in schemas.TACTICS or key not in allowed_tactics]
        if unknown:
            problems.append(f"tactic_order has keys outside the allowed list: {unknown}")
    return problems


def _clean(brief: dict[str, Any]) -> dict[str, Any]:
    """Only the six brief fields, tidied."""
    cleaned: dict[str, Any] = {field: " ".join(str(brief[field]).split()) for field in TEXT_FIELDS}
    cleaned["tactic_order"] = _tactic_list(brief["tactic_order"]) or []
    return cleaned


# ---------------------------------------------------------------- the director


def _json_field(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _tactics_that_worked(db: DbSession, member_id: str) -> list[str]:
    query = (
        select(Result.tactics_worked_json)
        .join(Call, Call.id == Result.call_id)
        .where(Call.target_member_id == member_id)
        .order_by(Result.created_at.desc())
        .limit(5)
    )
    worked: list[str] = []
    for raw in db.execute(query).scalars():
        try:
            keys = json.loads(raw or "[]")
        except ValueError:
            continue
        for key in keys if isinstance(keys, list) else []:
            if key in schemas.TACTICS and key not in worked:
                worked.append(key)
    return worked


def director_context(db: DbSession, target: Member, values: dict[str, str],
                     scenario: dict[str, Any], difficulty: int) -> dict[str, Any]:
    plan = _json_field(target.plan_json)
    profile = _json_field(target.profile_json)
    return {
        "target_name": target.name,
        "relationship": target.relationship,
        "weak_spot": plan.get("weak_spot") or profile.get("weak_spot") or "",
        "said": profile.get("said") or "",
        "tactics_worked": _tactics_that_worked(db, target.id),
        "caller_name": values["caller_name"],
        "caller_relationship": values["caller_relationship"],
        "difficulty": difficulty,
        "allowed_tactics": list(scenario.get("allowed_tactics") or []),
        "scenario": scenario["key"],
        "scenario_title": scenario.get("title", ""),
    }


async def _improve(template: dict[str, Any], context: dict[str, Any]) -> Any:
    """The director's brief, or None on any failure or after the time limit."""
    try:
        return await asyncio.wait_for(director.improve_brief(dict(template), dict(context)),
                                      timeout=DIRECTOR_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        log.warning("the director took longer than %.0f s; using the template", DIRECTOR_TIMEOUT_SECONDS)
    except Exception:
        log.exception("the director failed; using the template")
    return None


# ---------------------------------------------------------------- building


def _variables(target: Member, voice_member: Member | None, brief: dict[str, Any],
               difficulty: int) -> dict[str, str | int]:
    return {
        "target_name": target.name,
        "caller_claim": brief["caller_claim"],
        "address_as": brief["address_as"],
        "opening_line": brief["opening_line"],
        "scenario_brief": brief["scenario_brief"],
        "ask": brief["ask"],
        "tactic_order": ", ".join(brief["tactic_order"]),
        "difficulty": difficulty,
        "reveal_line": reveal_line(target.name, voice_member.name if voice_member else None),
    }


def _built(target: Member, voice_member: Member | None, scenario: dict[str, Any],
           brief: dict[str, Any], difficulty: int) -> BuiltBrief:
    return BuiltBrief(
        variables=_variables(target, voice_member, brief, difficulty),
        caller_label=str(scenario.get("caller_label") or "Unknown number"),
        caller_number=make_caller_number(),
    )


def _clamp_difficulty(difficulty: int) -> int:
    try:
        return min(3, max(1, int(difficulty)))
    except (TypeError, ValueError):
        return 1


def template_brief(db: DbSession, target: Member, voice_member: Member | None,
                   scenario_key: str, difficulty: int) -> BuiltBrief:
    """The brief from the scenario's template alone, with no model. Reads only."""
    scenario = _load_scenario(scenario_key)
    values = _placeholders(db, target, voice_member, scenario)
    level = _clamp_difficulty(difficulty)
    return _built(target, voice_member, scenario, fill_template(scenario, values), level)


async def build_brief(db: DbSession, target: Member, voice_member: Member | None,
                      scenario_key: str, difficulty: int) -> BuiltBrief:
    """Fill the scenario's template with the family's names, then let the
    director improve it; keep the director's brief only if it passes the
    checks. Never waits more than DIRECTOR_TIMEOUT_SECONDS on the model and
    never fails because of it: the template is the fallback.
    Reads only and commits nothing. It awaits the director, so the caller
    must hold no uncommitted writes when calling it (db.py, "Hard rule")."""
    scenario = _load_scenario(scenario_key)
    level = _clamp_difficulty(difficulty)
    values = _placeholders(db, target, voice_member, scenario)
    template = fill_template(scenario, values)
    context = director_context(db, target, values, scenario, level)

    improved = await _improve(template, context)
    brief = template
    if improved is not None:
        problems = brief_problems(improved, list(scenario.get("allowed_tactics") or []))
        if problems:
            log.warning("director brief refused, using the template: %s", "; ".join(problems))
        else:
            brief = _clean(improved)
    return _built(target, voice_member, scenario, brief, level)
