"""Builds the session object the phone page passes to startSession().
OWNER: track A."""

from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.models import Call


async def build_session(db: DbSession, call: Call) -> schemas.Session:
    """Build the session for a call that is being answered (or a family-line
    call that is starting).

    - Picks the agent for call.kind (settings.elevenlabs_*_agent_id).
    - Gets a token with elevenlabs.conversation_token(agent_id) and stores the
      returned conversation_id on the call (call.conversation_id; commit).
    - overrides carry only the voice: {"tts": {"voiceId": ...}} for a practice
      call (the voice member's clone, or the scenario's library voice);
      {} for welcome and family_line calls.
    - dynamic_variables: practice -> json.loads(call.brief_json);
      welcome -> member_name, organiser_name, family_name;
      family_line -> caller_name, relative_name, what_happened.
      Every value a string or a number. Never a safe word.
    - max_seconds = schemas.MAX_SECONDS[call.kind].
    - reveal = Reveal(voice_of=<voice member's name or None>) for practice,
      None otherwise.
    Raises elevenlabs.ElevenLabsError if the token cannot be had.
    OWNER: track A."""
    raise NotImplementedError
