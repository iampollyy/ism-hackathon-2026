"""The member's voice from their own side of the welcome call. Full app, track 2.

During the welcome call the phone page records only the member's own
microphone and uploads it when the call ends (POST
/api/calls/{id}/voice-sample, routers/voice_sample.py). The welcome agent
asks whether Callback may use their voice from this call for practice calls
to their family; the page forwards its voice_consent_result tool as a
`voice_consent` event (POST /api/calls/{id}/events, routers/calls.py).

Rules:
- Never clone without both consents:
  1. the join tick: a consents row of kind `clone_from_call`, written by the
     invite flow (track 1) before the welcome call;
  2. the spoken yes on this call: a `voice_consent` event with given=true.
     With the join tick it is recorded as a consents row (`clone`,
     `welcome_call`, this call, EVIDENCE); the same yes twice writes one
     row. Without the tick only the event is stored.
  Both are checked when the clone starts and again before it is stored.
- The latest spoken answer in the call counts. A no, a missing join tick or
  an opt-out means the recording is not kept: it is deleted and the
  sample's state is `none`, with the reason. A no never touches a clone
  the member already has.
- Whichever of the recording and the spoken yes arrives second starts the
  clone, in the background (settle(), services.run_in_background), so the
  upload is answered at once. One clone per call: the sample moves from
  waiting_for_consent to cloning in one UPDATE.
- The clone: services.audio.clean_recording, then the length of what is left
  (cleaning trims every silence over a second, so this is about how long
  they spoke) must reach settings.voice_sample_min_seconds (10 s), then
  elevenlabs.clone_voice. It is stored like POST /api/members/{id}/voice:
  voice_id, voice_status ready, consent_clone_at now, and the member's older
  clone is deleted. A failure keeps an earlier ready clone in use
  (voice_status becomes failed only when there is none, as the upload does)
  and puts the reason on the sample.
- The daily clone cap (services/limits.py) counts `clone` consent rows, so
  limits.check runs just before the spoken yes's row is written, as the
  voice upload checks before writing its own. Over the cap the row is still
  written (it is what they said) and the sample fails with the cap's
  message. A new upload after a failure is a new attempt and is checked
  again (429 daily_limit).
- Files: an upload is kept at media/samples/{call_id}.{token}.{ext} only
  while it may still be used, and deleted once the clone is made or has
  failed. A clone's cleaned copy replaces media/voices/{member_id}.mp3, the
  file the voice upload uses, so DELETE /api/members/{id}/voice removes it.
- A clone that a restart cut short (state cloning, no task for it in this
  process) starts again on the next upload or status read, which settle the
  sample.

Database rule: no session holds uncommitted writes across an await (db.py,
"Hard rule"); the clone task reads and writes in short sessions.
"""

import asyncio
import json
import logging
import secrets
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.config import get_settings
from app.db import new_session, now_iso
from app.models import Call, CallEvent, Consent, Member, VoiceSample
from app.routers import voice as voice_router
from app.services import audio, elevenlabs, limits, run_in_background

log = logging.getLogger("app.voice_sample")

JOIN_TICK = "clone_from_call"  # consents.kind of the tick at join (track 1)
CLONE = "clone"
SOURCE = "welcome_call"
EVIDENCE = "Said yes on the welcome call (voice_consent_result)"
EVENT = "voice_consent"

NONE, WAITING, CLONING, READY, FAILED = "none", "waiting_for_consent", "cloning", "ready", "failed"

# The calls a recording is taken for: welcome calls that were answered.
ANSWERED_STATUSES = ("in_progress", "ended", "scored")
NOT_ANSWERED_STATUSES = ("scheduled", "ringing", "declined", "missed")

FFPROBE_SECONDS = 30.0

NOT_WELCOME = "Only a welcome call records the member's voice."
NO_RECORDING = "No recording from this call yet."
NO_WELCOME_CALL = "No welcome call yet."

