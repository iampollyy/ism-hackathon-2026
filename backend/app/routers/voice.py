"""Voice upload, clone deletion and opt-out. OWNER: track A.

POST /api/members/{id}/voice: multipart, one file field `audio` (webm or mp4).
Save unchanged as media/consent/{member_id}.{ext}, write a consents row
(clone, voice_recording), clean a copy with services.audio, clone it with
services.elevenlabs.clone_voice, store voice_id, voice_status=ready,
consent_clone_at=now. 502 clone_failed on failure.
"""

from fastapi import APIRouter, File, UploadFile

from app import schemas

router = APIRouter(tags=["voice"])


@router.post("/members/{member_id}/voice", response_model=schemas.VoiceReady)
async def upload_voice(member_id: str, audio: UploadFile = File(...)) -> schemas.VoiceReady:
    # STUB (track A): replace
    return schemas.VoiceReady(voice_ready=True)


@router.delete("/members/{member_id}/voice", response_model=schemas.Ok)
async def delete_voice(member_id: str) -> schemas.Ok:
    # STUB (track A): replace. Calls elevenlabs.delete_voice, clears voice_id,
    # sets voice_status=deleted.
    return schemas.Ok()


@router.post("/members/{member_id}/opt-out", response_model=schemas.Ok)
async def opt_out(member_id: str) -> schemas.Ok:
    # STUB (track A): replace. Sets opted_out_at, writes a consents row
    # (opt_out, manual), deletes the clone as above.
    return schemas.Ok()
