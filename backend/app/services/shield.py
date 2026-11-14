"""The Shield: the automatic safety net during a shield call. Track 3.

A shield call is a practice call with a call_shield row: a simulated real
scam call, made with the same practice agent and flow, during which the
person is NOT in training mode. In the product, real calls are forwarded to
a Callback line; this weekend the call comes through the app. The endpoints
are in routers/protection.py; the rules for the front end are in
docs/full-app/protection.md.

Rules:
- Only shield calls warn or alert. A training drill (a practice call with
  no call_shield row) never does: phone-state's `shield` stays null for it
  and no alert is written. The family's protection_settings.shield_enabled
  (default true, also when there is no row) switches both off.
- The live warning (phone_shield, for GET /api/members/{id}/phone-state)
  comes only from the call's latest stored `risk` event (services/live_risk
  stores them); before the first one it is green, "Nothing worrying yet".
  warn = level red, or yellow with money_request, asks_for_code or
  refuses_callback among the signals. The message is fixed wording, from
  code: "This sounds like a scam. Hang up and call {name} on their usual
  number."
- The claimed relative, whom to call back: the call's voice member (the
  voice being imitated); for a library-voice scenario, the family's
  organiser (another member if the person is the organiser). Their
  phone_number comes from track 1's member_joins table, read with raw SQL
  in its own session and inside try/except: null when the table or the row
  is missing.
- The automatic alert (on_risk): live_risk calls it right after it stores a
  `risk` event. When that event warns, on a shield call, ONCE per call
  (claimed by a conditional UPDATE of call_shield.alerted_at, committed
  with the messages): an `alert` message to every other non-opted-out
  family member; the imitated relative gets a specific one instead. Then
  `shield.alert` {alerted, level} is published on the call's stream. Web
  Push sends every new message by itself (services/push.py).
- The manual alert (send_manual_alert, POST /api/members/{id}/alert): the
  same messages, outside any call. The same tap again within
  MANUAL_REPEAT_SECONDS writes nothing more.
on_risk, phone_shield and call_shield_view never raise.

Imports: never import app.routers.calls here (calls imports live_risk,
which imports this module).
"""

import json
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session as DbSession

from app import events, schemas
from app.agents.risk import GREEN_REASON
from app.db import new_session, now_iso, to_iso, utcnow
from app.models import Call, CallEvent, CallShield, Member, Message, ProtectionSettings

log = logging.getLogger("app.shield")

# With a yellow level, these signals still warn. (By agents/risk.py's rule
# they make a call red anyway; the check here does not depend on that.)
WARN_SIGNALS = frozenset({"money_request", "asks_for_code", "refuses_callback"})
ALERT_KIND = "alert"
ALERT_EVENT = "shield.alert"
MANUAL_REPEAT_SECONDS = 60
NO_NAME = "your family"


# ---------------------------------------------------------------- fixed wording


def warning_text(call_back_name: str) -> str:
    return f"This sounds like a scam. Hang up and call {call_back_name} on their usual number."


def family_alert_text(name: str) -> str:
    return f"{name} is on a call that sounds like a scam. Call them now on their usual number."


def imitated_alert_text(name: str) -> str:
    return f"{name} is on a call from someone pretending to be you. Call them now."


# ---------------------------------------------------------------- reading


def is_shield_call(db: DbSession, call_id: str) -> bool:
    return db.get(CallShield, call_id) is not None


def shield_enabled(db: DbSession, family_id: str) -> bool:
    """The family's Shield switch; on when the family has no settings row."""
    row = db.get(ProtectionSettings, family_id)
    return True if row is None else bool(row.shield_enabled)


def should_warn(data: dict[str, Any] | None) -> bool:
    """A risk event's data warns: red, or yellow with a WARN_SIGNALS signal."""
    if not isinstance(data, dict):
        return False
    level = data.get("level")
    signals = data.get("signals") if isinstance(data.get("signals"), list) else []
    return level == "red" or (level == "yellow" and any(signal in WARN_SIGNALS for signal in signals))


def latest_risk(db: DbSession, call_id: str) -> dict[str, Any] | None:
    """The data of the call's latest stored `risk` event, or None."""
    raw = db.scalar(
        select(CallEvent.data_json)
        .where(CallEvent.call_id == call_id, CallEvent.type == "risk")
        .order_by(CallEvent.seq.desc())
        .limit(1)
    )
    try:
        data = json.loads(raw) if raw else None
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def family_members(db: DbSession, family_id: str) -> list[Member]:
    return list(db.scalars(select(Member).where(Member.family_id == family_id).order_by(Member.created_at)))


