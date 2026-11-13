"""Starting, answering, reporting and reading calls. OWNER: track B.

Rules (docs/backend.md):
- POST /api/practice-calls is a thin wrapper around create_practice()
  (below), which the weekly run (track C) also calls. The checks live in
  check_practice_gate(), which the scheduler also re-runs before ringing a
  scheduled practice.
- answer: in_progress, answered_at=now, COMMIT, then
  sessions.build_session(db, call). Never hold uncommitted writes across an
  await (db.py, "Hard rule").
- events: stamp t and seq via events.publish; tactic gets its label from
  schemas.TACTIC_LABELS; the first outcome also gets seconds_to_challenge;
  a welcome `consent` with given=true sets consent_practice_at and writes a
  consents row (practice, welcome_call).
- end: status ended, ended_at, ended_by, publish call.status, answer at
  once, then services.run_in_background(pipeline.after_call(call_id), ...).
"""

from fastapi import APIRouter
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.models import Call, Member

router = APIRouter(tags=["calls"])


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
    raise NotImplementedError


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
    raise NotImplementedError

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
