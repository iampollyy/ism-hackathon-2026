"""Voice upload, clone deletion and opt-out. OWNER: track A.

POST /api/members/{id}/voice: multipart, one file field `audio` (webm or mp4).
1. Save the upload unchanged as media/consent/{member_id}.{ext}: it opens with
   the spoken consent sentence, so it is the consent record. Write a consents
   row (clone, voice_recording) and commit.
2. Clean a copy with ffmpeg (services.audio) into media/voices/.
3. Clone it (services.elevenlabs.clone_voice). Store voice_id, voice_status
   ready and consent_clone_at now; delete the member's previous clone.
4. {"voice_ready": true}, or 502 clone_failed.

DELETE /api/members/{id}/voice deletes the clone at ElevenLabs, then clears
voice_id and sets voice_status deleted (rule 7: deletion is real).
POST /api/members/{id}/opt-out records the opt-out first, so no new practice
can start, then deletes the clone the same way.

Every write is committed before awaiting ffmpeg or ElevenLabs (db.py, "Hard rule").
"""

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.config import get_settings
from app.db import get_db, now_iso
from app.models import Consent, Member
from app.services import audio as audio_service
from app.services import elevenlabs

log = logging.getLogger("app.voice")

router = APIRouter(tags=["voice"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
EXTENSIONS = {"webm", "mp4", "m4a", "ogg", "oga", "wav", "mp3", "aac", "caf"}
CONTENT_TYPE_EXTENSIONS = {
    "audio/webm": "webm", "video/webm": "webm",
    "audio/mp4": "mp4", "video/mp4": "mp4", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
    "audio/aac": "aac", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/wave": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/x-caf": "caf",
}


# ---------------------------------------------------------------- helpers


def _member_or_404(db: DbSession, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None:
        raise schemas.ApiError(404, "not_found", "No such member.")
    return member


def upload_extension(filename: str | None, content_type: str | None) -> str:
    """The file's extension, from its name or else its type. "bin" if neither
    says; ffmpeg reads the file by its content anyway."""
    suffix = Path(filename or "").suffix.lower().lstrip(".")
    if suffix in EXTENSIONS:
        return suffix
    base_type = (content_type or "").split(";")[0].strip().lower()
    return CONTENT_TYPE_EXTENSIONS.get(base_type, "bin")


def consent_path(member_id: str, extension: str) -> Path:
    return get_settings().media_path / "consent" / f"{member_id}.{extension}"


def clean_path(member_id: str) -> Path:
    return get_settings().media_path / "voices" / f"{member_id}.mp3"


async def _read_upload(upload: UploadFile) -> bytes:
    content = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise schemas.ApiError(413, "too_large", "The recording is larger than 25 MB.")
    if not content:
        raise schemas.ApiError(422, "invalid_request", "The recording is empty.")
    return content


def _write_file(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


async def _save_consent_recording(db: DbSession, member: Member, content: bytes, extension: str) -> Path:
    """Write the original file (off the event loop, before any db write), then
    its consents row; commit."""
    path = consent_path(member.id, extension)
    await asyncio.to_thread(_write_file, path, content)
    db.add(Consent(member_id=member.id, kind="clone", source="voice_recording",
                   evidence=str(path), created_at=now_iso()))
    db.commit()
    return path


def _mark_clone_failed(db: DbSession, member_id: str) -> None:
    """voice_status failed, unless an earlier clone is still ready."""
    member = db.get(Member, member_id)
    if member is not None:
        db.refresh(member)
        if member.voice_status != "ready":
            member.voice_status = "failed"
            db.commit()


async def _delete_clone_quietly(voice_id: str) -> None:
    """Delete a replaced clone. If that fails, the log line keeps its id,
    so it can still be deleted by hand."""
    try:
        await elevenlabs.delete_voice(voice_id)
    except elevenlabs.ElevenLabsError:
        log.exception("could not delete replaced voice %s at ElevenLabs; delete it by hand", voice_id)


async def _delete_new_clone_after_opt_out(db: DbSession, member: Member, new_voice_id: str) -> None:
    """The member opted out while their clone was being made: delete it. If
    that fails, store its id (opted_out_at already blocks every use) so a
    retried opt-out deletes it, and answer 502 voice_delete_failed."""
    try:
        await elevenlabs.delete_voice(new_voice_id)
    except elevenlabs.ElevenLabsError as error:
        db.refresh(member)
        old_voice_id = member.voice_id
        member.voice_id = new_voice_id
        member.voice_status = "ready"
        db.commit()
        if old_voice_id and old_voice_id != new_voice_id:
            log.error("voice %s was not deleted after an opt-out; delete it by hand", old_voice_id)
        raise _delete_failed(error) from error


def _delete_failed(error: elevenlabs.ElevenLabsError) -> schemas.ApiError:
    return schemas.ApiError(502, "voice_delete_failed",
                            f"The voice could not be deleted at ElevenLabs: {error.message}")


async def _delete_clone(db: DbSession, member: Member, delete_newer: bool = False) -> None:
    """Delete the member's clone at ElevenLabs, then clear it here and commit.
    Raises 502 voice_delete_failed, keeping the id so a retry can delete it.

    A new recording may store a new clone while this one is being deleted.
    Its status is then left alone, unless delete_newer (an opt-out), which
    deletes that clone too."""
    had_clone = bool(member.voice_id)
    voice_id = member.voice_id
    while voice_id:
        try:
            await elevenlabs.delete_voice(voice_id)
        except elevenlabs.ElevenLabsError as error:
            raise _delete_failed(error) from error
        db.refresh(member)
        if member.voice_id == voice_id:
            member.voice_id = None
        voice_id = member.voice_id if delete_newer else None
    if member.voice_id is None and (had_clone or member.voice_status != "none"):
        member.voice_status = "deleted"
    db.commit()
    if member.voice_id is None:
        clean_path(member.id).unlink(missing_ok=True)


# ---------------------------------------------------------------- endpoints


@router.post("/members/{member_id}/voice", response_model=schemas.VoiceReady)
async def upload_voice(member_id: str, audio: UploadFile = File(...),
                       db: DbSession = Depends(get_db)) -> schemas.VoiceReady:
    member = _member_or_404(db, member_id)
    if member.opted_out_at:
        raise schemas.ApiError(409, "opted_out", "This member has opted out.")
    content = await _read_upload(audio)
    extension = upload_extension(audio.filename, audio.content_type)
    original = await _save_consent_recording(db, member, content, extension)

    try:
        cleaned = await audio_service.clean_recording(original, clean_path(member_id))
        new_voice_id = await elevenlabs.clone_voice(f"callback-{member_id}", cleaned)
    except (audio_service.AudioError, elevenlabs.ElevenLabsError) as error:
        _mark_clone_failed(db, member_id)
        message = error.message if isinstance(error, elevenlabs.ElevenLabsError) else str(error)
        raise schemas.ApiError(502, "clone_failed", f"The voice could not be cloned. {message}") from error

    db.refresh(member)
    if member.opted_out_at:  # opted out while the clone was being made
        await _delete_new_clone_after_opt_out(db, member, new_voice_id)
        raise schemas.ApiError(409, "opted_out", "This member has opted out.")
    old_voice_id = member.voice_id
    member.voice_id = new_voice_id
    member.voice_status = "ready"
    member.consent_clone_at = now_iso()
    db.commit()

    if old_voice_id and old_voice_id != new_voice_id:
        await _delete_clone_quietly(old_voice_id)
    return schemas.VoiceReady(voice_ready=True)


@router.delete("/members/{member_id}/voice", response_model=schemas.Ok)
async def delete_voice(member_id: str, db: DbSession = Depends(get_db)) -> schemas.Ok:
    member = _member_or_404(db, member_id)
    await _delete_clone(db, member)
    return schemas.Ok()


@router.post("/members/{member_id}/opt-out", response_model=schemas.Ok)
async def opt_out(member_id: str, db: DbSession = Depends(get_db)) -> schemas.Ok:
    member = _member_or_404(db, member_id)
    if not member.opted_out_at:
        now = now_iso()
        member.opted_out_at = now
        db.add(Consent(member_id=member.id, kind="opt_out", source="manual",
                       evidence="Opted out from the app.", created_at=now))
        db.commit()
    await _delete_clone(db, member, delete_newer=True)
    return schemas.Ok()
