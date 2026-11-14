"""The weekly run, once, for one family. OWNER: track C.

POST /api/families/{id}/weekly-run (backend.md flow 6):
1. This week's digest: one row per ISO week, shared by all families.
   Firecrawl fetches public scam-warning pages (or returns its built-in pages
   without a key) and the digest job reduces them. If the job gives nothing
   (no model key, an error), last week's digest is used, and without one a
   small built-in list of patterns. Such a fallback is stored as this week's
   row, marked as a fallback, and replaced by the next run that gets a real
   digest.
2. One action per member, by rule:
   - no practice consent: a reminder (a family task);
   - a planned step in their plan: a practice, created as a scheduled call;
   - otherwise: a weekly message, one digest pattern written for them.
3. Messages go to `messages` and appear on the phone at its next poll.

Practices are created only with calls.create_practice(..., check_phone_online=False),
which holds the consent gate. If it raises ApiError (no consent, voice not
ready, busy), the member gets a reminder message instead. Every await is
made with no uncommitted writes (db.py, "Hard rule").
"""

import asyncio
import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas
from app.agents import digest as digest_job
from app.agents import planner as planner_job
from app.db import get_db, new_session, now_iso, utcnow
from app.models import Digest, Family, Member, Message
from app.routers import calls
from app.services import firecrawl, readiness
from app.services import scenarios as scenario_files

router = APIRouter(tags=["weekly"])
log = logging.getLogger("app.weekly")

# Public pages with current scam warnings (fetched through Firecrawl).
WARNING_URLS = [
    "https://consumer.ftc.gov/consumer-alerts",
    "https://www.actionfraud.police.uk/news",
    "https://www.ic3.gov/PSA",  # the FBI's public alerts
    "https://www.scamwatch.gov.au/news-alerts",
]

# A stored digest whose sources are this marker is a fallback, not a real digest.
FALLBACK_SOURCE = "fallback"

# Used when there is no digest at all (no model, nothing stored). The same
# scams as firecrawl.BUILTIN_PAGES, written by us in our own words.
FALLBACK_PATTERNS: list[dict[str, Any]] = [
    {
        "title": "Callers posing as a bank's security team",
        "summary": "A caller says a suspicious payment was blocked and asks you to read out the code "
                   "that was just sent to your phone.",
        "tactics": ["authority", "small_ask_first", "urgency"],
        "closest_scenario": "bank_security",
        "source_url": "builtin:bank-security-calls",
    },
    {
        "title": "A relative in trouble, from a new number",
        "summary": "Someone sounding like a family member says they lost their phone and need money "
                   "sent today, and asks you not to tell anyone.",
        "tactics": ["new_number", "urgency", "emotional_appeal", "secrecy"],
        "closest_scenario": "relative_new_number",
        "source_url": "builtin:relative-new-number",
    },
    {
        "title": "Fake police asking you to move your savings",
        "summary": "A caller claiming to be the police says your money is at risk and asks you to move it "
                   "to a 'safe account' without telling your bank.",
        "tactics": ["authority", "secrecy", "isolation", "unusual_payment"],
        "closest_scenario": "police",
        "source_url": "builtin:police-safe-account",
    },
]

TODAY_DELAY_SECONDS = 120  # "today": rings in two minutes, so the person doesn't know when
MAX_DELAY_SECONDS = 7 * 24 * 3600
UNIT_SECONDS = {"minute": 60, "hour": 3600, "day": 86400, "week": 7 * 86400}
WORD_NUMBERS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7}


# ---------------------------------------------------------------- the endpoint


@router.post("/families/{family_id}/weekly-run", response_model=schemas.WeeklyRunResult)
async def weekly_run(family_id: str, db: Session = Depends(get_db)) -> schemas.WeeklyRunResult:
    family = db.get(Family, family_id)
    if family is None:
        raise schemas.ApiError(404, "not_found", "No family with this id.")
    db.commit()  # nothing pending while Firecrawl and the models run
    week, patterns = await this_weeks_digest()
    actions = await act_for_family(db, family, patterns)
    return schemas.WeeklyRunResult(
        digest=schemas.DigestView(week=week, patterns=pattern_views(patterns)),
        actions=actions,
    )


# ---------------------------------------------------------------- the digest


def iso_week() -> str:
    year, week, _ = utcnow().isocalendar()
    return f"{year}-W{week:02d}"


