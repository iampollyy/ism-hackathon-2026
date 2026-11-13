"""What each phone page asks for. OWNER: track B.

- GET /api/members/{id}/phone-state, once a second: records last_seen_at;
  incoming_call is set only while a welcome or practice call for this
  member is ringing; messages are the unread ones.
- POST /api/members/{id}/messages/read: marks messages read (all, or `ids`).
- POST /api/members/{id}/family-line: finds this member's latest practice
  that ended in the last ten minutes (404 not_found if none), stores
  callback_seconds on that call (and the result if it exists), creates a
  family_line call (parent_call_id = the practice, status in_progress,
  answered_at now), publishes callback.connected {seconds} on the practice's
  stream, writes a callback_notice message for the voice member ("Sara called
  the family number after a practice."), returns call_id and the session
  from sessions.build_session.
"""

from fastapi import APIRouter, Body

from app import schemas

router = APIRouter(tags=["phone"])


@router.get("/members/{member_id}/phone-state", response_model=schemas.PhoneState)
async def phone_state(member_id: str) -> schemas.PhoneState:
    # STUB (track B): replace
    return schemas.PhoneState(
        member=schemas.PhoneMember(id=member_id, name="Sara", family="The Kovacs"),
        incoming_call=schemas.IncomingCall(
            call_id="call_9f3k", kind="practice",
            caller=schemas.Caller(label="Unknown number", number="+00 600 555 0142"),
        ),
        messages=[schemas.PhoneMessage(
            id=12, kind="weekly", created_at="2026-11-13T18:00:00+00:00",
            text="This week: callers posing as a bank's security team. Never read out a code.",
        )],
        family_number=schemas.FamilyNumber(enabled=True),
    )


@router.post("/members/{member_id}/messages/read", response_model=schemas.Ok)
async def read_messages(member_id: str, body: schemas.MessagesRead | None = Body(default=None)) -> schemas.Ok:
    # STUB (track B): replace
    return schemas.Ok()


@router.post("/members/{member_id}/family-line", response_model=schemas.FamilyLineStarted)
async def family_line(member_id: str) -> schemas.FamilyLineStarted:
    # STUB (track B): replace
    return schemas.FamilyLineStarted(
        call_id="call_f4m1",
        session=schemas.Session(
            kind="family_line",
            conversation_token="sample-token",
            conversation_id="conv_sample_family",
            overrides={},
            dynamic_variables={
                "caller_name": "Sara",
                "relative_name": "Jon",
                "what_happened": "a practice call in Jon's voice about a new phone number",
            },
            max_seconds=60,
        ),
    )
