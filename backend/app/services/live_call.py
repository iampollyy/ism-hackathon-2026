"""Live calls: a real person calls a family member through Callback, and the
Shield listens. Added on Saturday for the demo.

The organiser (or a teammate playing the scammer) starts the call from their
own phone or laptop: POST /api/families/{id}/live-call. The member's phone
rings like any call (phone-state's incoming_call, with live=true). On answer,
the two browsers connect directly (WebRTC; this module only relays their
offer, answer and ICE candidates), so they hear each other: no voice agent.

The caller's browser transcribes the caller's own microphone with ElevenLabs
realtime speech-to-text (a single-use token from here, the key stays on the
server) and posts each finished sentence as a caller turn (POST
/api/calls/{id}/events, speaker "agent"). From there everything is the
Shield's existing path: live_risk checks the turns, shield.on_risk warns the
member's phone and alerts the family once. In the product the same check runs
on real calls forwarded to a Callback line.

A live call is a practice call with a call_shield row (so the Shield treats it
as a shield call) and a live_calls row (so nothing starts a voice agent).

Signals live in memory: one process serves the site (deploy/callback.service),
and a lost signal only means the browsers retry the call.
"""

import logging
import threading
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import now_iso, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, CallShield, LiveCall, Member
from app.routers import calls
from app.services import elevenlabs, limits, shield
from app.services.protection import SHIELD_DIFFICULTY, SHIELD_LIBRARY_SCENARIO

log = logging.getLogger("app.live_call")

SIDES = ("caller", "callee")
SIGNAL_KINDS = ("offer", "answer", "ice", "bye")
MAX_SIGNALS_PER_CALL = 400
MAX_TOKENS_PER_CALL = 6
OPEN_STATUSES = ("ringing", "in_progress")

_lock = threading.Lock()
_signals: dict[str, list[dict[str, Any]]] = {}
_tokens_given: dict[str, int] = {}


def is_live(db: DbSession, call_id: str) -> bool:
    return db.get(LiveCall, call_id) is not None


def get_live_call(db: DbSession, call_id: str) -> Call:
    """The call, if it is a live call (404 not_found otherwise)."""
    call = calls.get_call(db, call_id)
    if not is_live(db, call_id):
        raise schemas.ApiError(404, "not_found", "No live call with this id.")
    return call


def start_live_call(db: DbSession, family_id: str, member_id: str) -> tuple[Call, Member]:
    """Ring the member now with a live call from whoever started it. The same
    gates as a shield call: the member is in the family, has agreed to
    practice calls and not left, the Shield is on, the daily call cap, not
    already on a call, and the phone page open (it has to ring)."""
    member = db.get(Member, member_id)
    if member is None or member.family_id != family_id:
        raise schemas.ApiError(404, "not_found", "No member with this id in this family.")
    if not shield.shield_enabled(db, family_id):
        raise schemas.ApiError(409, "shield_off", "Callback Shield is switched off for this family.")
    if member.consent_practice_at is None or member.opted_out_at is not None:
        raise schemas.ApiError(409, "consent_missing", f"{member.name} has not agreed to practice calls.")
    limits.check(db, "call")
    if calls.is_busy(db, member.id):
        raise calls.busy_error(member)
    if not calls.seen_within(member.last_seen_at, calls.PHONE_ONLINE_SECONDS):
        raise calls.phone_offline_error(member)
    now = now_iso()
    call = Call(
        id=new_call_id(),
        family_id=family_id,
        kind="practice",
        target_member_id=member.id,
        voice_member_id=None,
        scenario=SHIELD_LIBRARY_SCENARIO,
        difficulty=SHIELD_DIFFICULTY,
        brief_json=None,
        caller_label=calls.DEFAULT_CALLER_LABEL,
        caller_number=calls.DEFAULT_CALLER_NUMBER,
        status="scheduled",
        created_at=now,
    )
    db.add(call)
    db.flush()
    db.add(CallShield(call_id=call.id, created_at=now))
    db.add(LiveCall(call_id=call.id, family_id=family_id, created_at=now))
    db.commit()
    calls.change_status(db, call, "ringing", ring_at=to_iso(utcnow()))
    log.info("live call %s to %s", call.id, member.id)
    return call, member


def answer(db: DbSession, call_id: str) -> None:
    """The member tapped Answer on a live call: in progress now."""
    call = get_live_call(db, call_id)
    if call.status != "ringing":
        raise schemas.ApiError(409, "not_ringing", f"This call is {call.status}, not ringing.")
    refusal = calls.answer_refusal(db, call)
    if refusal is not None:
        calls.change_status(db, call, "failed", ended_at=now_iso())
        raise refusal
    calls.change_status(db, call, "in_progress", answered_at=now_iso())


def post_signal(db: DbSession, call_id: str, side: str, kind: str, data: dict[str, Any]) -> None:
    call = get_live_call(db, call_id)
    if call.status not in OPEN_STATUSES:
        raise schemas.ApiError(409, "call_over", f"This call is {call.status}.")
    with _lock:
        stored = _signals.setdefault(call_id, [])
        if len(stored) >= MAX_SIGNALS_PER_CALL:
            raise schemas.ApiError(429, "too_many_signals", "Too many signals for this call.")
        stored.append({"n": len(stored) + 1, "side": side, "kind": kind, "data": data})


def signals_for(db: DbSession, call_id: str, side: str, after: int) -> schemas.LiveSignals:
    """What the OTHER side sent after message `after`, and the call's status
    (so each browser notices when the other hung up)."""
    call = get_live_call(db, call_id)
    other = "callee" if side == "caller" else "caller"
    with _lock:
        stored = list(_signals.get(call_id, []))
        if call.status not in OPEN_STATUSES:
            _signals.pop(call_id, None)
            _tokens_given.pop(call_id, None)
    messages = [schemas.LiveSignal(n=item["n"], kind=item["kind"], data=item["data"])
                for item in stored if item["side"] == other and item["n"] > after]
    return schemas.LiveSignals(messages=messages, status=call.status)


async def scribe_token(db: DbSession, call_id: str) -> str:
    """A single-use realtime speech-to-text token for the caller's browser,
    while the call rings or runs; a few per call at most."""
    call = get_live_call(db, call_id)
    if call.status not in OPEN_STATUSES:
        raise schemas.ApiError(409, "call_over", f"This call is {call.status}.")
    with _lock:
        given = _tokens_given.get(call_id, 0)
        if given >= MAX_TOKENS_PER_CALL:
            raise schemas.ApiError(429, "too_many_tokens", "No more listening tokens for this call.")
        _tokens_given[call_id] = given + 1
    db.commit()  # nothing pending while we await ElevenLabs
    try:
        return await elevenlabs.realtime_scribe_token()
    except elevenlabs.ElevenLabsError as error:
        raise schemas.ApiError(502, "listening_unavailable", f"Live listening could not start. {error.message}")
