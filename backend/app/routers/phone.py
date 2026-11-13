"""What each phone page asks for. OWNER: track B.

- GET /api/members/{id}/phone-state, once a second: records last_seen_at;
  incoming_call is set only while a welcome or practice call for this
  member is ringing, and never once the member has opted out; messages are
  the unread ones.
- POST /api/members/{id}/messages/read: marks messages read (all, or `ids`).
- POST /api/members/{id}/family-line: finds this member's latest practice
  that ended in the last ten minutes (404 no_recent_practice if none),
  stores callback_seconds on that call (and the result if it exists),
  creates a family_line call (parent_call_id = the practice, status
  in_progress, answered_at now), publishes callback.connected {seconds} on
  the practice's stream, writes a callback_notice message for the voice
  member, or for the organiser when a library voice was used ("Sara called
  the family number after a practice."), returns call_id and the session
  from sessions.build_session.
  Readiness ("tapped within a minute", ai.md): if the practice's result
  already exists, the pipeline has finished, so write a new
  readiness_snapshots row for this member here: the member's latest
  snapshot's scores through readiness.apply_callback(scores, seconds),
  source_call_id = the practice (skip it if the member has no snapshot or
  nothing changes). If the result does not exist yet, do nothing more: the
  pipeline re-reads calls.callback_seconds when it inserts the result.
  All these writes are committed BEFORE awaiting sessions.build_session
  (db.py, "Hard rule"), with no await between checking for the result and
  the commit. Only the first tap after a practice records the seconds, the
  notice and the snapshot; a second tap only opens another family line.
  A member has one family line at a time: a tap first ends any of their
  family lines still in progress (ended_by user, after-call work started),
  so a line the page lost does not keep them busy until the scheduler's
  timeout.

The welcome-call endpoint lives in calls.py.
"""

import json
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import events, schemas
from app.db import get_db, now_iso, parse_time, seconds_between, utcnow
from app.ids import new_call_id
from app.models import Call, Family, Member, Message, ReadinessSnapshot, Result
from app.routers.calls import (DEFAULT_CALLER_LABEL, DEFAULT_CALLER_NUMBER, change_status, get_member,
                               start_after_call, start_session)
from app.services import readiness

router = APIRouter(tags=["phone"])

RECENT_PRACTICE_SECONDS = 10 * 60
RINGING_KINDS = ("welcome", "practice")


# ---------------------------------------------------------------- phone state


def incoming_call(db: DbSession, member_id: str) -> schemas.IncomingCall | None:
    call = db.scalars(
        select(Call)
        .where(Call.target_member_id == member_id, Call.status == "ringing", Call.kind.in_(RINGING_KINDS))
        .order_by(Call.ring_at.desc(), Call.created_at.desc())
        .limit(1)
    ).first()
    if call is None:
        return None
    caller = schemas.Caller(
        label=call.caller_label or DEFAULT_CALLER_LABEL,
        number=call.caller_number or DEFAULT_CALLER_NUMBER,
    )
    return schemas.IncomingCall(call_id=call.id, kind=call.kind, caller=caller)


def unread_messages(db: DbSession, member_id: str) -> list[schemas.PhoneMessage]:
    rows = db.scalars(
        select(Message)
        .where(Message.member_id == member_id, Message.read_at.is_(None))
        .order_by(Message.created_at, Message.id)
    )
    return [
        schemas.PhoneMessage(id=row.id, kind=row.kind, text=row.text, created_at=row.created_at)
        for row in rows
    ]


@router.get("/members/{member_id}/phone-state", response_model=schemas.PhoneState)
async def phone_state(member_id: str, db: DbSession = Depends(get_db)) -> schemas.PhoneState:
    member = get_member(db, member_id)
    member.last_seen_at = now_iso()
    db.commit()
    family = db.get(Family, member.family_id)
    return schemas.PhoneState(
        member=schemas.PhoneMember(id=member.id, name=member.name, family=family.name if family else ""),
        incoming_call=incoming_call(db, member.id) if member.opted_out_at is None else None,
        messages=unread_messages(db, member.id),
        family_number=schemas.FamilyNumber(enabled=True),
    )


@router.post("/members/{member_id}/messages/read", response_model=schemas.Ok)
async def read_messages(member_id: str, body: schemas.MessagesRead | None = Body(default=None),
                        db: DbSession = Depends(get_db)) -> schemas.Ok:
    get_member(db, member_id)
    query = select(Message).where(Message.member_id == member_id, Message.read_at.is_(None))
    if body is not None and body.ids is not None:
        query = query.where(Message.id.in_(body.ids))
    now = now_iso()
    for message in db.scalars(query):
        message.read_at = now
    db.commit()
    return schemas.Ok()


# ---------------------------------------------------------------- the family number


def recent_practice(db: DbSession, member_id: str) -> Call | None:
    """The member's latest practice that ended in the last ten minutes."""
    latest = db.scalars(
        select(Call)
        .where(Call.target_member_id == member_id, Call.kind == "practice",
               Call.status.in_(("ended", "scored")), Call.ended_at.is_not(None))
        .order_by(Call.ended_at.desc())
        .limit(1)
    ).first()
    if latest is None:
        return None
    ended = parse_time(latest.ended_at)
    if ended is None or utcnow() - ended > timedelta(seconds=RECENT_PRACTICE_SECONDS):
        return None
    return latest


