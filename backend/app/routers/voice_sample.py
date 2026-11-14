"""The member's voice from their own side of the welcome call. Full app, track 2.

POST /api/calls/{call_id}/voice-sample: multipart, one file field `audio`,
the phone page's recording of the member's own microphone during the
welcome call, sent when the call ends. The same types and size limit as
POST /api/members/{id}/voice (its helpers are reused). Welcome calls that
were answered only (409 otherwise); 409 opted_out for a member who left.
Answers at once with {accepted, cloning, reason}; the clone, if both
consents are in, is made in the background.

GET /api/calls/{call_id}/voice-sample/status: what became of that call's
recording, {call_id, state, reason, speech_seconds}.

GET /api/members/{member_id}/voice-sample: the same for the member's latest
answered welcome call that has a recording, else their latest answered one,
for the family page.

The rules (two consents, the order, the cap, the files) are in
services/voice_sample.py; the front end's guide is
docs/full-app/voice-from-call.md.
"""

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import get_db
from app.routers import voice as voice_router
from app.routers.calls import get_call, get_member
from app.services import voice_sample

router = APIRouter(tags=["voice sample"])


@router.post("/calls/{call_id}/voice-sample", response_model=schemas.VoiceSampleAccepted)
async def upload_voice_sample(call_id: str, audio: UploadFile = File(...),
                              db: DbSession = Depends(get_db)) -> schemas.VoiceSampleAccepted:
    call = get_call(db, call_id)
    voice_sample.check_call(call)
    member = get_member(db, call.target_member_id)
    if member.opted_out_at is not None:
        raise schemas.ApiError(409, "opted_out", "This member has opted out.")
    content = await voice_router._read_upload(audio)
    extension = voice_router.upload_extension(audio.filename, audio.content_type)
    return await voice_sample.receive(db, call, member, content, extension)


@router.get("/calls/{call_id}/voice-sample/status", response_model=schemas.VoiceSampleStatus)
async def voice_sample_status(call_id: str, db: DbSession = Depends(get_db)) -> schemas.VoiceSampleStatus:
    return voice_sample.status(db, get_call(db, call_id))


@router.get("/members/{member_id}/voice-sample", response_model=schemas.VoiceSampleStatus)
async def member_voice_sample(member_id: str, db: DbSession = Depends(get_db)) -> schemas.VoiceSampleStatus:
    return voice_sample.member_status(db, get_member(db, member_id))
