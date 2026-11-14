"""Read-only views for the review screens: drills, the family's activity and
one member's progress. Track 4 (docs/full-app/review.md).

Built only from tables that already exist (members, calls, results,
call_events, consents, messages, readiness_snapshots). Nothing here writes.

Rules:
- Numbers come from code. `safe` is the result's outcome being one of
  readiness.SAFE_OUTCOMES (asked for the family word, hung up, asked a
  personal question); without a result it is false. Seconds are the stored
  ones, rounded only inside sentences. peak_risk_level is the highest level
  among the call's `risk` events (agents.risk.higher_level), or None when
  the live risk check never ran on it.
- A drill's tactics are its result's tactics_used once it is scored (the
  marked ones, or else the scorer's); before that, its `tactic` events.
- Readiness and the weak spot are the family page's own (routers/families.py,
  member_view), so both screens always show the same numbers.
- Never shame (idea.md, "The rules we build to", rule 4). Activity text says
  what people did. A drill that was not safe reads "picked up a tip for next
  time"; no "failed", "fooled" or "fell for", and never whether a voice
  fooled anyone.
- A drill's timing is a surprise for its target, so the activity never lists
  a drill that is scheduled, ringing or in progress. drills() and progress()
  do return scheduled_for and next_drill_at, for the organiser's screens.
- Messages: a callback_notice is shown once, as the family_line call it
  reports; the same alert sent to several members within five minutes is
  one item.
"""

import json
from collections.abc import Iterable, Iterator
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.agents import risk
from app.db import parse_time
from app.models import Call, CallEvent, Consent, Member, Message, Result
from app.routers import families as family_view
from app.services import readiness
from app.services import scenarios as scenario_files

SAFE_OUTCOMES = frozenset(readiness.SAFE_OUTCOMES)
LESSONS_SHOWN = 20
ROWS_READ = 500  # the most rows of one table the activity reads
ALERT_MERGE_SECONDS = 300
UNANSWERED_STATUSES = ("declined", "missed")
DONE_STATUSES = ("ended", "scored")
# Among items at the same moment, the newest-first list shows these lower
# (a member joins before their sign-up tick, which has the same time).
KIND_RANK = {"joined": 0}

# One alert while it is merged: (its time, text, recipients' ids, stored time).
Alert = tuple[datetime | None, str, set[str], str]


# ---------------------------------------------------------------- small helpers