# call_id -> its running clone task. Only touched from the event loop.
_running: dict[str, asyncio.Task] = {}


# ---------------------------------------------------------------- words


def _no_tick(name: str) -> str:
    return (f"{name} did not agree, when joining, that their voice may be cloned from the welcome call, "
            "so the recording is not kept.")


def _said_no(name: str) -> str:
    return f"{name} did not say a clear yes to using their voice from this call, so the recording is not kept."


def _left(name: str) -> str:
    return f"{name} has left Callback, so the recording is not kept."


def _waiting(name: str) -> str:
    return f"Waiting for {name}'s spoken yes on the welcome call."


def _no_yes(name: str) -> str:
    return f"{name}'s spoken yes for this call is missing, so the recording is not kept."


def _too_short(name: str, seconds: float, minimum: float) -> str:
    return (f"Only about {int(seconds)} seconds of {name}'s voice were heard on the call; "
            f"a voice needs at least {minimum:g}.")


# ---------------------------------------------------------------- facts


def sample_path(call_id: str, extension: str) -> Path:
    """A new file for one upload (a token per upload, so a second upload
    never overwrites a file that is being cleaned)."""
    return get_settings().media_path / "samples" / f"{call_id}.{secrets.token_hex(4)}.{extension}"


def cleaned_path(source: Path) -> Path:
    return source.with_suffix(".clean.mp3")


def is_running(call_id: str) -> bool:
    task = _running.get(call_id)
    return task is not None and not task.done()


def has_join_tick(db: DbSession, member_id: str) -> bool:
    found = db.scalar(select(Consent.id).where(Consent.member_id == member_id, Consent.kind == JOIN_TICK).limit(1))
    return found is not None


def spoken_answer(db: DbSession, call_id: str) -> bool | None:
    """The latest stored voice_consent answer of this call, or None."""
    raw = db.scalar(
        select(CallEvent.data_json)
        .where(CallEvent.call_id == call_id, CallEvent.type == EVENT)
        .order_by(CallEvent.seq.desc())
        .limit(1)
    )
    if raw is None:
        return None
    try:
        given = json.loads(raw).get("given")
    except (ValueError, AttributeError):
        return None
    return given if isinstance(given, bool) else None


def spoken_yes_recorded(db: DbSession, call_id: str) -> bool:
    """This call has the consents row of a spoken yes (kind clone, source welcome_call)."""
    found = db.scalar(
        select(Consent.id)
        .where(Consent.call_id == call_id, Consent.kind == CLONE, Consent.source == SOURCE)
        .limit(1)
    )
    return found is not None


def refusal(db: DbSession, call: Call, member: Member | None) -> str | None:
    """Why this call's recording may not be used, as far as is known now, or
    None. A missing answer is not a refusal (it may still come)."""
    name = member.name if member is not None else "This member"
    if member is None or member.opted_out_at is not None:
        return _left(name)
    if not has_join_tick(db, member.id):
        return _no_tick(name)
    if spoken_answer(db, call.id) is False:
        return _said_no(name)
    return None


def check_call(call: Call) -> None:
    """The recording is taken only for a welcome call that was answered.
    Raises 409: not_a_welcome_call, not_answered or call_over."""
    if call.kind != "welcome":
        raise schemas.ApiError(409, "not_a_welcome_call", NOT_WELCOME)
    if call.status in NOT_ANSWERED_STATUSES:
        raise schemas.ApiError(409, "not_answered", f"This call is {call.status}; it was never answered.")
    if call.status not in ANSWERED_STATUSES:
        raise schemas.ApiError(409, "call_over", f"This call is {call.status}; there is no recording to take.")


