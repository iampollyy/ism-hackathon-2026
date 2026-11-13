"""Starting, answering, reporting and reading calls. OWNER: track B.

Rules (docs/backend.md):
- POST /api/practice-calls checks in order: both members exist in one family
  (404 not_found); target consented to practice and not opted out (409
  consent_missing); voice member consented to cloning, voice ready, not opted
  out (409 voice_not_ready); target has no call ringing or in progress (409
  busy); target's phone seen in the last ten seconds (409 phone_offline).
  Then briefs.build_brief(...), store brief_json, caller_label,
  caller_number, and set ringing (ring_at=now) or scheduled (scheduled_for).
- answer: in_progress, answered_at=now, sessions.build_session(db, call).
- events: stamp t and seq via events.publish; tactic gets its label from
  schemas.TACTIC_LABELS; the first outcome also gets seconds_to_challenge;
  a welcome `consent` with given=true sets consent_practice_at and writes a
  consents row (practice, welcome_call).
- end: status ended, ended_at, ended_by, publish call.status, answer at
  once, then services.run_in_background(pipeline.after_call(call_id), ...).
"""

from fastapi import APIRouter

from app import schemas

router = APIRouter(tags=["calls"])

SAMPLE_SESSION = schemas.Session(
    kind="practice",
    conversation_token="sample-token",
    conversation_id="conv_sample",
    overrides={"tts": {"voiceId": "sample-voice-id"}},
    dynamic_variables={
        "target_name": "Sara",
        "caller_claim": "her son Jon",
        "address_as": "Mum",
        "opening_line": "Mum? It's me. I dropped my phone, so this is a new number.",
        "scenario_brief": "You lost your phone on the way to work and are borrowing a colleague's.",
        "ask": "a transfer of 400 euros today, to a friend's account",
        "tactic_order": "new_number, urgency, secrecy",
        "difficulty": 2,
        "reveal_line": "Sara, this was a Callback practice call. "
                       "The voice you heard was artificial, made with Jon's permission.",
    },
    max_seconds=150,
    reveal=schemas.Reveal(voice_of="Jon"),
)


def sample_call(call_id: str) -> schemas.CallView:
    return schemas.CallView(
        id=call_id,
        kind="practice",
        status="scored",
        target=schemas.PersonRef(id="mem_Qz81hT0a", name="Sara"),
        voice_of=schemas.PersonRef(id="mem_7Lr2pWcd", name="Jon"),
        scenario="relative_new_number",
        difficulty=2,
        caller_label="Unknown number",
        turns=[
            schemas.TurnView(speaker="agent", text="Mum? It's me. I dropped my phone, so this is a new number.",
                             t=1.2, tactic="new_number"),
            schemas.TurnView(speaker="user", text="Jon? What's our family word?", t=9.8),
        ],
        tactics=[schemas.TacticView(key="new_number", label=schemas.TACTIC_LABELS["new_number"], t=1.2)],
        result=schemas.CallResultView(
            outcome="asked_safe_word",
            seconds_to_challenge=9.8,
            lesson="You asked for the family word straight away. Keep doing exactly that.",
            debrief="The caller claimed a new number and asked for money. You asked for the family word. "
                    "Next time, do the same, then ring the family number.",
            tactics_used=["new_number"],
            tactics_worked=[],
        ),
        callback_seconds=14.0,
        answered_at="2026-11-13T18:00:00+00:00",
        ended_at="2026-11-13T18:00:41+00:00",
        ended_by="agent",
    )


@router.post("/practice-calls", status_code=201, response_model=schemas.CallCreated)
async def create_practice_call(body: schemas.PracticeCallCreate) -> schemas.CallCreated:
    # STUB (track B): replace
    return schemas.CallCreated(call_id="call_9f3k", status="scheduled" if body.delay_seconds else "ringing")


@router.post("/members/{member_id}/welcome-call", status_code=201, response_model=schemas.CallCreated)
async def create_welcome_call(member_id: str) -> schemas.CallCreated:
    # STUB (track B): replace. Creates a welcome call, status ringing.
    return schemas.CallCreated(call_id="call_w3lc", status="ringing")


@router.post("/calls/{call_id}/answer", response_model=schemas.Session)
async def answer_call(call_id: str) -> schemas.Session:
    # STUB (track B): replace
    return SAMPLE_SESSION


@router.post("/calls/{call_id}/decline", response_model=schemas.Ok)
async def decline_call(call_id: str) -> schemas.Ok:
    # STUB (track B): replace
    return schemas.Ok()


@router.post("/calls/{call_id}/events", response_model=schemas.Ok)
async def post_events(call_id: str, body: schemas.EventsBatch) -> schemas.Ok:
    # STUB (track B): replace
    return schemas.Ok()


@router.post("/calls/{call_id}/end", response_model=schemas.Ok)
async def end_call(call_id: str, body: schemas.EndRequest) -> schemas.Ok:
    # STUB (track B): replace
    return schemas.Ok()


@router.get("/calls/{call_id}", response_model=schemas.CallView)
async def get_call(call_id: str) -> schemas.CallView:
    # STUB (track B): replace
    return sample_call(call_id)