def notice_recipient(db: DbSession, member: Member, practice: Call) -> Member | None:
    """Whose phone hears about the tap: the voice's owner, or the organiser
    when a library voice was used. Never the caller themself."""
    if practice.voice_member_id:
        recipient = db.get(Member, practice.voice_member_id)
    else:
        recipient = db.scalars(
            select(Member)
            .where(Member.family_id == member.family_id, Member.is_organiser.is_(True))
            .order_by(Member.created_at)
        ).first()
    if recipient is None or recipient.id == member.id:
        return None
    return recipient


def snapshot_items(items_json: str) -> list[dict[str, Any]]:
    try:
        items = json.loads(items_json)
    except ValueError:
        return []
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def write_callback_snapshot(db: DbSession, member_id: str, practice_id: str, seconds: float, now: str) -> None:
    """A new readiness snapshot after the tap, if the tap changes a score.
    Not committed here."""
    latest = db.scalars(
        select(ReadinessSnapshot)
        .where(ReadinessSnapshot.member_id == member_id)
        .order_by(ReadinessSnapshot.created_at.desc(), ReadinessSnapshot.id.desc())
        .limit(1)
    ).first()
    if latest is None:
        return
    old_items = {item.get("key"): item for item in snapshot_items(latest.items_json)}
    scores = {key: int(old_items.get(key, {}).get("score", 0) or 0) for key in schemas.READINESS_KEYS}
    new_scores = readiness.apply_callback(scores, seconds)
    if new_scores == scores:
        return
    items: list[dict[str, Any]] = []
    for key in schemas.READINESS_KEYS:
        item: dict[str, Any] = {"key": key, "score": new_scores.get(key, 0)}
        if new_scores.get(key) != scores.get(key):
            item["evidence"] = f"Rang the family number {round(seconds)} seconds after a practice."
        elif old_items.get(key, {}).get("evidence"):
            item["evidence"] = old_items[key]["evidence"]
        items.append(item)
    db.add(ReadinessSnapshot(
        member_id=member_id,
        source_call_id=practice_id,
        items_json=json.dumps(items),
        total=sum(item["score"] for item in items),
        max=schemas.READINESS_MAX,
        created_at=now,
    ))


def record_callback(db: DbSession, member: Member, practice: Call, now: str) -> None:
    """First tap after a practice: the seconds on the call (and the result if
    it exists, with a readiness snapshot), and the notice. Not committed here."""
    seconds = max(0.0, seconds_between(practice.ended_at, now) or 0.0)
    practice.callback_seconds = seconds
    result = db.get(Result, practice.id)
    if result is not None:
        result.callback_seconds = seconds
        write_callback_snapshot(db, member.id, practice.id, seconds, now)
    recipient = notice_recipient(db, member, practice)
    if recipient is not None:
        db.add(Message(member_id=recipient.id, kind="callback_notice",
                       text=f"{member.name} called the family number after a practice.", created_at=now))


def end_open_family_lines(db: DbSession, member_id: str, now: str) -> None:
    """End this member's family lines still in progress (a double tap or a
    reload left one behind). Each change is committed and published."""
    open_lines = db.scalars(
        select(Call).where(Call.target_member_id == member_id, Call.kind == "family_line",
                           Call.status == "in_progress")
    ).all()
    for line in open_lines:
        change_status(db, line, "ended", ended_at=now, ended_by="user")
        start_after_call(line.id)


@router.post("/members/{member_id}/family-line", response_model=schemas.FamilyLineStarted)
async def family_line(member_id: str, db: DbSession = Depends(get_db)) -> schemas.FamilyLineStarted:
    member = get_member(db, member_id)
    practice = recent_practice(db, member.id)
    if practice is None:
        raise schemas.ApiError(404, "no_recent_practice", "No practice call ended in the last ten minutes.")
    now = now_iso()
    end_open_family_lines(db, member.id, now)
    first_tap = practice.callback_seconds is None
    if first_tap:
        record_callback(db, member, practice, now)
    line = Call(
        id=new_call_id(),
        family_id=member.family_id,
        kind="family_line",
        target_member_id=member.id,
        parent_call_id=practice.id,
        difficulty=1,
        status="in_progress",
        answered_at=now,
        created_at=now,
    )
    db.add(line)
    db.commit()  # everything above, before any await

    if first_tap:  # a second tap only opens another family line
        events.publish(practice.id, "callback.connected",
                       {"seconds": practice.callback_seconds, "family_line_call_id": line.id})
    events.publish(line.id, "call.status", {"status": "in_progress"})
    session = await start_session(db, line)
    db.refresh(line)
    if line.status != "in_progress":  # a second tap ended this line while its session was built
        raise schemas.ApiError(409, "call_over", "A newer family line replaced this one.")
    return schemas.FamilyLineStarted(call_id=line.id, session=session)
