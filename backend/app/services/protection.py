"""Protection settings, random and surprise drills, and starting a shield
call. Track 3. The endpoints are routers/protection.py; the rules for the
front end are in docs/full-app/protection.md. The Shield itself (the live
warning and the family alert) is services/shield.py.

Settings
- protection_settings: one row per family; no row means DEFAULTS (random
  drills off, 2 a week, 10:00 to 19:00 in Europe/Vilnius, the Shield on).
- member_drill_settings: a member's pause; no row means not paused.
- A change to the drill settings (enabled, drills_per_week, the window, the
  time zone) cancels the family's pending random drills, and a pause
  cancels the member's pending random and surprise drills: they become
  `failed` (drill_calls says which calls are drills). The next pass plans
  again with the new settings.

Eligible for a drill: practice consent, not opted out, not paused, and at
least one usable scenario (a clone scenario needs another family member
with a ready voice; library scenarios always work).

Random drills: the scheduler loop calls start_random_drills on every tick;
at most every Settings.drill_pass_seconds (and never two at once) it starts
schedule_random_drills in the background, so the loop never waits for the
director. For each family with drills enabled, each eligible member with no
scheduled practice (of any source) and fewer drills in the last 7 days than
drills_per_week gets the next one: at a random time inside the family's
daily window (its time zone, zoneinfo; UTC if the zone is unknown), on a
random day within the next 7 / drills_per_week days, never in the past and
never sooner than 10 minutes from now. "Drills in the last 7 days" are the
member's practice calls that rang (ring_at) in the last 7 days; shield
calls do not count.

Choosing a drill (choose_drill): the scenario and difficulty of the
member's next planned step in plan_json, if there is one; else
readiness.next_practice, as the planner's rule does. The voice: for a clone
scenario a random OTHER family member with a ready voice; with none, a
random library scenario instead (and the plan step stays planned). A plan
step that is used is marked `scheduled`, as the weekly run does.

Every drill is made by calls.create_practice(check_phone_online=False,
delay_seconds), so it is `scheduled`, holds the consent gate and the daily
caps (services/limits.py), and the scheduler rings it when due, re-running
the gate. Its scheduled_for is then set to exactly the moment chosen.

Shield calls (start_shield_call): rung now through calls.create_practice
with the normal checks (the phone page must be open), plus the call_shield
row. Default: relative_new_number in a random other member's ready voice;
with none, bank_security in its library voice.

Database rule: create_practice awaits the director, so everything is
committed first (db.py, "Hard rule").
"""

import asyncio
import json
import logging
import math
import random
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone, tzinfo
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.config import get_settings
from app.db import new_session, now_iso, parse_time, to_iso, utcnow
from app.models import Call, CallShield, DrillCall, Family, Member, MemberDrillSettings, ProtectionSettings
from app.routers import calls
from app.services import briefs, pipeline, readiness, run_in_background, shield
from app.services import scenarios as scenario_files

log = logging.getLogger("app.protection")

DEFAULTS: dict[str, Any] = {
    "enabled": False, "drills_per_week": 2, "window_start_hour": 10, "window_end_hour": 19,
    "timezone": "Europe/Vilnius", "shield_enabled": True,
}
DRILL_FIELDS = ("enabled", "drills_per_week", "window_start_hour", "window_end_hour", "timezone")
MIN_LEAD = timedelta(minutes=10)  # a random drill is never sooner than this
WEEK = timedelta(days=7)
SURPRISE_MIN_SECONDS = 10
SHIELD_DIFFICULTY = 2  # a shield call plays a persistent scammer
SHIELD_SCENARIO = "relative_new_number"
SHIELD_LIBRARY_SCENARIO = "bank_security"

REASON_LEFT = "Has left Callback."
REASON_NO_CONSENT = "Has not agreed to practice calls."
REASON_PAUSED = "Drills are paused."
REASON_NO_SCENARIO = "No practice scenario can be used yet."

