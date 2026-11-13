"""Track A tests: services/elevenlabs.py. OWNER: track A.

Real-API paths run against respx mocks; fake mode must never touch the network.
"""

from pathlib import Path

import httpx
import pytest
import respx

from app.config import get_settings
from app.schemas import ApiError
from app.services import elevenlabs

EL = elevenlabs.BASE_URL
KEY = "test-key-123"


@pytest.fixture
def real(monkeypatch) -> None:
    monkeypatch.setenv("FAKE_ELEVENLABS", "false")
    monkeypatch.setenv("ELEVENLABS_API_KEY", KEY)
    get_settings.cache_clear()


# ---------------------------------------------------------------- real paths


async def test_conversation_token_sends_key_and_agent(real) -> None:
    with respx.mock(base_url=EL) as router:
        route = router.get("/v1/convai/conversation/token").respond(
            200, json={"token": "tok_1", "conversation_id": "conv_1"})
        token = await elevenlabs.conversation_token("agent_x")
    assert token == elevenlabs.ConversationToken(token="tok_1", conversation_id="conv_1")
    request = route.calls.last.request
    assert request.headers["xi-api-key"] == KEY
    assert request.url.params["agent_id"] == "agent_x"


async def test_conversation_token_without_id_is_still_a_token(real) -> None:
    with respx.mock(base_url=EL) as router:
        router.get("/v1/convai/conversation/token").respond(200, json={"token": "tok_2"})
        token = await elevenlabs.conversation_token("agent_x")
    assert token.token == "tok_2" and token.conversation_id == ""


async def test_conversation_token_without_token_fails(real) -> None:
    with respx.mock(base_url=EL) as router:
        router.get("/v1/convai/conversation/token").respond(200, json={})
        with pytest.raises(elevenlabs.ElevenLabsError):
            await elevenlabs.conversation_token("agent_x")


async def test_signed_url(real) -> None:
    with respx.mock(base_url=EL) as router:
        route = router.get("/v1/convai/conversation/get-signed-url").respond(
            200, json={"signed_url": "wss://example.invalid/x"})
        assert await elevenlabs.signed_url("agent_y") == "wss://example.invalid/x"
    assert route.calls.last.request.url.params["agent_id"] == "agent_y"


async def test_clone_voice_posts_multipart(real, tmp_path: Path) -> None:
    sample = tmp_path / "clean.mp3"
    sample.write_bytes(b"ID3-fake-mp3-bytes")
    with respx.mock(base_url=EL) as router:
        route = router.post("/v1/voices/add").respond(200, json={"voice_id": "v_123"})
        assert await elevenlabs.clone_voice("callback-mem_1", sample) == "v_123"
    request = route.calls.last.request
    body = request.content
    assert request.headers["xi-api-key"] == KEY
    assert request.headers["content-type"].startswith("multipart/form-data")
    assert b'name="name"' in body and b"callback-mem_1" in body
    assert b'name="files"; filename="clean.mp3"' in body and b"ID3-fake-mp3-bytes" in body


async def test_delete_voice(real) -> None:
    with respx.mock(base_url=EL) as router:
        route = router.delete("/v1/voices/v_1").respond(200, json={"status": "ok"})
        await elevenlabs.delete_voice("v_1")
    assert route.called


async def test_delete_voice_already_gone_counts_as_deleted(real) -> None:
    with respx.mock(base_url=EL) as router:
        router.delete("/v1/voices/v_gone").respond(404, json={"detail": "not found"})
        await elevenlabs.delete_voice("v_gone")


async def test_delete_voice_server_error_raises(real) -> None:
    with respx.mock(base_url=EL) as router:
        router.delete("/v1/voices/v_1").respond(500, json={"detail": "boom"})
        with pytest.raises(elevenlabs.ElevenLabsError) as caught:
            await elevenlabs.delete_voice("v_1")
    assert caught.value.upstream_status == 500
    assert caught.value.status_code == 502


