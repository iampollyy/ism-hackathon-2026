"""Starting, answering, reporting and reading calls. OWNER: track B.

Rules (docs/backend.md):
- POST /api/practice-calls is a thin wrapper around create_practice()
  (below), which the weekly run (track C) also calls. The checks live in
  check_practice_gate(), which the scheduler also re-runs before ringing a
  scheduled practice.
- answer: first re-check the consent gate (the target may have opted out,
  or the voice been deleted, while it rang; then the call becomes failed
  and the answer is 409 consent_missing or voice_not_ready), then
  in_progress, answered_at=now, COMMIT, then
  sessions.build_session(db, call). Never hold uncommitted writes across an
  await (db.py, "Hard rule"). If the session cannot be built, the call
  becomes failed and the answer is 502 session_failed.
- events: stamp t and seq via events.publish; tactic gets its label from
  schemas.TACTIC_LABELS; the first outcome also gets seconds_to_challenge
  (time since answered_at, capped at ended_at for a batch that arrives
  after the end; later outcomes get none); a welcome
  `consent` with given=true sets consent_practice_at and writes a consents
  row (practice, welcome_call).
- end: status ended, ended_at, ended_by, publish call.status, answer at
  once, then services.run_in_background(pipeline.after_call(call_id), ...).
- Every status change publishes call.status {status} on the call's stream.

Wrong-state answers are 409: not_ringing (answer or decline a call that is
not ringing), not_answered (events or end for a call never answered) and
call_over (events for a call that failed). Events are taken while the call
is in progress, after it ended and after it was scored, so a last batch
that arrives just after /end (such as `revealed`, sent when the reveal
screen shows) is not lost. Late events never re-score the call.
"""

import json
import logging
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import events, schemas
from app.db import get_db, now_iso, parse_time, seconds_between, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, CallEvent, Consent, Member, Result
from app.services import briefs, pipeline, run_in_background, sessions

log = logging.getLogger("app.calls")

router = APIRouter(tags=["calls"])

PHONE_ONLINE_SECONDS = 10  # practice and welcome calls need the page seen this recently
ACTIVE_STATUSES = ("ringing", "in_progress")  # a member with one of these is busy
NOT_ANSWERED_STATUSES = ("scheduled", "ringing", "declined", "missed")
OVER_STATUSES = ("failed",)  # events are no longer taken
WELCOME_CALLER_LABEL = "Callback"
WELCOME_CALLER_NUMBER = "+00 600 555 0100"  # made up; "+00" is no country's code
DEFAULT_CALLER_LABEL = "Unknown number"
DEFAULT_CALLER_NUMBER = "+00 600 555 0142"


# ---------------------------------------------------------------- helpers shared with phone.py and the scheduler