async def speech_seconds(path: Path) -> float | None:
    """How long the cleaned recording lasts, by ffprobe. Cleaning trims every
    silence over a second, so this is about how long the member spoke. None
    if it cannot be measured. Never raises (cancellation still propagates)."""
    args = ["ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path)]
    try:
        process = await asyncio.create_subprocess_exec(
            *args, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError:
        log.warning("ffprobe could not be started; the length of %s is unknown", path.name)
        return None
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=FFPROBE_SECONDS)
    except (asyncio.TimeoutError, asyncio.CancelledError) as error:
        process.kill()
        await process.wait()
        if isinstance(error, asyncio.CancelledError):
            raise
        return None
    try:
        return round(float(stdout.decode(errors="replace").strip()), 1)
    except ValueError:
        return None


# ---------------------------------------------------------------- the sample row


def _unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        log.exception("could not delete %s", path)


def _drop_files(sample: VoiceSample) -> None:
    """Delete the stored upload and its cleaned copy, if any. Not committed."""
    if sample.path:
        source = Path(sample.path)
        _unlink(source)
        _unlink(cleaned_path(source))
    sample.path = None


def _set(sample: VoiceSample, state: str, reason: str | None) -> None:
    sample.state = state
    sample.reason = reason
    sample.updated_at = now_iso()


def _let_go(sample: VoiceSample, reason: str) -> None:
    """The recording may not be used: delete it, state none. Not committed."""
    _drop_files(sample)
    _set(sample, NONE, reason)


def record_voice_consent(db: DbSession, call: Call, given: bool) -> None:
    """The welcome agent's voice_consent_result, before its event is stored
    (calls.post_events; events.publish commits). A yes with the join tick
    writes this call's `clone` row once, after the daily cap check; over the
    cap the sample fails. A no writes nothing: the stored event is the
    record, and settle() lets go of a waiting recording. Other kinds of
    call, an opted-out member or no join tick: nothing. Not committed here."""
    if call.kind != "welcome" or not given:
        return
    member = db.get(Member, call.target_member_id)
    if member is None or member.opted_out_at is not None or not has_join_tick(db, member.id):
        return
    if spoken_yes_recorded(db, call.id):
        return
    try:
        limits.check(db, "clone")
    except schemas.ApiError as error:
        sample = db.get(VoiceSample, call.id)
        if sample is None:
            now = now_iso()
            sample = VoiceSample(call_id=call.id, member_id=member.id, state=FAILED, created_at=now, updated_at=now)
            db.add(sample)
        _drop_files(sample)
        _set(sample, FAILED, error.message)
    db.add(Consent(member_id=member.id, kind=CLONE, source=SOURCE, evidence=EVIDENCE,
                   call_id=call.id, created_at=now_iso()))


def settle(call_id: str) -> bool:
    """Start the clone when this call's recording and both consents are in;
    let go of a waiting recording that may not be used; otherwise leave it
    waiting. Returns True if a clone started. Call from inside the running
    event loop (a request handler). Never raises."""
    try:
        with new_session() as db:
            sample = db.get(VoiceSample, call_id)
            if sample is None or not (sample.state == WAITING or (sample.state == CLONING and not is_running(call_id))):
                return False
            call = db.get(Call, call_id)
            member = db.get(Member, sample.member_id)
            why = refusal(db, call, member) if call is not None else NOT_WELCOME
            if why is not None:
                _let_go(sample, why)
                db.commit()
                return False
            assert member is not None  # refusal() covers a missing member
            if spoken_answer(db, call_id) is not True or not spoken_yes_recorded(db, call_id):
                if sample.state != WAITING or sample.reason != _waiting(member.name):
                    _set(sample, WAITING, _waiting(member.name))
                    db.commit()
                return False
            claimed = db.execute(
                update(VoiceSample)
                .where(VoiceSample.call_id == call_id, VoiceSample.state == sample.state)
                .values(state=CLONING, reason=None, updated_at=now_iso())
            ).rowcount
            db.commit()
            if not claimed:
                return False
        _running[call_id] = run_in_background(_clone(call_id), f"voice_sample:{call_id}")
        return True
    except Exception:
        log.exception("could not settle the voice sample of %s", call_id)
        return False


# ---------------------------------------------------------------- the upload


async def receive(db: DbSession, call: Call, member: Member, content: bytes,
                  extension: str) -> schemas.VoiceSampleAccepted:
    """Keep the upload if it may be used, then settle(). The caller has run
    check_call and refused an opted-out member. Raises 429 daily_limit for a
    new attempt after a failure when today's clone cap is reached."""
    sample = db.get(VoiceSample, call.id)
    if sample is not None and sample.state == READY:
        return schemas.VoiceSampleAccepted(cloning=False, reason="A voice was already made from this call.")
    if sample is not None and sample.state == CLONING and is_running(call.id):
        return schemas.VoiceSampleAccepted(cloning=True)
    why = refusal(db, call, member)
    if why is not None:
        if sample is not None:
            _let_go(sample, why)
            db.commit()
        return schemas.VoiceSampleAccepted(cloning=False, reason=why)
    if sample is not None and sample.state == FAILED:
        limits.check(db, "clone")  # a new attempt

    path = sample_path(call.id, extension)
    await asyncio.to_thread(voice_router._write_file, path, content)

    db.expire_all()  # another request may have changed the row during the write
    sample = db.get(VoiceSample, call.id)
    if sample is not None and (sample.state == READY or (sample.state == CLONING and is_running(call.id))):
        _unlink(path)
        return schemas.VoiceSampleAccepted(cloning=sample.state == CLONING,
                                           reason=None if sample.state == CLONING else
                                           "A voice was already made from this call.")
    if sample is None:
        now = now_iso()
        sample = VoiceSample(call_id=call.id, member_id=member.id, state=WAITING, created_at=now, updated_at=now)
        db.add(sample)
    else:
        _drop_files(sample)  # an older upload of this call
    sample.path = str(path)
    sample.speech_seconds = None
    _set(sample, WAITING, _waiting(member.name))
    db.commit()

    if settle(call.id):
        return schemas.VoiceSampleAccepted(cloning=True)
    db.refresh(sample)
    return schemas.VoiceSampleAccepted(cloning=False, reason=sample.reason or _waiting(member.name))


# ---------------------------------------------------------------- the clone, in the background


async def _clone(call_id: str) -> None:
    """Clean, measure and clone this call's recording, then store the voice.
    Started by settle() only. Never raises (cancellation still propagates)."""
    try:
        with new_session() as db:
            sample = db.get(VoiceSample, call_id)
            if sample is None or sample.state != CLONING or not sample.path:
                return
            member = db.get(Member, sample.member_id)
            member_id, name, source = sample.member_id, member.name if member else "", Path(sample.path)
        minimum = get_settings().voice_sample_min_seconds
        seconds: float | None = None
        try:
            cleaned = await audio.clean_recording(source, cleaned_path(source))
            seconds = await speech_seconds(cleaned)
            if seconds is not None and seconds < minimum:
                _finish_failed(call_id, _too_short(name, seconds, minimum), seconds)
                return
            voice_id = await elevenlabs.clone_voice(f"callback-{member_id}", cleaned)
        except audio.AudioError as error:
            _finish_failed(call_id, f"The recording from the call could not be used: {error}", seconds)
            return
        except elevenlabs.ElevenLabsError as error:
            _finish_failed(call_id, f"The voice could not be cloned. {error.message}", seconds)
            return
        await _store(call_id, voice_id, cleaned, seconds)
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("making the voice from call %s failed", call_id)
        _finish_failed(call_id, "Something went wrong while making the voice.", None)
    finally:
        if _running.get(call_id) is asyncio.current_task():
            del _running[call_id]


def _finish_failed(call_id: str, reason: str, seconds: float | None) -> None:
    """The sample failed: delete its files, keep the reason, and set
    voice_status failed unless an earlier clone is still ready. Never raises."""
    try:
        with new_session() as db:
            sample = db.get(VoiceSample, call_id)
            if sample is None:
                return
            member = db.get(Member, sample.member_id)
            if member is not None and member.voice_status == "ready" and member.voice_id:
                reason += f" {member.name}'s earlier voice is still used."
            _drop_files(sample)
            sample.speech_seconds = seconds
            _set(sample, FAILED, reason)
            db.commit()
            voice_router._mark_clone_failed(db, sample.member_id)
    except Exception:
        log.exception("could not record the failed voice sample of %s", call_id)


async def _store(call_id: str, voice_id: str, cleaned: Path, seconds: float | None) -> None:
    """Store the new clone as the member's voice, after checking both
    consents again; otherwise delete it at ElevenLabs."""
    with new_session() as db:
        sample = db.get(VoiceSample, call_id)
        call = db.get(Call, call_id)
        member = db.get(Member, sample.member_id) if sample is not None else None
        if sample is None or call is None or member is None:
            await voice_router._delete_clone_quietly(voice_id)
            return
        why = refusal(db, call, member)
        if why is None and not (spoken_answer(db, call_id) is True and spoken_yes_recorded(db, call_id)):
            why = _no_yes(member.name)
        if why is not None:
            _let_go(sample, why)
            sample.speech_seconds = seconds
            db.commit()
            if member.opted_out_at is not None:  # keeps the id if this fails, so a retried opt-out deletes it
                try:
                    await voice_router._delete_new_clone_after_opt_out(db, member, voice_id)
                except schemas.ApiError:
                    log.error("voice %s, made after %s opted out, is not deleted yet", voice_id, member.id)
            else:
                await voice_router._delete_clone_quietly(voice_id)
            return
        old_voice_id = member.voice_id
        member.voice_id = voice_id
        member.voice_status = "ready"
        member.consent_clone_at = now_iso()
        source = Path(sample.path) if sample.path else None
        sample.path = None
        sample.speech_seconds = seconds
        _set(sample, READY, None)
        db.commit()

    target = voice_router.clean_path(sample.member_id)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        cleaned.replace(target)
    except OSError:
        log.exception("could not keep the cleaned recording of call %s", call_id)
        _unlink(cleaned)
    if source is not None:
        _unlink(source)
    if old_voice_id and old_voice_id != voice_id:
        await voice_router._delete_clone_quietly(old_voice_id)


# ---------------------------------------------------------------- status


def status(db: DbSession, call: Call) -> schemas.VoiceSampleStatus:
    """What became of this call's recording. Settles a waiting sample first
    (and so starts again a clone that a restart cut short)."""
    if call.kind != "welcome":
        return schemas.VoiceSampleStatus(call_id=call.id, state=NONE, reason=NOT_WELCOME)
    sample = db.get(VoiceSample, call.id)
    if sample is not None and sample.state in (WAITING, CLONING) and not is_running(call.id):
        settle(call.id)
        db.refresh(sample)
    member = db.get(Member, call.target_member_id)
    if sample is None or sample.state == NONE:
        reason = refusal(db, call, member) or (sample.reason if sample is not None else None) or NO_RECORDING
        return schemas.VoiceSampleStatus(call_id=call.id, state=NONE, reason=reason,
                                         speech_seconds=sample.speech_seconds if sample is not None else None)
    return schemas.VoiceSampleStatus(call_id=call.id, state=sample.state, reason=sample.reason,
                                     speech_seconds=sample.speech_seconds)


def member_status(db: DbSession, member: Member) -> schemas.VoiceSampleStatus:
    """status() of the member's latest answered welcome call."""
    call = db.scalar(
        select(Call)
        .where(Call.target_member_id == member.id, Call.kind == "welcome", Call.answered_at.is_not(None))
        .order_by(Call.created_at.desc(), Call.answered_at.desc())
        .limit(1)
    )
    if call is None:
        return schemas.VoiceSampleStatus(call_id=None, state=NONE, reason=NO_WELCOME_CALL)
    return status(db, call)