def imitated_member(db: DbSession, call: Call) -> Member | None:
    """The relative whose voice the call imitates; None for a library voice."""
    if not call.voice_member_id or call.voice_member_id == call.target_member_id:
        return None
    return db.get(Member, call.voice_member_id)


def claimed_relative(db: DbSession, call: Call) -> Member | None:
    """Whom the person should call back: the imitated relative; for a
    library voice, the organiser (or, if the person is the organiser, the
    first other member who has not left)."""
    imitated = imitated_member(db, call)
    if imitated is not None:
        return imitated
    others = [member for member in family_members(db, call.family_id)
              if member.id != call.target_member_id and member.opted_out_at is None]
    organiser = next((member for member in others if member.is_organiser), None)
    return organiser or (others[0] if others else None)


def join_phone_number(member_id: str) -> str | None:
    """The member's phone number from track 1's member_joins table, if that
    table and a row exist. Raw SQL in its own session, so a missing table
    never touches the caller's session. Never raises."""
    try:
        with new_session() as db:
            value = db.execute(
                text("SELECT phone_number FROM member_joins WHERE member_id = :member_id "
                     "ORDER BY joined_at DESC LIMIT 1"),
                {"member_id": member_id},
            ).scalar()
    except Exception:
        log.debug("no phone number from member_joins for %s", member_id, exc_info=True)
        return None
    number = str(value).strip() if value is not None else ""
    return number or None


def call_back_contact(db: DbSession, call: Call) -> schemas.CallBackContact | None:
    relative = claimed_relative(db, call)
    if relative is None:
        return None
    return schemas.CallBackContact(member_id=relative.id, name=relative.name,
                                   phone_number=join_phone_number(relative.id))


def active_shield_call(db: DbSession, member_id: str) -> Call | None:
    """The member's shield call in progress, if any."""
    return db.scalars(
        select(Call)
        .join(CallShield, CallShield.call_id == Call.id)
        .where(Call.target_member_id == member_id, Call.kind == "practice", Call.status == "in_progress")
        .order_by(Call.answered_at.desc(), Call.created_at.desc())
        .limit(1)
    ).first()


def shield_state(db: DbSession, call: Call) -> schemas.ShieldState:
    """The warning for one shield call, from its latest stored risk event."""
    data = latest_risk(db, call.id) or {}
    level = data.get("level") if data.get("level") in schemas.RISK_LEVELS else "green"
    signals = [key for key in data.get("signals") or [] if key in schemas.RISK_SIGNALS]
    reason = str(data.get("reason") or "").strip() or GREEN_REASON
    warn = should_warn({"level": level, "signals": signals})
    contact = call_back_contact(db, call)
    return schemas.ShieldState(
        call_id=call.id,
        level=level,
        reason=reason,
        signals=signals,
        labels=[schemas.RISK_SIGNAL_LABELS[key] for key in signals],
        warn=warn,
        message=warning_text(contact.name if contact else NO_NAME) if warn else None,
        call_back=contact,
    )


def phone_shield(db: DbSession, member: Member) -> schemas.ShieldState | None:
    """phone-state's `shield`: None unless the member has a shield call in
    progress and the family's Shield is on. Reads only. Never raises."""
    try:
        if member.opted_out_at is not None:
            return None
        call = active_shield_call(db, member.id)
        if call is None or not shield_enabled(db, call.family_id):
            return None
        return shield_state(db, call)
    except Exception:
        log.exception("could not build the shield state for %s", member.id)
        return None


def call_shield_view(db: DbSession, call: Call) -> schemas.CallShieldView | None:
    """GET /api/calls/{id}'s `shield`: None for every call but a shield
    call. `alerted` comes from the stored shield.alert event. Never raises."""
    try:
        row = db.get(CallShield, call.id)
        if row is None:
            return None
        alerted = 0
        if row.alerted_at:
            raw = db.scalar(select(CallEvent.data_json)
                            .where(CallEvent.call_id == call.id, CallEvent.type == ALERT_EVENT)
                            .order_by(CallEvent.seq.desc()).limit(1))
            try:
                alerted = int((json.loads(raw) if raw else {}).get("alerted") or 0)
            except (ValueError, TypeError, AttributeError):
                alerted = 0
        level = row.alert_level if row.alert_level in schemas.RISK_LEVELS else None
        return schemas.CallShieldView(alerted=alerted, alerted_at=row.alerted_at, alert_level=level)
    except Exception:
        log.exception("could not read the shield of call %s", call.id)
        return None