def get_member(db: DbSession, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None:
        raise schemas.ApiError(404, "not_found", "No member with this id.")
    return member


def get_call(db: DbSession, call_id: str) -> Call:
    call = db.get(Call, call_id)
    if call is None:
        raise schemas.ApiError(404, "not_found", "No call with this id.")
    return call


def is_busy(db: DbSession, member_id: str) -> bool:
    """True if the member has a call ringing or in progress (a fresh query)."""
    found = db.scalar(
        select(Call.id)
        .where(Call.target_member_id == member_id, Call.status.in_(ACTIVE_STATUSES))
        .limit(1)
    )
    return found is not None


def seen_within(last_seen_at: str | None, seconds: float) -> bool:
    seen = parse_time(last_seen_at)
    return seen is not None and (utcnow() - seen).total_seconds() <= seconds


def busy_error(member: Member) -> schemas.ApiError:
    return schemas.ApiError(409, "busy", f"{member.name} is already on a call.")


def phone_offline_error(member: Member) -> schemas.ApiError:
    return schemas.ApiError(409, "phone_offline", f"{member.name}'s phone page is not open.")


def change_status(db: DbSession, call: Call, status: str, **fields: Any) -> None:
    """Set the call's status (and any other columns), commit, and publish
    call.status on its stream. publish() commits the session for us."""
    call.status = status
    for name, value in fields.items():
        setattr(call, name, value)
    data: dict[str, Any] = {"status": status}
    if status == "ended" and call.ended_by:
        data["ended_by"] = call.ended_by
    try:
        events.publish(call.id, "call.status", data, db=db)
    except Exception:
        db.rollback()
        raise


def start_after_call(call_id: str) -> None:
    """Start track C's after-call work without waiting for it. Failures,
    including NotImplementedError from a stub, are only logged."""
    run_in_background(pipeline.after_call(call_id), f"after_call:{call_id}")


async def start_session(db: DbSession, call: Call) -> schemas.Session:
    """Ask track A for the call's session. The caller has committed its own
    writes. On any failure the call becomes failed. An ApiError (such as
    elevenlabs.ElevenLabsError, 503 agent_not_configured) keeps its status
    and code; anything else answers 502 session_failed."""
    try:
        return await sessions.build_session(db, call)
    except Exception as error:
        if isinstance(error, schemas.ApiError):  # expected, e.g. no agent id set: one line is enough
            log.warning("could not build the session for call %s: %s %s",
                        call.id, error.code, error.message)
        else:
            log.exception("could not build the session for call %s", call.id)
        db.rollback()
        change_status(db, call, "failed", ended_at=now_iso(), ended_by="error")
        if isinstance(error, schemas.ApiError):
            raise
        raise schemas.ApiError(502, "session_failed", "Could not start the conversation.") from error


# ---------------------------------------------------------------- starting a practice


def voice_is_ready(member: Member) -> bool:
    return (
        member.consent_clone_at is not None
        and member.voice_status == "ready"
        and bool(member.voice_id)
        and member.opted_out_at is None
    )


def check_practice_gate(db: DbSession, target_member_id: str, voice_member_id: str | None,
                        check_phone_online: bool = True) -> tuple[Member, Member | None]:
    """The checks for a practice call, in backend.md's order, each raising
    schemas.ApiError:
    1. both members exist and are in one family (404 not_found);
    2. target has consent_practice_at and has not opted out (409 consent_missing);
    3. if a voice member is given: consent_clone_at, voice_status ready, a
       voice_id, not opted out (409 voice_not_ready);
    4. target has no call ringing or in progress (409 busy);
    5. only if check_phone_online: target's last_seen_at within ten seconds
       (409 phone_offline).
    Returns (target, voice_member). Reads only. Used by create_practice and
    by scheduler.tick (check_phone_online=False). OWNER: track B."""
    target = db.get(Member, target_member_id)
    voice_member = db.get(Member, voice_member_id) if voice_member_id else None
    if target is None:
        raise schemas.ApiError(404, "not_found", "No member with this target id.")
    if voice_member_id and (voice_member is None or voice_member.family_id != target.family_id):
        raise schemas.ApiError(404, "not_found", "The voice member is not in the target's family.")

    if target.consent_practice_at is None or target.opted_out_at is not None:
        raise schemas.ApiError(409, "consent_missing", f"{target.name} has not agreed to practice calls.")
    if voice_member is not None and not voice_is_ready(voice_member):
        raise schemas.ApiError(409, "voice_not_ready", f"{voice_member.name}'s voice is not ready to use.")
    if is_busy(db, target.id):
        raise busy_error(target)
    if check_phone_online and not seen_within(target.last_seen_at, PHONE_ONLINE_SECONDS):
        raise phone_offline_error(target)
    return target, voice_member


async def create_practice(db: DbSession, target_member_id: str, voice_member_id: str | None,
                          scenario: str, difficulty: int, delay_seconds: int = 0,
                          check_phone_online: bool = True) -> Call:
    """Create one practice call; the only code that makes one (POST
    /api/practice-calls, and the weekly run with check_phone_online=False).
    1. check_practice_gate(db, target_member_id, voice_member_id, check_phone_online);
    2. briefs.build_brief(db, target, voice_member, scenario, difficulty);
       it awaits the director, so hold no uncommitted writes before it;
    3. check busy again (another call may have started during the await);
    4. store the call: brief_json (the variables), caller_label,
       caller_number, and status ringing (ring_at=now) when delay_seconds is
       0, else scheduled (scheduled_for = now + delay_seconds); commit;
       if it rings now, publish call.status {status: ringing}.
    Returns the stored Call. Raises schemas.ApiError. OWNER: track B."""
    if scenario not in schemas.SCENARIOS:
        raise schemas.ApiError(422, "invalid_request", f"Unknown scenario: {scenario}.")
    difficulty = max(1, min(3, int(difficulty)))
    target, voice_member = check_practice_gate(db, target_member_id, voice_member_id, check_phone_online)

    brief = await briefs.build_brief(db, target, voice_member, scenario, difficulty)

    if is_busy(db, target.id):
        raise busy_error(target)
    now = utcnow()
    call = Call(
        id=new_call_id(),
        family_id=target.family_id,
        kind="practice",
        target_member_id=target.id,
        voice_member_id=voice_member.id if voice_member else None,
        scenario=scenario,
        difficulty=difficulty,
        brief_json=json.dumps(brief.variables),
        caller_label=brief.caller_label or DEFAULT_CALLER_LABEL,
        caller_number=brief.caller_number or DEFAULT_CALLER_NUMBER,
        status="scheduled",
        created_at=to_iso(now),
    )
    db.add(call)
    if delay_seconds > 0:
        call.scheduled_for = to_iso(now + timedelta(seconds=delay_seconds))
        db.commit()
    else:
        change_status(db, call, "ringing", ring_at=to_iso(now))
    return call


@router.post("/practice-calls", status_code=201, response_model=schemas.CallCreated)
async def create_practice_call(body: schemas.PracticeCallCreate,
                               db: DbSession = Depends(get_db)) -> schemas.CallCreated:
    call = await create_practice(db, body.target_member_id, body.voice_member_id, body.scenario,
                                 body.difficulty, body.delay_seconds)
    return schemas.CallCreated(call_id=call.id, status=call.status)


@router.post("/members/{member_id}/welcome-call", status_code=201, response_model=schemas.CallCreated)
async def create_welcome_call(member_id: str, db: DbSession = Depends(get_db)) -> schemas.CallCreated:
    """Ring the member's phone page with the welcome agent. No consent is
    needed: the welcome call is where consent is asked."""
    member = get_member(db, member_id)
    if member.opted_out_at is not None:
        raise schemas.ApiError(409, "consent_missing", f"{member.name} has left Callback.")
    if is_busy(db, member.id):
        raise busy_error(member)
    if not seen_within(member.last_seen_at, PHONE_ONLINE_SECONDS):
        raise phone_offline_error(member)
    now = now_iso()
    call = Call(
        id=new_call_id(),
        family_id=member.family_id,
        kind="welcome",
        target_member_id=member.id,
        difficulty=1,
        caller_label=WELCOME_CALLER_LABEL,
        caller_number=WELCOME_CALLER_NUMBER,
        status="ringing",
        ring_at=now,
        created_at=now,
    )
    db.add(call)
    change_status(db, call, "ringing")
    return schemas.CallCreated(call_id=call.id, status=call.status)


# ---------------------------------------------------------------- the phone answers, reports, ends


def answer_refusal(db: DbSession, call: Call) -> schemas.ApiError | None:
    """The consent gate again, at the moment of answering: the target may
    have opted out, or a voice been deleted, while the call rang (rule 1).
    Returns the error to answer with, or None when the call may start."""
    target = db.get(Member, call.target_member_id)
    if target is None or target.opted_out_at is not None:
        return schemas.ApiError(409, "consent_missing", "This member has left Callback.")
    if call.kind != "practice":
        return None
    if target.consent_practice_at is None:
        return schemas.ApiError(409, "consent_missing", f"{target.name} has not agreed to practice calls.")
    if call.voice_member_id:
        voice_member = db.get(Member, call.voice_member_id)
        if voice_member is None or not voice_is_ready(voice_member):
            return schemas.ApiError(409, "voice_not_ready", "The voice for this call is no longer available.")
    return None


@router.post("/calls/{call_id}/answer", response_model=schemas.Session)
async def answer_call(call_id: str, db: DbSession = Depends(get_db)) -> schemas.Session:
    call = get_call(db, call_id)
    if call.status != "ringing":
        raise schemas.ApiError(409, "not_ringing", f"This call is {call.status}, not ringing.")
    refusal = answer_refusal(db, call)
    if refusal is not None:
        change_status(db, call, "failed", ended_at=now_iso())
        raise refusal
    change_status(db, call, "in_progress", answered_at=now_iso())  # commits before the await
    return await start_session(db, call)


@router.post("/calls/{call_id}/decline", response_model=schemas.Ok)
async def decline_call(call_id: str, db: DbSession = Depends(get_db)) -> schemas.Ok:
    call = get_call(db, call_id)
    if call.status != "ringing":
        raise schemas.ApiError(409, "not_ringing", f"This call is {call.status}, not ringing.")
    change_status(db, call, "declined", ended_at=now_iso())
    return schemas.Ok()


def has_outcome(db: DbSession, call_id: str) -> bool:
    found = db.scalar(
        select(CallEvent.id).where(CallEvent.call_id == call_id, CallEvent.type == "outcome").limit(1)
    )
    return found is not None


def challenge_seconds(call: Call) -> float | None:
    """Seconds from answering to now (backend.md: on the first outcome, the
    time since answered_at), but never past the end of a call that has
    ended. The result blanks it for hesitated and agreed; that rule is
    track C's (outcome.decide_outcome)."""
    until_now = seconds_between(call.answered_at, now_iso())
    until_end = seconds_between(call.answered_at, call.ended_at)
    if until_now is None:
        return None
    seconds = until_now if until_end is None else min(until_now, until_end)
    return round(max(0.0, seconds), 1)  # as the result rounds it


def event_data(item: Any) -> dict[str, Any]:
    """An incoming event's fields as stored, without its type."""
    data = item.model_dump(exclude={"type"})
    if item.type == "tactic":
        data["label"] = schemas.TACTIC_LABELS[item.key]
    return data


def record_spoken_consent(db: DbSession, call: Call) -> None:
    """A spoken yes on the welcome call: set consent_practice_at (if not set
    yet) and write one consents row for this call. Not committed here."""
    member = db.get(Member, call.target_member_id)
    if member is None:
        return
    already = db.scalar(
        select(Consent.id).where(Consent.call_id == call.id, Consent.kind == "practice").limit(1)
    )
    if already is not None:
        return
    now = now_iso()
    if member.consent_practice_at is None:
        member.consent_practice_at = now
    db.add(Consent(member_id=member.id, kind="practice", source="welcome_call",
                   evidence="Said yes on the welcome call (consent_result).",
                   call_id=call.id, created_at=now))


@router.post("/calls/{call_id}/events", response_model=schemas.Ok)
async def post_events(call_id: str, body: schemas.EventsBatch,
                      db: DbSession = Depends(get_db)) -> schemas.Ok:
    """Store and publish a batch of events in order. Unknown tactic keys and
    outcomes never get here: the schemas reject them with 422."""
    call = get_call(db, call_id)
    if call.status in NOT_ANSWERED_STATUSES:
        raise schemas.ApiError(409, "not_answered", f"This call is {call.status}; it was never answered.")
    if call.status in OVER_STATUSES:
        raise schemas.ApiError(409, "call_over", f"This call is {call.status}; it takes no more events.")
    outcome_seen = has_outcome(db, call.id)
    for item in body.events:
        data = event_data(item)
        if item.type == "outcome" and not outcome_seen:
            data["seconds_to_challenge"] = challenge_seconds(call)
            outcome_seen = True
        if item.type == "consent" and item.given and call.kind == "welcome":
            record_spoken_consent(db, call)
        events.publish(call.id, item.type, data, db=db)  # commits the consent too
    return schemas.Ok()


@router.post("/calls/{call_id}/end", response_model=schemas.Ok)
async def end_call(call_id: str, body: schemas.EndRequest, db: DbSession = Depends(get_db)) -> schemas.Ok:
    call = get_call(db, call_id)
    if call.status in ("scheduled", "ringing"):
        raise schemas.ApiError(409, "not_answered", f"This call is {call.status}; it was never answered.")
    if call.status != "in_progress":
        return schemas.Ok()  # already over (a second end, or the scheduler's timeout)
    change_status(db, call, "ended", ended_at=now_iso(), ended_by=body.ended_by)
    start_after_call(call.id)
    return schemas.Ok()


# ---------------------------------------------------------------- reading a call


def person_ref(member: Member | None, member_id: str) -> schemas.PersonRef:
    return schemas.PersonRef(id=member_id, name=member.name if member else "")


def mark_last_agent_turn(turns: list[schemas.TurnView], key: str) -> None:
    """A tactic belongs to the agent line just before it."""
    for turn in reversed(turns):
        if turn.speaker == "agent":
            if turn.tactic is None:
                turn.tactic = key
            return


def turns_and_tactics(stored: list[dict[str, Any]]) -> tuple[list[schemas.TurnView], list[schemas.TacticView]]:
    turns: list[schemas.TurnView] = []
    tactics: list[schemas.TacticView] = []
    for event in stored:
        data = event["data"]
        if event["type"] == "turn" and data.get("speaker") in ("agent", "user") and data.get("text"):
            turns.append(schemas.TurnView(speaker=data["speaker"], text=data["text"], t=event["t"]))
        elif event["type"] == "tactic" and data.get("key") in schemas.TACTIC_LABELS:
            key = data["key"]
            tactics.append(schemas.TacticView(key=key, label=schemas.TACTIC_LABELS[key], t=event["t"]))
            mark_last_agent_turn(turns, key)
    return turns, tactics


def tactic_list(raw: str | None) -> list[str]:
    try:
        values = json.loads(raw) if raw else []
    except ValueError:
        return []
    return [value for value in values if value in schemas.TACTIC_LABELS] if isinstance(values, list) else []


def result_view(db: DbSession, call: Call) -> schemas.CallResultView | None:
    """The result, once the call is scored."""
    if call.status != "scored":
        return None
    result = db.get(Result, call.id)
    if result is None or result.outcome not in schemas.OUTCOMES:
        return None
    return schemas.CallResultView(
        outcome=result.outcome,
        seconds_to_challenge=result.seconds_to_challenge,
        lesson=result.lesson,
        debrief=result.debrief,
        tactics_used=tactic_list(result.tactics_used_json),
        tactics_worked=tactic_list(result.tactics_worked_json),
    )


def call_view(db: DbSession, call: Call) -> schemas.CallView:
    target = db.get(Member, call.target_member_id)
    voice = db.get(Member, call.voice_member_id) if call.voice_member_id else None
    turns, tactics = turns_and_tactics(events.list_events(call.id, db=db))
    return schemas.CallView(
        id=call.id,
        kind=call.kind,
        status=call.status,
        target=person_ref(target, call.target_member_id),
        voice_of=person_ref(voice, call.voice_member_id) if call.voice_member_id else None,
        scenario=call.scenario if call.scenario in schemas.SCENARIOS else None,
        difficulty=call.difficulty,
        caller_label=call.caller_label,
        turns=turns,
        tactics=tactics,
        result=result_view(db, call),
        callback_seconds=call.callback_seconds,
        answered_at=call.answered_at,
        ended_at=call.ended_at,
        ended_by=call.ended_by,
    )


@router.get("/calls/{call_id}", response_model=schemas.CallView)
async def read_call(call_id: str, db: DbSession = Depends(get_db)) -> schemas.CallView:
    return call_view(db, get_call(db, call_id))