def pattern_views(patterns: list[dict[str, Any]]) -> list[schemas.PatternView]:
    views = []
    for pattern in patterns:
        try:
            views.append(schemas.PatternView.model_validate(pattern))
        except ValueError:
            continue
    return views


def _stored_patterns(row: Digest) -> list[dict[str, Any]]:
    try:
        patterns = json.loads(row.tactics_json)
    except ValueError:
        return []
    return [p for p in patterns if isinstance(p, dict)] if isinstance(patterns, list) else []


def _is_fallback(row: Digest) -> bool:
    try:
        return json.loads(row.sources_json) == [FALLBACK_SOURCE]
    except ValueError:
        return False


def _week_digest(week: str) -> Digest | None:
    with new_session() as db:
        return db.scalars(select(Digest).where(Digest.week == week)
                          .order_by(Digest.created_at.desc(), Digest.id.desc()).limit(1)).first()


def _last_real_digest() -> Digest | None:
    """The newest digest that a model made (any week)."""
    with new_session() as db:
        for row in db.scalars(select(Digest).order_by(Digest.created_at.desc(), Digest.id.desc())):
            if not _is_fallback(row) and _stored_patterns(row):
                return row
    return None


def _save_digest(week: str, sources: list[str], patterns: list[dict[str, Any]]) -> None:
    """This week's one row: updated in place if it exists, else added."""
    with new_session() as db:
        row = db.scalars(select(Digest).where(Digest.week == week).limit(1)).first()
        if row is None:
            row = Digest(week=week, sources_json="[]", tactics_json="[]", created_at=now_iso())
            db.add(row)
        row.sources_json = json.dumps(sources)
        row.tactics_json = json.dumps(patterns)
        row.created_at = now_iso()
        db.commit()


async def this_weeks_digest() -> tuple[str, list[dict[str, Any]]]:
    """(week, patterns): this week's real digest if stored; else a new one
    from Firecrawl and the digest job; else this week's stored fallback,
    last week's digest, or the built-in patterns (stored as the fallback)."""
    week = iso_week()
    stored = _week_digest(week)
    if stored is not None and not _is_fallback(stored) and _stored_patterns(stored):
        return week, _stored_patterns(stored)
    pages = await firecrawl.fetch_warnings(WARNING_URLS)
    built = await digest_job.build_digest(pages) if pages else None
    if built and pattern_views(built["patterns"]):
        _try_save(week, [str(page.get("url")) for page in pages], built["patterns"])
        return week, built["patterns"]
    if stored is not None and _stored_patterns(stored):
        return week, _stored_patterns(stored)
    last = _last_real_digest()
    patterns = _stored_patterns(last) if last else [dict(pattern) for pattern in FALLBACK_PATTERNS]
    _try_save(week, [FALLBACK_SOURCE], patterns)
    return week, patterns


def _try_save(week: str, sources: list[str], patterns: list[dict[str, Any]]) -> None:
    try:
        _save_digest(week, sources, patterns)
    except Exception:
        log.exception("could not store the digest for %s", week)


# ---------------------------------------------------------------- one action per member


def _load_json(raw: str | None) -> dict[str, Any]:
    try:
        value = json.loads(raw) if raw else None
    except ValueError:
        value = None
    return value if isinstance(value, dict) else {}


def next_planned_step(plan: dict[str, Any]) -> dict[str, Any] | None:
    for step in plan.get("steps") or []:
        if isinstance(step, dict) and step.get("status", "planned") == "planned":
            return step
    return None


def choose_action(member: Member, plan: dict[str, Any]) -> str:
    if member.consent_practice_at is None:
        return "reminder"
    if next_planned_step(plan) is not None:
        return "practice"
    return "message"


def delay_seconds(when: str | None) -> int:
    """A plan step's `when` ("today", "tomorrow", "in three days") as seconds from now."""
    text = (when or "").lower()
    seconds = TODAY_DELAY_SECONDS
    if "tomorrow" in text:
        seconds = UNIT_SECONDS["day"]
    match = re.search(r"in (\w+) (minute|hour|day|week)s?", text)
    if match:
        word = match.group(1)
        count = int(word) if word.isdigit() else WORD_NUMBERS.get(word, 0)
        if count > 0:
            seconds = count * UNIT_SECONDS[match.group(2)]
    return max(1, min(MAX_DELAY_SECONDS, seconds))