# ---------------------------------------------------------------- alerting the family


def alert_messages(db: DbSession, person: Member, imitated: Member | None) -> list[tuple[str, str]]:
    """(member_id, text) for every other family member who has not left:
    the imitated relative gets the specific text, everyone else the general one."""
    messages: list[tuple[str, str]] = []
    for member in family_members(db, person.family_id):
        if member.id == person.id or member.opted_out_at is not None:
            continue
        if imitated is not None and member.id == imitated.id:
            messages.append((member.id, imitated_alert_text(person.name)))
        else:
            messages.append((member.id, family_alert_text(person.name)))
    return messages


def add_alerts(db: DbSession, messages: list[tuple[str, str]], now: str) -> int:
    """Add the alert messages. Not committed here."""
    for member_id, body in messages:
        db.add(Message(member_id=member_id, kind=ALERT_KIND, text=body, created_at=now))
    return len(messages)


def on_risk(call_id: str, data: dict[str, Any] | None) -> int | None:
    """Called by services/live_risk right after it stores a `risk` event.
    On a shield call whose event warns (and whose family has the Shield on),
    alert the family once: claim call_shield.alerted_at, write the alert
    messages in the same commit, then publish shield.alert {alerted, level}.
    Returns how many were alerted, or None when nothing was done.
    Never raises."""
    try:
        if not should_warn(data):
            return None
        level = data["level"]  # should_warn checked it is a dict with a level
        with new_session() as db:
            call = db.get(Call, call_id)
            if call is None or call.kind != "practice" or not is_shield_call(db, call_id):
                return None
            person = db.get(Member, call.target_member_id)
            if person is None or not shield_enabled(db, call.family_id):
                return None
            now = now_iso()
            claimed = db.execute(
                update(CallShield)
                .where(CallShield.call_id == call_id, CallShield.alerted_at.is_(None))
                .values(alerted_at=now, alert_level=level)
            )
            if claimed.rowcount != 1:  # alerted already
                db.rollback()
                return None
            count = add_alerts(db, alert_messages(db, person, imitated_member(db, call)), now)
            db.commit()
        events.publish(call_id, ALERT_EVENT, {"alerted": count, "level": level})
        log.info("the Shield alerted %s family members on call %s (%s)", count, call_id, level)
        return count
    except Exception:
        log.exception("the Shield could not alert the family for call %s", call_id)
        return None


def send_manual_alert(db: DbSession, member_id: str, claimed_member_id: str | None) -> int:
    """POST /api/members/{id}/alert: the alert messages from a "Something's
    wrong" button, outside any call. Commits. Returns how many family
    members are alerted. A recipient who got the very same alert in the
    last MANUAL_REPEAT_SECONDS gets nothing new (a double tap) but still
    counts. Raises schemas.ApiError: 404 not_found (unknown member, or a
    claimed member outside the family), 409 consent_missing (the member
    has left Callback)."""
    person = db.get(Member, member_id)
    if person is None:
        raise schemas.ApiError(404, "not_found", "No member with this id.")
    if person.opted_out_at is not None:
        raise schemas.ApiError(409, "consent_missing", f"{person.name} has left Callback.")
    imitated: Member | None = None
    if claimed_member_id:
        imitated = db.get(Member, claimed_member_id)
        if imitated is None or imitated.family_id != person.family_id:
            raise schemas.ApiError(404, "not_found", "The claimed relative is not in this family.")
        if imitated.id == person.id:
            imitated = None
    since = to_iso(utcnow() - timedelta(seconds=MANUAL_REPEAT_SECONDS))
    messages = alert_messages(db, person, imitated)
    fresh = [(recipient, body) for recipient, body in messages if db.scalar(
        select(Message.id).where(Message.member_id == recipient, Message.kind == ALERT_KIND,
                                 Message.text == body, Message.created_at >= since).limit(1)
    ) is None]
    add_alerts(db, fresh, now_iso())
    db.commit()
    return len(messages)
