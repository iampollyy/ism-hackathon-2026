"""The ElevenLabs layer: one httpx.AsyncClient, header xi-api-key,
base https://api.elevenlabs.io. OWNER: track A.

When settings.fake_elevenlabs is true, every function returns a fake without
any network call (token "fake-token", conversation_id "conv_fake_...",
voice_id "voice_fake_..."), so the whole flow runs without voice.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

BASE_URL = "https://api.elevenlabs.io"


class ElevenLabsError(Exception):
    """Raised when ElevenLabs fails or answers with an error."""


@dataclass
class ConversationToken:
    token: str
    conversation_id: str


async def conversation_token(agent_id: str) -> ConversationToken:
    """GET /v1/convai/conversation/token?agent_id=... -> token and conversation_id.
    Ask on Answer, not earlier. Raises ElevenLabsError on failure.
    OWNER: track A."""
    raise NotImplementedError


async def signed_url(agent_id: str) -> str:
    """GET /v1/convai/conversation/get-signed-url?agent_id=... -> the signed
    WebSocket URL (fallback if WebRTC fails; valid 15 minutes).
    OWNER: track A."""
    raise NotImplementedError


async def clone_voice(name: str, path: Path) -> str:
    """POST /v1/voices/add, multipart `name` and `files` (the cleaned audio at
    `path`) -> the new voice_id. Raises ElevenLabsError on failure.
    OWNER: track A."""
    raise NotImplementedError


async def delete_voice(voice_id: str) -> None:
    """DELETE /v1/voices/{voice_id}. A voice that is already gone (404) counts
    as deleted. Raises ElevenLabsError on other failures.
    OWNER: track A."""
    raise NotImplementedError


async def get_conversation(conversation_id: str) -> dict[str, Any]:
    """GET /v1/convai/conversations/{conversation_id} -> the JSON as a dict:
    `status` (initiated | in-progress | processing | done | failed),
    `transcript` (list of {role, message, time_in_call_secs}), `analysis`.
    OWNER: track A."""
    raise NotImplementedError


async def conversation_audio(conversation_id: str) -> bytes:
    """GET /v1/convai/conversations/{conversation_id}/audio -> audio bytes
    (path not confirmed; optional). OWNER: track A."""
    raise NotImplementedError