def _json(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _time(value: str | None) -> datetime | None:
    try:
        return parse_time(value)
    except (TypeError, ValueError):
        return None


def person(members: dict[str, Member], member_id: str | None) -> schemas.PersonRef | None:
    if not member_id:
        return None
    member = members.get(member_id)
    return schemas.PersonRef(id=member_id, name=member.name if member else "")


def scenario_title(key: str | None, cache: dict[str, str]) -> str | None:
    """The scenario file's title ("Relative with a new number")."""
    if not key:
        return None
    if key not in cache:
        scenario = scenario_files.get_scenario(key) or {}
        cache[key] = str(scenario.get("title") or key.replace("_", " ").capitalize())
    return cache[key]


def tactic_refs(keys: Iterable[Any]) -> list[schemas.TacticRef]:
    """Known tactic keys with their labels, first use first, no repeats."""
    seen: list[str] = []
    for key in keys:
        if key in schemas.TACTIC_LABELS and key not in seen:
            seen.append(key)
    return [schemas.TacticRef(key=key, label=schemas.TACTIC_LABELS[key]) for key in seen]


def outcome_of(result: Result | None) -> str | None:
    return result.outcome if result is not None and result.outcome in schemas.OUTCOMES else None


def say_seconds(seconds: float) -> str:
    """23 -> "23 seconds"; 1 -> "1 second"; 150 -> "3 minutes"."""
    whole = max(0, round(seconds))
    if whole < 120:
        return "1 second" if whole == 1 else f"{whole} seconds"
    return f"{(whole + 30) // 60} minutes"  # half a minute rounds up


def family_members(db: DbSession, family_id: str) -> dict[str, Member]:
    rows = db.scalars(select(Member).where(Member.family_id == family_id).order_by(Member.created_at))
    return {member.id: member for member in rows}


# ---------------------------------------------------------------- drills


def drills(db: DbSession, family_id: str, member_id: str | None = None,
           limit: int = 20) -> list[schemas.DrillView]:
    """The family's practice calls, newest first (by created_at), optionally
    only those to one member."""
    query = select(Call).where(Call.family_id == family_id, Call.kind == "practice")
    if member_id is not None:
        query = query.where(Call.target_member_id == member_id)
    calls = list(db.scalars(query.order_by(Call.created_at.desc(), Call.id.desc()).limit(limit)))
    if not calls:
        return []
    ids = [call.id for call in calls]
    results = {row.call_id: row for row in db.scalars(select(Result).where(Result.call_id.in_(ids)))}
    marked: dict[str, list[Any]] = {}
    levels: dict[str, list[Any]] = {}
    events = db.scalars(
        select(CallEvent)
        .where(CallEvent.call_id.in_(ids), CallEvent.type.in_(("tactic", "risk")))
        .order_by(CallEvent.call_id, CallEvent.seq)
    )
    for event in events:
        data = _json(event.data_json)
        data = data if isinstance(data, dict) else {}
        if event.type == "tactic":
            marked.setdefault(event.call_id, []).append(data.get("key"))
        else:
            levels.setdefault(event.call_id, []).append(data.get("level"))
    members = family_members(db, family_id)
    titles: dict[str, str] = {}
    return [drill_view(call, results.get(call.id), marked.get(call.id, []), levels.get(call.id, []),
                       members, titles) for call in calls]


def drill_view(call: Call, result: Result | None, marked: list[Any], levels: list[Any],
               members: dict[str, Member], titles: dict[str, str]) -> schemas.DrillView:
    outcome = outcome_of(result)
    tactics = _json(result.tactics_used_json) if result is not None else marked
    callback = result.callback_seconds if result is not None else None
    return schemas.DrillView(
        call_id=call.id,
        member=person(members, call.target_member_id),
        voice_of=person(members, call.voice_member_id),
        scenario=call.scenario,
        scenario_title=scenario_title(call.scenario, titles),
        difficulty=call.difficulty,
        status=call.status,
        created_at=call.created_at,
        scheduled_for=call.scheduled_for,
        answered_at=call.answered_at,
        ended_at=call.ended_at,
        outcome=outcome,
        outcome_label=schemas.OUTCOME_LABELS[outcome] if outcome else None,
        safe=outcome in SAFE_OUTCOMES,
        seconds_to_challenge=result.seconds_to_challenge if result is not None else None,
        peak_risk_level=risk.higher_level(*levels) if levels else None,
        tactics=tactic_refs(tactics if isinstance(tactics, list) else []),
        lesson=result.lesson if result is not None else None,
        callback_seconds=callback if callback is not None else call.callback_seconds,
    )


# ---------------------------------------------------------------- activity


def activity(db: DbSession, family_id: str, limit: int = 30) -> list[schemas.ActivityItem]:
    """Who did what in the family, newest first."""
    members = family_members(db, family_id)
    items = list(member_items(members))
    if members:
        items += consent_items(db, members)
        items += message_items(db, members)
    items += call_items(db, family_id, members)
    return newest_first(items, limit)


def newest_first(items: list[schemas.ActivityItem], limit: int) -> list[schemas.ActivityItem]:
    dated = [(when, KIND_RANK.get(item.kind, 1), item) for item in items
             if (when := _time(item.when)) is not None]
    dated.sort(key=lambda entry: (entry[0], entry[1]), reverse=True)
    return [item for _, _, item in dated[:limit]]


def member_items(members: dict[str, Member]) -> Iterator[schemas.ActivityItem]:
    for member in members.values():
        ref = person(members, member.id)
        joined = "started the family plan" if member.is_organiser else "joined the family plan"
        yield schemas.ActivityItem(when=member.created_at, member=ref, kind="joined", text=f"{member.name} {joined}")
        # consent_clone_at is set when a clone is made; a later deletion keeps it.
        if member.consent_clone_at and member.voice_status in ("ready", "deleted"):
            yield schemas.ActivityItem(when=member.consent_clone_at, member=ref, kind="voice_ready",
                                       text=f"{member.name}'s voice was set up for family drills")


def consent_words(row: Consent, name: str) -> tuple[str, str] | None:
    """(kind, text) for one consents row, or None for a kind we do not show."""
    if row.kind == "practice":
        if row.source == "welcome_call":
            return "consent_given", f"{name} said yes to practice calls on the welcome call"
        if row.source == "invite":
            return "consent_given", f"{name} agreed to practice calls when joining"
        if row.evidence == "sign-up tick":
            return "consent_given", f"{name} agreed to practice calls at sign-up"
        return "consent_given", f"{name} agreed to practice calls"
    if row.kind == "practice_withdrawn":
        if row.source == "welcome_call":
            return "consent_withdrawn", f"{name} chose not to get practice calls for now"
        return "consent_withdrawn", f"{name} paused practice calls"
    if row.kind == "clone":
        if row.source == "welcome_call":
            return "voice_consent", f"{name} agreed on the welcome call to lend their voice for family drills"
        return "voice_consent", f"{name} recorded a voice sample for family drills"
    if row.kind == "clone_from_call":
        return "voice_consent", f"{name} agreed that their welcome call may be used to copy their voice for family drills"
    if row.kind == "opt_out":
        return "opted_out", f"{name} left Callback"
    return None


def consent_items(db: DbSession, members: dict[str, Member]) -> list[schemas.ActivityItem]:
    rows = db.scalars(
        select(Consent).where(Consent.member_id.in_(members.keys()))
        .order_by(Consent.created_at.desc(), Consent.id.desc()).limit(ROWS_READ)
    )
    items: list[schemas.ActivityItem] = []
    for row in rows:
        words = consent_words(row, members[row.member_id].name)
        if words is not None:
            items.append(schemas.ActivityItem(when=row.created_at, member=person(members, row.member_id),
                                              kind=words[0], text=words[1]))
    return items


def message_items(db: DbSession, members: dict[str, Member]) -> list[schemas.ActivityItem]:
    rows = db.scalars(
        select(Message)
        .where(Message.member_id.in_(members.keys()), Message.kind != "callback_notice")
        .order_by(Message.created_at.desc(), Message.id.desc()).limit(ROWS_READ)
    )
    items: list[schemas.ActivityItem] = []
    alerts: list[Alert] = []
    for row in rows:
        name = members[row.member_id].name
        if row.kind == "alert":
            merge_alert(alerts, _time(row.created_at), row.text, row.member_id, row.created_at)
            continue
        if row.kind == "weekly":
            kind, text = "weekly_note", f"This week's note for {name}: {row.text}"
        elif row.kind == "reminder":
            kind, text = "reminder", f"Reminder for {name}: {row.text}"
        else:
            kind, text = "message", row.text
        items.append(schemas.ActivityItem(when=row.created_at, member=person(members, row.member_id),
                                          kind=kind, text=text))
    for when, text, recipients, created_at in alerts:
        only = next(iter(recipients)) if len(recipients) == 1 else None
        items.append(schemas.ActivityItem(when=created_at, member=person(members, only), kind="alert", text=text))
    return items


def merge_alert(alerts: list[Alert], when: datetime | None, text: str, member_id: str, created_at: str) -> None:
    """Add one alert message, merged into an alert with the same text sent
    within ALERT_MERGE_SECONDS (one item per alert, not per recipient)."""
    for when_seen, text_seen, recipients, _ in alerts:
        if (text_seen == text and when is not None and when_seen is not None
                and abs((when - when_seen).total_seconds()) <= ALERT_MERGE_SECONDS):
            recipients.add(member_id)
            return
    alerts.append((when, text, {member_id}, created_at))


def drill_words(name: str, outcome: str | None, seconds: float | None, voice_name: str | None,
                title: str | None) -> str:
    """The sentence for a drill with a result, in kind words."""
    if voice_name:
        where = f"a practice call in {voice_name}'s voice"
    elif title:
        where = f"a practice call ({title.lower()})"
    else:
        where = "a practice call"
    after = f" after {say_seconds(seconds)}" if seconds is not None else ""
    if outcome == "asked_safe_word":
        return f"{name} asked for the family word{after}, on {where}"
    if outcome == "hung_up":
        return f"{name} hung up to check{after}, on {where}"
    if outcome == "asked_personal_question":
        return f"{name} asked a question only family would know{after}, on {where}"
    return f"{name} took {where} and picked up a tip for next time"


def call_items(db: DbSession, family_id: str, members: dict[str, Member]) -> list[schemas.ActivityItem]:
    calls = list(db.scalars(select(Call).where(Call.family_id == family_id)
                            .order_by(Call.created_at.desc(), Call.id.desc()).limit(ROWS_READ)))
    practice_ids = [call.id for call in calls if call.kind == "practice"]
    results = ({row.call_id: row for row in db.scalars(select(Result).where(Result.call_id.in_(practice_ids)))}
               if practice_ids else {})
    by_id = {call.id: call for call in calls}
    first_line: dict[str, str] = {}  # practice id -> its first family_line call (the tap that counted)
    for call in reversed(calls):
        if call.kind == "family_line" and call.parent_call_id:
            first_line.setdefault(call.parent_call_id, call.id)
    titles: dict[str, str] = {}
    items: list[schemas.ActivityItem] = []
    for call in calls:
        target = members.get(call.target_member_id)
        name = target.name if target else "Someone"
        ref = person(members, call.target_member_id)
        if call.kind == "welcome":
            if call.answered_at and call.status in DONE_STATUSES:
                items.append(schemas.ActivityItem(when=call.ended_at or call.answered_at, member=ref,
                                                  kind="welcome_done", text=f"{name} took the welcome call",
                                                  call_id=call.id))
        elif call.kind == "practice":
            item = practice_item(call, results.get(call.id), name, ref, members, titles)
            if item is not None:
                items.append(item)
        elif call.kind == "family_line":
            parent = by_id.get(call.parent_call_id or "") or (db.get(Call, call.parent_call_id)
                                                               if call.parent_call_id else None)
            seconds = (parent.callback_seconds
                       if parent is not None and first_line.get(parent.id) == call.id else None)
            text = (f"{name} called the family number {say_seconds(seconds)} after a practice call"
                    if seconds is not None else f"{name} called the family number")
            items.append(schemas.ActivityItem(when=call.created_at, member=ref, kind="family_line", text=text,
                                              call_id=call.parent_call_id))
    return items


def practice_item(call: Call, result: Result | None, name: str, ref: schemas.PersonRef | None,
                  members: dict[str, Member], titles: dict[str, str]) -> schemas.ActivityItem | None:
    """One drill on the timeline, or None while it is still a surprise
    (scheduled, ringing, in progress), after a technical failure, or when
    it was scored without a result (the voice never connected)."""
    if call.status in UNANSWERED_STATUSES:
        text = (f"{name} declined a practice call" if call.status == "declined"
                else f"A practice call for {name} went unanswered")
        when = call.ended_at or call.ring_at or call.scheduled_for or call.created_at
        return schemas.ActivityItem(when=when, member=ref, kind="drill_unanswered", text=text, call_id=call.id)
    if call.status not in DONE_STATUSES or not call.answered_at:
        return None
    voice = members.get(call.voice_member_id or "")
    voice_name = voice.name if voice else None
    when = call.ended_at or call.answered_at
    if call.status == "ended":
        where = f" in {voice_name}'s voice" if voice_name else ""
        return schemas.ActivityItem(when=when, member=ref, kind="drill", call_id=call.id,
                                    text=f"{name} took a practice call{where}; the review is on its way")
    if result is None:
        return None
    text = drill_words(name, outcome_of(result), result.seconds_to_challenge, voice_name,
                       scenario_title(call.scenario, titles))
    return schemas.ActivityItem(when=when, member=ref, kind="drill", text=text, call_id=call.id)


# ---------------------------------------------------------------- progress


def progress(db: DbSession, member: Member) -> schemas.ProgressView:
    """One member's readiness (as on the family page), drill counts, lessons,
    weak spot and next scheduled drill."""
    view = family_view.member_view(db, member)
    rows = db.execute(
        select(Call, Result).join(Result, Result.call_id == Call.id)
        .where(Call.target_member_id == member.id, Call.kind == "practice")
        .order_by(Result.created_at.desc(), Call.id.desc())
    ).all()
    scored = [(call, result) for call, result in rows if result.outcome in schemas.OUTCOMES]
    streak = 0
    for _, result in scored:
        if result.outcome not in SAFE_OUTCOMES:
            break
        streak += 1
    last = scored[0][1].outcome if scored else None
    lessons = [
        schemas.LessonView(call_id=call.id, when=call.ended_at or result.created_at, outcome=result.outcome,
                           outcome_label=schemas.OUTCOME_LABELS[result.outcome], lesson=result.lesson)
        for call, result in scored[:LESSONS_SHOWN] if result.lesson
    ]
    next_drill = db.scalar(
        select(func.min(Call.scheduled_for))
        .where(Call.target_member_id == member.id, Call.kind == "practice", Call.status == "scheduled")
    )
    return schemas.ProgressView(
        member=schemas.PersonRef(id=member.id, name=member.name),
        readiness=view.readiness,
        drills=schemas.DrillStats(
            total=len(scored),
            safe=sum(1 for _, result in scored if result.outcome in SAFE_OUTCOMES),
            last_outcome=last,
            last_outcome_label=schemas.OUTCOME_LABELS[last] if last else None,
            safe_streak=streak,
        ),
        lessons=lessons,
        weak_spot=view.weak_spot,
        next_drill_at=next_drill,
    )
