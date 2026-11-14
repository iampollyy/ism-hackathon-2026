"""The ElevenLabs layer: one httpx.AsyncClient, header xi-api-key,
base https://api.elevenlabs.io. OWNER: track A.

When settings.fake_elevenlabs is true, every function returns a fake without
any network call (token "fake-token-...", conversation_id "conv_fake_...",
voice_id "voice_fake_..."), so the whole flow runs without voice.

Errors are ElevenLabsError, a subclass of schemas.ApiError: if nobody catches
one, the app answers with the usual error shape (502 elevenlabs_failed, or
503 elevenlabs_not_configured / agent_not_configured). The API key is never
put in a message or a log line.
"""

import asyncio
import logging
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.config import get_settings
from app.schemas import ApiError

log = logging.getLogger("app.elevenlabs")

BASE_URL = "https://api.elevenlabs.io"

# Seconds per request. Cloning uploads a file, so it gets longer.
DEFAULT_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
CLONE_TIMEOUT = httpx.Timeout(90.0, connect=5.0)

AUDIO_TYPES = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "audio/webm",
               ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".ogg": "audio/ogg"}


class ElevenLabsError(ApiError):
    """Raised when ElevenLabs fails, answers with an error, or is not set up."""

    def __init__(self, message: str, *, status_code: int = 502, code: str = "elevenlabs_failed",
                 upstream_status: int | None = None) -> None:
        super().__init__(status_code, code, message)
        self.upstream_status = upstream_status


@dataclass
class ConversationToken:
    token: str
    conversation_id: str


# ---------------------------------------------------------------- the client

_client: httpx.AsyncClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None


def _http() -> httpx.AsyncClient:
    """The one shared client. A new one is made if the event loop changed
    (tests run each TestClient on its own loop)."""
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client.is_closed or _client_loop is not loop:
        _client = httpx.AsyncClient(base_url=BASE_URL, timeout=DEFAULT_TIMEOUT)
        _client_loop = loop
    return _client


def _is_fake() -> bool:
    return get_settings().fake_elevenlabs


def _headers() -> dict[str, str]:
    key = get_settings().elevenlabs_api_key
    if not key:
        raise ElevenLabsError("ELEVENLABS_API_KEY is not set.", status_code=503,
                              code="elevenlabs_not_configured")
    return {"xi-api-key": key}


def _require_agent(agent_id: str) -> None:
    if not agent_id:
        raise ElevenLabsError("No ElevenLabs agent id is set for this kind of call.", status_code=503,
                              code="agent_not_configured")