async def test_get_conversation_and_audio(real) -> None:
    with respx.mock(base_url=EL) as router:
        router.get("/v1/convai/conversations/conv_9").respond(
            200, json={"status": "done", "transcript": [{"role": "agent", "message": "Hi"}]})
        router.get("/v1/convai/conversations/conv_9/audio").respond(200, content=b"audio-bytes")
        conversation = await elevenlabs.get_conversation("conv_9")
        audio = await elevenlabs.conversation_audio("conv_9")
    assert conversation["status"] == "done"
    assert audio == b"audio-bytes"


async def test_http_error_is_elevenlabs_error_without_the_key(real) -> None:
    with respx.mock(base_url=EL) as router:
        router.get("/v1/convai/conversation/token").respond(401, json={"detail": {"message": "bad key"}})
        with pytest.raises(elevenlabs.ElevenLabsError) as caught:
            await elevenlabs.conversation_token("agent_x")
    assert caught.value.upstream_status == 401
    assert "bad key" in caught.value.message
    assert KEY not in caught.value.message


async def test_network_error_is_elevenlabs_error(real) -> None:
    with respx.mock(base_url=EL) as router:
        router.get("/v1/convai/conversation/token").mock(side_effect=httpx.ConnectError("down"))
        with pytest.raises(elevenlabs.ElevenLabsError) as caught:
            await elevenlabs.conversation_token("agent_x")
    assert caught.value.code == "elevenlabs_failed"


async def test_missing_api_key_is_503_without_a_request(monkeypatch) -> None:
    monkeypatch.setenv("FAKE_ELEVENLABS", "false")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")
    get_settings.cache_clear()
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.get("/v1/convai/conversation/token").respond(200, json={"token": "x"})
        with pytest.raises(elevenlabs.ElevenLabsError) as caught:
            await elevenlabs.conversation_token("agent_x")
    assert not route.called
    assert caught.value.status_code == 503
    assert caught.value.code == "elevenlabs_not_configured"


async def test_missing_agent_id_is_503_agent_not_configured(real) -> None:
    with respx.mock(base_url=EL, assert_all_called=False):
        with pytest.raises(elevenlabs.ElevenLabsError) as caught:
            await elevenlabs.conversation_token("")
    assert (caught.value.status_code, caught.value.code) == (503, "agent_not_configured")


def test_elevenlabs_error_is_an_api_error() -> None:
    error = elevenlabs.ElevenLabsError("boom")
    assert isinstance(error, ApiError) and isinstance(error, Exception)
    assert (error.status_code, error.code, error.message) == (502, "elevenlabs_failed", "boom")


# ---------------------------------------------------------------- fake mode


async def test_fake_mode_returns_fakes_without_network(tmp_path: Path) -> None:
    assert get_settings().fake_elevenlabs is True
    sample = tmp_path / "clean.mp3"
    sample.write_bytes(b"x")
    with respx.mock(assert_all_mocked=True, assert_all_called=False):  # any real request would fail
        token = await elevenlabs.conversation_token("agent_practice_test")
        other = await elevenlabs.conversation_token("agent_practice_test")
        voice_id = await elevenlabs.clone_voice("callback-mem_1", sample)
        await elevenlabs.delete_voice(voice_id)
        conversation = await elevenlabs.get_conversation(token.conversation_id)
        url = await elevenlabs.signed_url("agent_practice_test")
        audio = await elevenlabs.conversation_audio(token.conversation_id)
    assert token.token.startswith("fake-token-")
    assert token.conversation_id.startswith("conv_fake_")
    assert token.conversation_id != other.conversation_id
    assert voice_id.startswith("voice_fake_")
    assert conversation["status"] == "done" and conversation["transcript"] == []
    assert url.startswith("wss://")
    assert audio == b""


async def test_fake_mode_works_without_agent_ids(monkeypatch) -> None:
    monkeypatch.setenv("ELEVENLABS_PRACTICE_AGENT_ID", "")
    get_settings.cache_clear()
    token = await elevenlabs.conversation_token("")
    assert token.token.startswith("fake-token-")