def voice_member_for(name: str | None, target: Member, family_members: list[Member]) -> Member | None:
    """The relative named in the step, if their clone may be used."""
    if not name:
        return None
    for other in family_members:
        if (other.id != target.id and other.name.lower() == name.lower() and other.opted_out_at is None
                and other.consent_clone_at and other.voice_status == "ready" and other.voice_id):
            return other
    return None


def family_tasks(family: Family, plan: dict[str, Any]) -> list[str]:
    tasks = [str(task) for task in plan.get("family_tasks") or [] if str(task).strip()]
    return tasks or planner_job.fallback_family_tasks(family.safe_word_set)


def pattern_for(member: Member, patterns: list[dict[str, Any]], index: int) -> dict[str, Any]:
    """The pattern closest to the story this person would most likely believe;
    otherwise one per member in turn."""
    wanted = readiness.TRUSTS_TO_SCENARIO.get(_load_json(member.profile_json).get("trusts_most", ""))
    for pattern in patterns:
        if wanted and pattern.get("closest_scenario") == wanted:
            return pattern
    return patterns[index % len(patterns)]


def _practice_text(step: dict[str, Any]) -> str:
    scenario = scenario_files.get_scenario(step["scenario"]) or {}
    title = scenario.get("title") or str(step["scenario"]).replace("_", " ")
    return f"A practice call ({title.lower()}), {step.get('when') or 'today'}."


async def schedule_practice(db: Session, member: Member, plan: dict[str, Any],
                            family_members: list[Member]) -> schemas.WeeklyAction | None:
    """Create the plan's next practice as a scheduled call; None if the gate
    (or anything else) refuses it."""
    step = next_planned_step(plan)
    if step is None:
        return None
    voice = voice_member_for(step.get("voice_of"), member, family_members)
    db.commit()  # create_practice awaits the director
    try:
        call = await calls.create_practice(
            db, member.id, voice.id if voice else None, step["scenario"],
            readiness.clamp_difficulty(step.get("difficulty")),
            delay_seconds=delay_seconds(step.get("when")), check_phone_online=False,
        )
    except schemas.ApiError as error:
        db.rollback()
        log.info("weekly practice for %s not created: %s", member.id, error.code)
        return None
    except Exception:
        db.rollback()
        log.exception("weekly practice for %s failed", member.id)
        return None
    step["status"] = "scheduled"
    member.plan_json = json.dumps(plan)
    db.commit()
    return schemas.WeeklyAction(member_id=member.id, member_name=member.name, kind="practice",
                                text=_practice_text(step), call_id=call.id)


def add_message(db: Session, member: Member, kind: str, text: str) -> schemas.WeeklyAction:
    db.add(Message(member_id=member.id, kind="weekly" if kind == "message" else kind,
                   text=text, created_at=now_iso()))
    return schemas.WeeklyAction(member_id=member.id, member_name=member.name, kind=kind, text=text)


async def act_for_family(db: Session, family: Family,
                         patterns: list[dict[str, Any]]) -> list[schemas.WeeklyAction]:
    family_members = list(db.scalars(select(Member).where(Member.family_id == family.id)
                                     .order_by(Member.created_at)))
    members = [member for member in family_members if member.opted_out_at is None]
    patterns = patterns or [dict(pattern) for pattern in FALLBACK_PATTERNS]
    actions: dict[str, schemas.WeeklyAction] = {}
    reminders: list[Member] = []
    messages: list[Member] = []

    # Practices first, one at a time (each awaits the director).
    for member in members:
        plan = _load_json(member.plan_json)
        kind = choose_action(member, plan)
        if kind == "practice":
            action = await schedule_practice(db, member, plan, family_members)
            if action is not None:
                actions[member.id] = action
                continue
            kind = "reminder"
        (reminders if kind == "reminder" else messages).append(member)

    # Weekly notes, all at once (no writes are pending here).
    notes = await asyncio.gather(*(
        digest_job.write_note(pattern_for(member, patterns, index), member.name,
                              _load_json(member.plan_json).get("weak_spot")
                              or _load_json(member.profile_json).get("weak_spot"))
        for index, member in enumerate(messages)
    ))
    for member, note in zip(messages, notes, strict=True):
        actions[member.id] = add_message(db, member, "message", note)
    for index, member in enumerate(reminders):
        tasks = family_tasks(family, _load_json(member.plan_json))
        actions[member.id] = add_message(db, member, "reminder", tasks[index % len(tasks)])
    db.commit()
    return [actions[member.id] for member in members if member.id in actions]