def _error_detail(response: httpx.Response) -> str:
    """A short, safe description of an error answer."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:200]
    detail = body.get("detail", body) if isinstance(body, dict) else body
    if isinstance(detail, dict):
        detail = detail.get("message") or detail.get("status") or detail
    return str(detail)[:200]


async def _request(method: str, path: str, *, timeout: httpx.Timeout | None = None,
                   **kwargs: Any) -> httpx.Response:
    """Send one request; raise ElevenLabsError on a network error or a non-2xx answer."""
    headers = _headers()
    try:
        response = await _http().request(method, path, headers=headers,
                                         timeout=timeout or DEFAULT_TIMEOUT, **kwargs)
    except httpx.HTTPError as error:
        raise ElevenLabsError(f"ElevenLabs could not be reached ({type(error).__name__}).") from error
    if response.is_success:
        return response
    raise ElevenLabsError(
        f"ElevenLabs answered {response.status_code} to {method} {path}: {_error_detail(response)}",
        upstream_status=response.status_code,
    )


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError as error:
        raise ElevenLabsError("ElevenLabs answered with something that is not JSON.") from error
    if not isinstance(body, dict):
        raise ElevenLabsError("ElevenLabs answered with an unexpected shape.")
    return body


def _fake_suffix(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", text)[:40]


# ---------------------------------------------------------------- the calls


async def conversation_token(agent_id: str) -> ConversationToken:
    """GET /v1/convai/conversation/token?agent_id=... -> token and conversation_id.
    Ask on Answer, not earlier. Raises ElevenLabsError on failure."""
    if _is_fake():
        return ConversationToken(token=f"fake-token-{_fake_suffix(agent_id or 'agent')}",
                                 conversation_id=f"conv_fake_{secrets.token_hex(6)}")
    _require_agent(agent_id)
    body = _json(await _request("GET", "/v1/convai/conversation/token", params={"agent_id": agent_id}))
    token = body.get("token")
    if not isinstance(token, str) or not token:
        raise ElevenLabsError("ElevenLabs gave no conversation token.")
    conversation_id = body.get("conversation_id") or ""
    if not conversation_id:
        log.warning("the token answer had no conversation_id; the transcript cannot be fetched later")
    return ConversationToken(token=token, conversation_id=str(conversation_id))


async def signed_url(agent_id: str) -> str:
    """GET /v1/convai/conversation/get-signed-url?agent_id=... -> the signed
    WebSocket URL (fallback if WebRTC fails; valid 15 minutes)."""
    if _is_fake():
        return f"wss://fake.elevenlabs.invalid/v1/convai/conversation?agent_id={_fake_suffix(agent_id or 'agent')}"
    _require_agent(agent_id)
    body = _json(await _request("GET", "/v1/convai/conversation/get-signed-url",
                                params={"agent_id": agent_id}))
    url = body.get("signed_url")
    if not isinstance(url, str) or not url:
        raise ElevenLabsError("ElevenLabs gave no signed URL.")
    return url


async def clone_voice(name: str, path: Path) -> str:
    """POST /v1/voices/add, multipart `name` and `files` (the cleaned audio at
    `path`) -> the new voice_id. Raises ElevenLabsError on failure."""
    if _is_fake():
        return f"voice_fake_{_fake_suffix(name)}"
    try:
        content = await asyncio.to_thread(path.read_bytes)
    except OSError as error:
        raise ElevenLabsError(f"The recording to clone could not be read: {path.name}") from error
    content_type = AUDIO_TYPES.get(path.suffix.lower(), "application/octet-stream")
    response = await _request(
        "POST", "/v1/voices/add", timeout=CLONE_TIMEOUT,
        data={"name": name},
        files=[("files", (path.name, content, content_type))],
    )
    voice_id = _json(response).get("voice_id")
    if not isinstance(voice_id, str) or not voice_id:
        raise ElevenLabsError("ElevenLabs made no voice id.")
    return voice_id


def _voice_already_gone(error: ElevenLabsError) -> bool:
    if error.upstream_status == 404:
        return True
    text = error.message.lower()
    return error.upstream_status in (400, 422) and ("not_found" in text or "does_not_exist" in text
                                                    or "not found" in text)


async def delete_voice(voice_id: str) -> None:
    """DELETE /v1/voices/{voice_id}. A voice that is already gone (404) counts
    as deleted. Raises ElevenLabsError on other failures."""
    if _is_fake():
        return
    try:
        await _request("DELETE", f"/v1/voices/{voice_id}")
    except ElevenLabsError as error:
        if _voice_already_gone(error):
            log.info("voice %s was already gone at ElevenLabs", voice_id)
            return
        raise


async def get_conversation(conversation_id: str) -> dict[str, Any]:
    """GET /v1/convai/conversations/{conversation_id} -> the JSON as a dict:
    `status` (initiated | in-progress | processing | done | failed),
    `transcript` (list of {role, message, time_in_call_secs}), `analysis`."""
    if _is_fake():
        return {"conversation_id": conversation_id, "status": "done", "transcript": [], "analysis": {}}
    return _json(await _request("GET", f"/v1/convai/conversations/{conversation_id}"))


async def conversation_audio(conversation_id: str) -> bytes:
    """GET /v1/convai/conversations/{conversation_id}/audio -> audio bytes
    (path not confirmed; optional). The fake is empty."""
    if _is_fake():
        return b""
    response = await _request("GET", f"/v1/convai/conversations/{conversation_id}/audio",
                              timeout=httpx.Timeout(60.0, connect=5.0))
    return response.content