# The scheduler's pass: the running one and when the last one started.
# Only touched from the event loop, so no lock is needed.
_pass: asyncio.Task | None = None
_last_pass_at: datetime | None = None


# ---------------------------------------------------------------- reading


def get_family(db: DbSession, family_id: str) -> Family:
    family = db.get(Family, family_id)
    if family is None:
        raise schemas.ApiError(404, "not_found", "No family with this id.")
    return family


def family_settings(db: DbSession, family_id: str) -> ProtectionSettings:
    """The family's row, or an unsaved one holding the defaults."""
    row = db.get(ProtectionSettings, family_id)
    return row if row is not None else ProtectionSettings(family_id=family_id, updated_at=None, **DEFAULTS)


def zone(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except Exception:
        log.warning("unknown time zone %r; using UTC", name)
        return timezone.utc


def is_known_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except Exception:
        return False
    return True


def is_paused(db: DbSession, member_id: str) -> bool:
    row = db.get(MemberDrillSettings, member_id)
    return row is not None and bool(row.paused)


def members_of(db: DbSession, family_id: str) -> list[Member]:
    """In sign-up order, as the family page lists them (created_at ties keep insertion order)."""
    return list(db.scalars(select(Member).where(Member.family_id == family_id).order_by(Member.created_at)))


def ready_voices(member: Member, family_members: list[Member]) -> list[Member]:
    """Other family members whose clone may be used now."""
    return [other for other in family_members if other.id != member.id and calls.voice_is_ready(other)]


def clone_keys(available: list[dict[str, Any]]) -> list[str]:
    return [s["key"] for s in available if s.get("key") in schemas.SCENARIOS and scenario_files.uses_clone(s)]


def library_keys(available: list[dict[str, Any]]) -> list[str]:
    return [s["key"] for s in available if s.get("key") in schemas.SCENARIOS and not scenario_files.uses_clone(s)]


def ineligible_reason(db: DbSession, member: Member, family_members: list[Member],
                      available: list[dict[str, Any]]) -> str | None:
    """Why the member cannot get a drill, in plain words; None if they can."""
    if member.opted_out_at is not None:
        return REASON_LEFT
    if member.consent_practice_at is None:
        return REASON_NO_CONSENT
    if is_paused(db, member.id):
        return REASON_PAUSED
    if not library_keys(available) and not (clone_keys(available) and ready_voices(member, family_members)):
        return REASON_NO_SCENARIO
    return None


def pending_practices(db: DbSession, member_id: str) -> list[Call]:
    """The member's practice calls still scheduled, of any source."""
    return list(db.scalars(select(Call).where(Call.target_member_id == member_id, Call.kind == "practice",
                                              Call.status == "scheduled")))


def next_drill_at(pending: list[Call]) -> str | None:
    moments = [moment for moment in (parse_time(call.scheduled_for) for call in pending) if moment is not None]
    return to_iso(min(moments)) if moments else None


def drills_last_7_days(db: DbSession, member_id: str, now: datetime) -> int:
    """The member's practice calls that rang in the 7 days before now; shield calls not counted."""
    rang = db.scalars(
        select(Call.ring_at)
        .outerjoin(CallShield, CallShield.call_id == Call.id)
        .where(Call.target_member_id == member_id, Call.kind == "practice", Call.ring_at.is_not(None),
               CallShield.call_id.is_(None))
    )
    since = now - WEEK
    return sum(1 for raw in rang if (moment := parse_time(raw)) is not None and since <= moment <= now)


def member_view(db: DbSession, member: Member, family_members: list[Member], available: list[dict[str, Any]],
                now: datetime) -> schemas.ProtectionMemberView:
    reason = ineligible_reason(db, member, family_members, available)
    return schemas.ProtectionMemberView(
        member_id=member.id,
        name=member.name,
        eligible=reason is None,
        reason_if_not=reason,
        paused=is_paused(db, member.id),
        next_drill_at=next_drill_at(pending_practices(db, member.id)),
        drills_last_7_days=drills_last_7_days(db, member.id, now),
    )


def protection_view(db: DbSession, family_id: str, now: datetime | None = None) -> schemas.ProtectionView:
    """GET /api/families/{id}/protection. Raises 404 not_found."""
    get_family(db, family_id)
    now = now or utcnow()
    row = family_settings(db, family_id)
    family_members = members_of(db, family_id)
    available = pipeline.available_scenarios()
    return schemas.ProtectionView(
        family_id=family_id,
        enabled=bool(row.enabled),
        drills_per_week=row.drills_per_week,
        window_start_hour=row.window_start_hour,
        window_end_hour=row.window_end_hour,
        timezone=row.timezone,
        shield_enabled=bool(row.shield_enabled),
        updated_at=row.updated_at,
        members=[member_view(db, member, family_members, available, now) for member in family_members],
    )


# ---------------------------------------------------------------- changing the settings


def cancel_pending_drills(db: DbSession, family_id: str | None = None, member_id: str | None = None,
                          sources: tuple[str, ...] = ("random",)) -> int:
    """The family's (or member's) drills from these sources that are still
    scheduled become failed; each change is committed and published.
    Commit your own writes first. Returns how many."""
    query = (select(Call).join(DrillCall, DrillCall.call_id == Call.id)
             .where(Call.status == "scheduled", DrillCall.source.in_(sources)))
    if family_id is not None:
        query = query.where(DrillCall.family_id == family_id)
    if member_id is not None:
        query = query.where(DrillCall.member_id == member_id)
    pending = list(db.scalars(query))
    now = now_iso()
    for call in pending:
        calls.change_status(db, call, "failed", ended_at=now)
    if pending:
        log.info("cancelled %s pending drills (family %s, member %s)", len(pending), family_id, member_id)
    return len(pending)


def update_settings(db: DbSession, family_id: str, body: schemas.ProtectionUpdate) -> schemas.ProtectionView:
    """PUT /api/families/{id}/protection. A missing or null field keeps its
    value. Raises 404 not_found, 422 invalid_request (an unknown time zone,
    or a window that does not start before it ends)."""
    get_family(db, family_id)
    changes = body.model_dump(exclude_none=True)
    current = family_settings(db, family_id)
    if "timezone" in changes and not is_known_zone(changes["timezone"]):
        raise schemas.ApiError(422, "invalid_request", f"Unknown time zone: {changes['timezone']}.")
    start = changes.get("window_start_hour", current.window_start_hour)
    end = changes.get("window_end_hour", current.window_end_hour)
    if start >= end:
        raise schemas.ApiError(422, "invalid_request", "window_start_hour must be before window_end_hour.")
    row = db.get(ProtectionSettings, family_id)
    if row is None:
        row = ProtectionSettings(family_id=family_id, **DEFAULTS)
        db.add(row)
    before = {field: getattr(row, field) for field in DRILL_FIELDS}
    for field, value in changes.items():
        setattr(row, field, value)
    row.updated_at = now_iso()
    db.commit()
    if any(getattr(row, field) != before[field] for field in DRILL_FIELDS):
        cancel_pending_drills(db, family_id=family_id)
    return protection_view(db, family_id)


def set_paused(db: DbSession, member_id: str, paused: bool) -> schemas.ProtectionMemberView:
    """PUT /api/members/{id}/drills. Pausing cancels the member's pending
    random and surprise drills. Raises 404 not_found."""
    member = calls.get_member(db, member_id)
    row = db.get(MemberDrillSettings, member_id)
    if row is None:
        row = MemberDrillSettings(member_id=member_id, paused=False)
        db.add(row)
    row.paused = paused
    row.updated_at = now_iso()
    db.commit()
    if paused:
        cancel_pending_drills(db, member_id=member_id, sources=("random", "surprise"))
    return member_view(db, member, members_of(db, member.family_id), pipeline.available_scenarios(), utcnow())


# ---------------------------------------------------------------- choosing a drill


@dataclass
class DrillChoice:
    scenario: str
    difficulty: int
    voice_member: Member | None = None
    step: dict[str, Any] | None = None  # the plan step used; marked scheduled once the call exists
    plan: dict[str, Any] | None = None  # the plan that holds it


def _load_json(raw: str | None) -> dict[str, Any]:
    try:
        value = json.loads(raw) if raw else None
    except ValueError:
        value = None
    return value if isinstance(value, dict) else {}


def next_planned_step(plan: dict[str, Any]) -> dict[str, Any] | None:
    """The plan's first step still planned (as the weekly run reads it)."""
    for step in plan.get("steps") or []:
        if isinstance(step, dict) and step.get("status", "planned") == "planned":
            return step
    return None


def choose_drill(db: DbSession, member: Member, family_members: list[Member],
                 available: list[dict[str, Any]], rng: random.Random) -> DrillChoice | None:
    """The member's next drill (scenario, difficulty, voice), or None if no
    scenario can be used. Reads only."""
    clones, libraries = clone_keys(available), library_keys(available)
    plan = _load_json(member.plan_json)
    step = next_planned_step(plan)
    if step is not None and step.get("scenario") in clones + libraries:
        scenario, difficulty = step["scenario"], readiness.clamp_difficulty(step.get("difficulty"))
    else:
        step = None
        profile = _load_json(member.profile_json)
        rule = readiness.next_practice(profile.get("trusts_most"), pipeline.practice_history(db, member.id),
                                       available)
        scenario, difficulty = rule.scenarios[0], rule.difficulty
    if scenario in libraries:
        return DrillChoice(scenario, difficulty, None, step, plan if step else None)
    voices = ready_voices(member, family_members)
    if scenario in clones and voices:
        return DrillChoice(scenario, difficulty, rng.choice(voices), step, plan if step else None)
    if not libraries:
        return None
    return DrillChoice(rng.choice(libraries), difficulty)  # no ready voice: a library scenario instead


def window_spans(now: datetime, row: ProtectionSettings, horizon: datetime) -> list[tuple[datetime, datetime]]:
    """Per local day, the part of the family's daily window that lies
    between now + MIN_LEAD and the horizon, as (start, end) in UTC."""
    local = zone(row.timezone)
    earliest = now + MIN_LEAD
    spans: list[tuple[datetime, datetime]] = []
    day = earliest.astimezone(local).date()
    while day <= horizon.astimezone(local).date():
        midnight = datetime.combine(day, time(0), tzinfo=local)
        start = (midnight + timedelta(hours=row.window_start_hour)).astimezone(timezone.utc)  # wall-clock hours
        end = (midnight + timedelta(hours=row.window_end_hour)).astimezone(timezone.utc)
        low, high = max(start, earliest), min(end, horizon)
        if high > low:
            spans.append((low, high))
        day += timedelta(days=1)
    return spans


def drill_time(now: datetime, row: ProtectionSettings, rng: random.Random) -> datetime:
    """A random moment inside the daily window, on a random day within the
    next 7 / drills_per_week days, at least MIN_LEAD from now. If that
    stretch holds no window time, the first window after it."""
    per_week = max(1, min(7, int(row.drills_per_week or 1)))
    spans = window_spans(now, row, now + timedelta(days=7 / per_week))
    if not spans:
        spans = window_spans(now, row, now + timedelta(days=8))[:1]
    if not spans:  # cannot happen with a valid window; never in the past anyway
        return now + MIN_LEAD
    low, high = rng.choice(spans)
    return low + timedelta(seconds=int(rng.uniform(0, (high - low).total_seconds())))


# ---------------------------------------------------------------- creating drills


async def create_drill(db: DbSession, member: Member, choice: DrillChoice, when: datetime, now: datetime,
                       source: str) -> Call:
    """Create the drill through calls.create_practice as a scheduled call at
    `when`, record it in drill_calls and mark its plan step scheduled.
    Raises schemas.ApiError (the consent gate, busy, the daily cap)."""
    delay = max(1, math.ceil((when - now).total_seconds()))
    voice_member_id = choice.voice_member.id if choice.voice_member else None
    db.commit()  # nothing pending while create_practice awaits the director
    try:
        call = await calls.create_practice(db, member.id, voice_member_id, choice.scenario, choice.difficulty,
                                           delay_seconds=delay, check_phone_online=False)
    except Exception:
        db.rollback()
        raise
    call.scheduled_for = to_iso(when)  # the moment chosen, not counted from after the director
    db.add(DrillCall(call_id=call.id, family_id=call.family_id, member_id=member.id, source=source,
                     created_at=now_iso()))
    if choice.step is not None and choice.plan is not None:
        choice.step["status"] = "scheduled"
        member.plan_json = json.dumps(choice.plan)
    db.commit()
    return call


async def drill_for_member(member_id: str, now: datetime, rng: random.Random) -> str | None:
    """Schedule the member's next random drill if they are due one; returns
    its call id. Never raises (refusals and failures are logged)."""
    try:
        with new_session() as db:
            member = db.get(Member, member_id)
            row = db.get(ProtectionSettings, member.family_id) if member is not None else None
            if member is None or row is None or not row.enabled:
                return None
            family_members = members_of(db, member.family_id)
            available = pipeline.available_scenarios()
            if ineligible_reason(db, member, family_members, available) is not None:
                return None
            if pending_practices(db, member.id) or drills_last_7_days(db, member.id, now) >= row.drills_per_week:
                return None
            choice = choose_drill(db, member, family_members, available, rng)
            if choice is None:
                return None
            call = await create_drill(db, member, choice, drill_time(now, row, rng), now, "random")
            log.info("random drill %s for %s at %s (%s)", call.id, member.id, call.scheduled_for, call.scenario)
            return call.id
    except schemas.ApiError as error:
        log.info("no random drill for %s now: %s", member_id, error.code)
    except Exception:
        log.exception("the random drill for %s failed", member_id)
    return None


async def schedule_random_drills(now: datetime | None = None, rng: random.Random | None = None) -> list[str]:
    """One pass over the families with random drills on (module docstring).
    Returns the new drills' call ids. Never raises."""
    now = now or utcnow()
    rng = rng or random.Random()
    created: list[str] = []
    try:
        with new_session() as db:
            family_ids = list(db.scalars(select(ProtectionSettings.family_id)
                                         .where(ProtectionSettings.enabled.is_(True))))
            member_ids = list(db.scalars(
                select(Member.id).where(Member.family_id.in_(family_ids), Member.opted_out_at.is_(None))
                .order_by(Member.family_id, Member.created_at)
            )) if family_ids else []
        for member_id in member_ids:
            call_id = await drill_for_member(member_id, now, rng)
            if call_id is not None:
                created.append(call_id)
    except Exception:
        log.exception("the random drill pass failed")
    return created


def start_random_drills(now: datetime) -> bool:
    """The scheduler loop's hook, called on every tick: starts a pass in the
    background when Settings.drill_pass_seconds have passed since the last
    one and none is running. Returns True if one started. Call from inside
    the running event loop. Never raises."""
    global _pass, _last_pass_at
    try:
        settings = get_settings()
        if not settings.random_drills_enabled or (_pass is not None and not _pass.done()):
            return False
        if _last_pass_at is not None and (now - _last_pass_at).total_seconds() < settings.drill_pass_seconds:
            return False
        _last_pass_at = now
        _pass = run_in_background(schedule_random_drills(now), "random_drills")
        return True
    except Exception:
        log.exception("could not start the random drill pass")
        return False


async def surprise_drill(db: DbSession, family_id: str, member_id: str | None, within_seconds: int,
                         now: datetime | None = None, rng: random.Random | None = None) -> tuple[Call, Member]:
    """POST /api/families/{id}/surprise-drill: one drill for the member (or a
    random eligible one who is not on a call) at a random moment within the
    next within_seconds. The same choice rules as a random drill; protection
    need not be enabled. Raises 404 not_found, 409 not_eligible, and
    create_practice's errors (409 busy, 429 daily_limit)."""
    now = now or utcnow()
    rng = rng or random.Random()
    get_family(db, family_id)
    family_members = members_of(db, family_id)
    available = pipeline.available_scenarios()
    if member_id:
        member = next((m for m in family_members if m.id == member_id), None)
        if member is None:
            raise schemas.ApiError(404, "not_found", "No member with this id in this family.")
        reason = ineligible_reason(db, member, family_members, available)
        if reason is not None:
            raise schemas.ApiError(409, "not_eligible", f"{member.name} cannot get a drill now. {reason}")
    else:
        candidates = [m for m in family_members
                      if ineligible_reason(db, m, family_members, available) is None and not calls.is_busy(db, m.id)]
        if not candidates:
            raise schemas.ApiError(409, "not_eligible",
                                   "Nobody in this family can get a drill now. A drill needs someone who has "
                                   "agreed to practice calls, has not paused drills and is not on a call.")
        member = rng.choice(candidates)
    choice = choose_drill(db, member, family_members, available, rng)
    if choice is None:
        raise schemas.ApiError(409, "not_eligible", f"{member.name} cannot get a drill now. {REASON_NO_SCENARIO}")
    when = now + timedelta(seconds=rng.randint(SURPRISE_MIN_SECONDS, max(SURPRISE_MIN_SECONDS, within_seconds)))
    call = await create_drill(db, member, choice, when, now, "surprise")
    log.info("surprise drill %s for %s at %s (%s)", call.id, member.id, call.scheduled_for, call.scenario)
    return call, member


# ---------------------------------------------------------------- shield calls


def shield_brief(brief_json: str | None, target_name: str) -> str | None:
    """The stored brief with the shield's reveal line (the session sets it
    again when the call is answered)."""
    brief = _load_json(brief_json)
    if not brief:
        return brief_json
    brief["reveal_line"] = briefs.reveal_line(target_name, None, shield=True)
    return json.dumps(brief)


async def start_shield_call(db: DbSession, family_id: str, member_id: str, voice_member_id: str | None,
                            scenario: str | None, rng: random.Random | None = None) -> tuple[Call, Member]:
    """POST /api/families/{id}/shield-call: ring the member now with a
    simulated scam call that the Shield watches. Raises 404 not_found, 409
    shield_off, and create_practice's errors (consent_missing,
    voice_not_ready, busy, phone_offline, 429 daily_limit)."""
    rng = rng or random.Random()
    get_family(db, family_id)
    member = db.get(Member, member_id)
    if member is None or member.family_id != family_id:
        raise schemas.ApiError(404, "not_found", "No member with this id in this family.")
    if not shield.shield_enabled(db, family_id):
        raise schemas.ApiError(409, "shield_off", "Callback Shield is switched off for this family.")
    voices = ready_voices(member, members_of(db, family_id))
    if scenario is None and voice_member_id is None:
        if voices:
            scenario, voice_member_id = SHIELD_SCENARIO, rng.choice(voices).id
        else:
            scenario = SHIELD_LIBRARY_SCENARIO
    elif scenario is None:
        scenario = SHIELD_SCENARIO
    elif voice_member_id is None and voices and scenario_files.uses_clone(scenario_files.get_scenario(scenario) or {}):
        voice_member_id = rng.choice(voices).id
    db.commit()  # nothing pending while create_practice awaits the director
    call = await calls.create_practice(db, member.id, voice_member_id, scenario, SHIELD_DIFFICULTY,
                                       delay_seconds=0, check_phone_online=True)
    # No await from here: the row is there before the phone can answer.
    db.add(CallShield(call_id=call.id, created_at=now_iso()))
    call.brief_json = shield_brief(call.brief_json, member.name)
    db.commit()
    log.info("shield call %s for %s (%s)", call.id, member.id, scenario)
    return call, member
