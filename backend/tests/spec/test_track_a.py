"""Spec tests for TRACK A (ElevenLabs, voice, sessions, briefs, scenarios).

Written from docs/backend.md ("Voice", "The ElevenLabs layer", the session
example, "Rules enforced in code" 4 and 7) and docs/ai.md ("Settings", "Tools",
"Variables", the three prompts, "Scenario files"), not from the code.

Most tests go through the HTTP API in FAKE_ELEVENLABS mode. The real ElevenLabs
paths are tested with respx. Other tracks' calls are used only where a flow needs
them (practice-calls, answer, welcome-call, phone-state).
"""

import asyncio
import copy
import inspect
import json
import re
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy import select

from app import schemas
from app.config import BACKEND_DIR, get_settings
from app.db import new_session, now_iso
from app.ids import new_call_id
from app.models import Call, Consent, Member, Result
from app.schemas import ApiError
from app.services import audio, briefs, elevenlabs, scenarios, sessions

EL = "https://api.elevenlabs.io"
SCENARIO_KEYS = ["relative_new_number", "police", "bank_security", "hospital"]
LIBRARY_VOICES = {"police": "voice_police_test", "bank_security": "voice_bank_test", "hospital": "voice_nurse_test"}
AGENTS = {"welcome": "agent_welcome_test", "practice": "agent_practice_test", "family_line": "agent_family_line_test"}
REAL_BANK_NAMES = ["HSBC", "Barclays", "Deutsche Bank", "Santander"]
BRIEF_FIELDS = ["caller_claim", "opening_line", "scenario_brief", "ask", "tactic_order"]
CLONE_REVEAL = "Sara, this was a Callback practice call. The voice you heard was artificial, made with Jon's permission."
LIBRARY_REVEAL = "Sara, this was a Callback practice call. The voice you heard was artificial."
DOCS = BACKEND_DIR.parent / "docs"


# ---------------------------------------------------------------- helpers


@pytest.fixture(scope="module")
def sample_audio(tmp_path_factory) -> dict[str, bytes]:
    """Five seconds of stereo audio, two of them silent, as webm, mp4 and m4a."""
    folder = tmp_path_factory.mktemp("audio")
    out: dict[str, bytes] = {}
    for ext, codec in (("webm", "libopus"), ("mp4", "aac"), ("m4a", "aac")):
        path = folder / f"in.{ext}"
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
             "sine=frequency=440:sample_rate=44100:duration=3", "-af",
             "adelay=2000:all=1,aformat=channel_layouts=stereo", "-c:a", codec, str(path)],
            check=True,
        )
        out[ext] = path.read_bytes()
    return out


@pytest.fixture(autouse=True)
def no_director(monkeypatch) -> None:
    """By default the director job adds nothing, so the template brief is used."""
    set_director(monkeypatch, None)


def set_director(monkeypatch, result: Any) -> list[tuple[Any, Any]]:
    """Replace director.improve_brief. `result` is a value, an exception to raise,
    or a callable(template_brief) returning the improved brief. Returns the calls seen."""
    from app.agents import director

    seen: list[tuple[Any, Any]] = []

    async def fake(template_brief: dict[str, Any], context: dict[str, Any]) -> dict[str, Any] | None:
        seen.append((copy.deepcopy(template_brief), context))
        if isinstance(result, BaseException):
            raise result
        if callable(result):
            return result(copy.deepcopy(template_brief))
        return result

    monkeypatch.setattr(director, "improve_brief", fake)
    monkeypatch.setattr(briefs, "improve_brief", fake, raising=False)
    return seen


def go_real(monkeypatch, key: str = "test-key", **env: str) -> None:
    """Switch off FAKE_ELEVENLABS and give an API key (and other env overrides)."""
    monkeypatch.setenv("FAKE_ELEVENLABS", "false")
    monkeypatch.setenv("ELEVENLABS_API_KEY", key)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()


def load(model: type, pk: str) -> Any:
    with new_session() as s:
        return s.get(model, pk)


def consents_of(member_id: str) -> list[Consent]:
    with new_session() as s:
        return list(s.scalars(select(Consent).where(Consent.member_id == member_id).order_by(Consent.id)))


def sara_and_jon(family: dict[str, Any]) -> tuple[str, str]:
    return family["members"][0]["id"], family["members"][1]["id"]


def give_voice(member_id: str, voice_id: str = "voice_jon_1") -> None:
    with new_session() as s:
        member = s.get(Member, member_id)
        member.voice_id = voice_id
        member.voice_status = "ready"
        member.consent_clone_at = now_iso()
        s.commit()


def error_of(response) -> dict[str, Any]:
    body = response.json()
    assert set(body) == {"error"}, body
    return body["error"]


def upload(client, member_id: str, data: bytes, filename: str = "recording.webm", mime: str = "audio/webm"):
    return client.post(f"/api/members/{member_id}/voice", files={"audio": (filename, data, mime)})


async def build(family: dict[str, Any], scenario: str, difficulty: int = 1, with_voice: bool | None = None):
    """Run briefs.build_brief for Sara (target) and Jon (voice, for the clone scenario)."""
    sara_id, jon_id = sara_and_jon(family)
    use_voice = (scenario == "relative_new_number") if with_voice is None else with_voice
    with new_session() as s:
        target = s.get(Member, sara_id)
        voice = s.get(Member, jon_id) if use_voice else None
        return await briefs.build_brief(s, target, voice, scenario, difficulty)


def stored_call(family: dict[str, Any], kind: str, *, scenario: str | None = None, difficulty: int = 1,
                voice: bool = False, brief: dict[str, Any] | None = None, status: str = "in_progress",
                parent: str | None = None, target: int = 0) -> str:
    """Insert a call row by hand (the caller 'committed its own writes before build_session')."""
    ids = [m["id"] for m in family["members"]]
    call_id = new_call_id()
    with new_session() as s:
        s.add(Call(
            id=call_id, family_id=family["family_id"], kind=kind, target_member_id=ids[target],
            voice_member_id=ids[1] if voice else None, scenario=scenario, difficulty=difficulty,
            brief_json=json.dumps(brief) if brief is not None else None, status=status,
            parent_call_id=parent, created_at=now_iso(), answered_at=now_iso(),
        ))
        s.commit()
    return call_id


async def practice_call_row(family: dict[str, Any], scenario: str = "relative_new_number", difficulty: int = 2) -> str:
    built = await build(family, scenario, difficulty)
    voice = scenario == "relative_new_number"
    return stored_call(family, "practice", scenario=scenario, difficulty=difficulty, voice=voice,
                       brief=built.variables)


async def session_for(call_id: str) -> schemas.Session:
    with new_session() as s:
        call = s.get(Call, call_id)
        return await sessions.build_session(s, call)


def start_practice(client, family: dict[str, Any], scenario: str = "relative_new_number", difficulty: int = 2) -> str:
    """The HTTP route: Sara's phone page is open, then a practice call is created."""
    sara_id, jon_id = sara_and_jon(family)
    assert client.get(f"/api/members/{sara_id}/phone-state").status_code == 200
    body: dict[str, Any] = {"target_member_id": sara_id, "scenario": scenario, "difficulty": difficulty}
    if scenario == "relative_new_number":
        give_voice(jon_id)
        body["voice_member_id"] = jon_id
    response = client.post("/api/practice-calls", json=body)
    assert response.status_code == 201, response.text
    return response.json()["call_id"]


def with_tactics(brief: dict[str, Any], keys: list[str]) -> Any:
    """A tactic_order in the same shape (list or string) as the template's."""
    return keys if isinstance(brief["tactic_order"], list) else ", ".join(keys)


def has_digit_run(text: str, n: int = 6) -> bool:
    return re.search(rf"\d{{{n},}}", text) is not None


def scenario_files() -> dict[str, dict[str, Any]]:
    folder = BACKEND_DIR / "app" / "scenarios"
    return {path.stem: json.loads(path.read_text()) for path in sorted(folder.glob("*.json"))}


def ai_md_block(heading: str, lang: str) -> str:
    text = (DOCS / "ai.md").read_text()
    after = text.split(heading, 1)[1]
    match = re.search(rf"```{lang}\n(.*?)```", after, re.S)
    assert match, heading
    return match.group(1)


# ---------------------------------------------------------------- scenario files and the picker


def test_scenarios_are_exactly_the_four_files() -> None:
    files = scenario_files()
    assert sorted(files) == sorted(SCENARIO_KEYS)
    for stem, data in files.items():
        assert data["key"] == stem
        assert data["title"] and data["caller_label"]
        assert data["allowed_tactics"] and set(data["allowed_tactics"]) <= set(schemas.TACTICS)
        assert set(data["template"]) >= set(BRIEF_FIELDS)


def test_scenario_voice_fields() -> None:
    files = scenario_files()
    assert files["relative_new_number"]["voice"] == "clone"
    assert files["police"]["voice"] == "ELEVENLABS_POLICE_VOICE_ID"
    for key in ("bank_security", "hospital"):
        assert re.fullmatch(r"ELEVENLABS_[A-Z_]+_VOICE_ID", files[key]["voice"])


@pytest.mark.parametrize("key", SCENARIO_KEYS)
def test_each_template_alone_makes_a_complete_call(key: str) -> None:
    data = scenario_files()[key]
    template = data["template"]
    for field in BRIEF_FIELDS:
        assert template[field], field
    order = template["tactic_order"]
    assert isinstance(order, list) and order
    assert set(order) <= set(data["allowed_tactics"])
    assert set(order) <= set(schemas.TACTICS)


@pytest.mark.parametrize("key", SCENARIO_KEYS)
def test_templates_follow_the_content_rules(key: str) -> None:
    text = json.dumps(scenario_files()[key]["template"]).lower()
    assert not has_digit_run(text), "no run of six or more digits"
    for name in REAL_BANK_NAMES + ["scotland yard", "interpol", "europol", "fbi"]:
        assert name.lower() not in text
    for word in ("accident", "injur", "arrest", "kidnap", "emergency", "died", "death"):
        assert word not in text, word


def test_hospital_is_an_unpaid_appointment_fee() -> None:
    text = json.dumps(scenario_files()["hospital"]["template"]).lower()
    assert "fee" in text and "appointment" in text


def test_scenarios_service() -> None:
    listed = scenarios.list_scenarios()
    assert sorted(item["key"] for item in listed) == sorted(SCENARIO_KEYS)
    assert scenarios.get_scenario("police")["key"] == "police"
    assert scenarios.get_scenario("not_a_scenario") is None


def test_get_scenarios_endpoint(client) -> None:
    response = client.get("/api/scenarios")
    assert response.status_code == 200
    items = {item["key"]: schemas.ScenarioView.model_validate(item) for item in response.json()}
    assert sorted(items) == sorted(SCENARIO_KEYS)
    assert items["relative_new_number"].voice == "clone"
    for key in ("police", "bank_security", "hospital"):
        assert items[key].voice == "library"
    files = scenario_files()
    for key, view in items.items():
        assert view.caller_label == files[key]["caller_label"]
        assert view.allowed_tactics == files[key]["allowed_tactics"]
    assert {"new_number", "urgency", "secrecy"} <= set(items["relative_new_number"].allowed_tactics)
    assert {"authority", "secrecy", "urgency"} <= set(items["police"].allowed_tactics)
    assert "authority" in items["bank_security"].allowed_tactics


# ---------------------------------------------------------------- the ElevenLabs layer, real paths (respx)


def test_base_url_and_error_type() -> None:
    assert elevenlabs.BASE_URL == EL
    assert issubclass(elevenlabs.ElevenLabsError, Exception)


async def test_conversation_token_real_request(monkeypatch) -> None:
    go_real(monkeypatch, key="secret-key")
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.get("/v1/convai/conversation/token").respond(
            200, json={"token": "tok_real", "conversation_id": "conv_real_1"})
        result = await elevenlabs.conversation_token("agent_x")
    assert isinstance(result, elevenlabs.ConversationToken)
    assert (result.token, result.conversation_id) == ("tok_real", "conv_real_1")
    request = route.calls.last.request
    assert request.url.params["agent_id"] == "agent_x"
    assert request.headers["xi-api-key"] == "secret-key"


async def test_signed_url_real_request(monkeypatch) -> None:
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.get("/v1/convai/conversation/get-signed-url").respond(
            200, json={"signed_url": "wss://example.test/convai?token=abc"})
        url = await elevenlabs.signed_url("agent_y")
    assert url == "wss://example.test/convai?token=abc"
    assert route.calls.last.request.url.params["agent_id"] == "agent_y"
    assert route.calls.last.request.headers["xi-api-key"] == "test-key"


async def test_clone_voice_real_request(monkeypatch, tmp_path) -> None:
    go_real(monkeypatch)
    sample = tmp_path / "clean.mp3"
    sample.write_bytes(b"ID3-fake-mp3-bytes")
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.post("/v1/voices/add").respond(200, json={"voice_id": "voice_abc"})
        voice_id = await elevenlabs.clone_voice("callback-mem_1", sample)
    assert voice_id == "voice_abc"
    request = route.calls.last.request
    assert request.headers["content-type"].startswith("multipart/form-data")
    assert request.headers["xi-api-key"] == "test-key"
    body = request.content
    assert b'name="name"' in body and b"callback-mem_1" in body
    assert b'name="files"' in body and b"ID3-fake-mp3-bytes" in body


async def test_delete_voice_real_request(monkeypatch) -> None:
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.delete("/v1/voices/voice_abc").respond(200, json={"status": "ok"})
        assert await elevenlabs.delete_voice("voice_abc") is None
    assert route.call_count == 1
    assert route.calls.last.request.headers["xi-api-key"] == "test-key"


async def test_get_conversation_and_audio_real_requests(monkeypatch) -> None:
    go_real(monkeypatch)
    payload = {"status": "done", "transcript": [{"role": "agent", "message": "Hi", "time_in_call_secs": 1}]}
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        conv = router.get("/v1/convai/conversations/conv_1").respond(200, json=payload)
        audio_route = router.get("/v1/convai/conversations/conv_1/audio").respond(200, content=b"RIFFaudio")
        assert await elevenlabs.get_conversation("conv_1") == payload
        assert await elevenlabs.conversation_audio("conv_1") == b"RIFFaudio"
    assert conv.call_count == 1 and audio_route.call_count == 1


@pytest.mark.parametrize("status", [401, 500])
async def test_real_errors_raise_elevenlabs_error(monkeypatch, tmp_path, status: int) -> None:
    go_real(monkeypatch)
    sample = tmp_path / "x.mp3"
    sample.write_bytes(b"x")
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        router.get("/v1/convai/conversation/token").respond(status, json={"detail": "no"})
        router.get("/v1/convai/conversation/get-signed-url").respond(status, json={"detail": "no"})
        router.post("/v1/voices/add").respond(status, json={"detail": "no"})
        router.delete("/v1/voices/v1").respond(status, json={"detail": "no"})
        router.get("/v1/convai/conversations/c1").respond(status, json={"detail": "no"})
        with pytest.raises(elevenlabs.ElevenLabsError):
            await elevenlabs.conversation_token("agent_x")
        with pytest.raises(elevenlabs.ElevenLabsError):
            await elevenlabs.signed_url("agent_x")
        with pytest.raises(elevenlabs.ElevenLabsError):
            await elevenlabs.clone_voice("n", sample)
        with pytest.raises(elevenlabs.ElevenLabsError):
            await elevenlabs.delete_voice("v1")
        with pytest.raises(elevenlabs.ElevenLabsError):
            await elevenlabs.get_conversation("c1")


async def test_missing_api_key_fails_clearly_without_a_request(monkeypatch) -> None:
    go_real(monkeypatch, key="")
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.get("/v1/convai/conversation/token").respond(200, json={"token": "t", "conversation_id": "c"})
        with pytest.raises((elevenlabs.ElevenLabsError, ApiError)):
            await elevenlabs.conversation_token("agent_x")
    assert route.call_count == 0


# ---------------------------------------------------------------- the ElevenLabs layer, fake mode


async def test_fake_mode_values_and_no_network() -> None:
    with respx.mock(assert_all_called=False) as router:  # any real request would fail
        token = await elevenlabs.conversation_token("agent_x")
        assert token.token.startswith("fake-token-")
        assert token.conversation_id.startswith("conv_fake_")
        assert await elevenlabs.signed_url("agent_x")
        voice_id = await elevenlabs.clone_voice("callback-x", Path(__file__))
        assert voice_id.startswith("voice_fake_")
        assert await elevenlabs.delete_voice(voice_id) is None
        conversation = await elevenlabs.get_conversation(token.conversation_id)
        assert conversation["status"] == "done"
        assert conversation["transcript"] == []
        assert isinstance(await elevenlabs.conversation_audio(token.conversation_id), bytes)
    assert len(router.calls) == 0


# ---------------------------------------------------------------- audio clean-up


def probe(path: Path, entries: str) -> dict[str, str]:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", entries, "-of", "default=nw=1", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


@pytest.mark.parametrize("ext", ["webm", "mp4", "m4a"])
async def test_clean_recording_makes_mono_trimmed_mp3(tmp_path, sample_audio, ext: str) -> None:
    source = tmp_path / f"in.{ext}"
    source.write_bytes(sample_audio[ext])
    target = tmp_path / "out.mp3"
    result = await audio.clean_recording(source, target)
    assert Path(result).exists()
    info = probe(Path(result), "stream=channels,codec_name:format=duration")
    assert info["channels"] == "1"
    assert info["codec_name"] == "mp3"
    original = float(probe(source, "format=duration")["duration"])
    assert float(info["duration"]) < original - 1.0, "leading silence should be trimmed"
    assert source.read_bytes() == sample_audio[ext], "the original is left alone"


async def test_clean_recording_does_not_block_the_event_loop(tmp_path, sample_audio) -> None:
    assert inspect.iscoroutinefunction(audio.clean_recording)
    source = tmp_path / "in.webm"
    source.write_bytes(sample_audio["webm"])
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.create_task(ticker())
    started = time.monotonic()
    await audio.clean_recording(source, tmp_path / "out.mp3")
    elapsed = time.monotonic() - started
    task.cancel()
    assert ticks >= max(3, int(elapsed / 0.01 * 0.3)), f"loop starved: {ticks} ticks in {elapsed:.2f}s"


async def test_clean_recording_fails_on_garbage(tmp_path) -> None:
    source = tmp_path / "bad.webm"
    source.write_bytes(b"this is not audio at all" * 10)
    with pytest.raises(Exception):
        await audio.clean_recording(source, tmp_path / "out.mp3")


# ---------------------------------------------------------------- POST /members/{id}/voice


def test_voice_upload_webm_fake_mode(client, make_family, sample_audio) -> None:
    family = make_family()
    sara_id, _ = sara_and_jon(family)
    response = upload(client, sara_id, sample_audio["webm"])
    assert response.status_code == 200, response.text
    assert response.json() == {"voice_ready": True}

    member = load(Member, sara_id)
    assert member.voice_id and member.voice_id.startswith("voice_fake_")
    assert member.voice_status == "ready"
    assert member.consent_clone_at is not None

    saved = get_settings().media_path / "consent" / f"{sara_id}.webm"
    assert saved.read_bytes() == sample_audio["webm"], "the original is saved unchanged"
    rows = [c for c in consents_of(sara_id) if c.kind == "clone"]
    assert len(rows) == 1
    assert rows[0].source == "voice_recording"
    assert rows[0].evidence and sara_id in rows[0].evidence


def test_voice_upload_mp4_from_iphone(client, make_family, sample_audio) -> None:
    family = make_family()
    sara_id, _ = sara_and_jon(family)
    response = upload(client, sara_id, sample_audio["mp4"], "recording.mp4", "audio/mp4")
    assert response.status_code == 200, response.text
    assert response.json() == {"voice_ready": True}
    saved = [p for p in (get_settings().media_path / "consent").glob(f"{sara_id}.*")]
    assert len(saved) == 1 and saved[0].suffix in {".mp4", ".m4a"}
    assert saved[0].read_bytes() == sample_audio["mp4"]
    assert load(Member, sara_id).voice_status == "ready"


def test_voice_upload_unknown_member_is_404(client, sample_audio) -> None:
    response = upload(client, "mem_doesnotexist", sample_audio["webm"])
    assert response.status_code == 404
    assert error_of(response)["code"] == "not_found"


def test_voice_upload_without_file_is_rejected(client, make_family) -> None:
    sara_id, _ = sara_and_jon(make_family())
    response = client.post(f"/api/members/{sara_id}/voice")
    assert response.status_code in (400, 422)
    assert "error" in response.json()
    assert load(Member, sara_id).voice_status != "ready"


def test_voice_upload_garbage_audio_is_clone_failed(client, make_family) -> None:
    sara_id, _ = sara_and_jon(make_family())
    response = upload(client, sara_id, b"not audio" * 50)
    assert response.status_code == 502
    assert error_of(response)["code"] == "clone_failed"
    member = load(Member, sara_id)
    assert member.voice_status != "ready" and not member.voice_id and member.consent_clone_at is None


def test_voice_upload_real_path_sends_cleaned_copy(client, make_family, sample_audio, monkeypatch) -> None:
    sara_id, _ = sara_and_jon(make_family())
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.post("/v1/voices/add").respond(200, json={"voice_id": "voice_real_1"})
        response = upload(client, sara_id, sample_audio["webm"])
    assert response.status_code == 200, response.text
    assert route.call_count == 1
    request = route.calls.last.request
    assert request.headers["xi-api-key"] == "test-key"
    assert f"callback-{sara_id}".encode() in request.content
    assert b'name="files"' in request.content
    assert sample_audio["webm"] not in request.content, "the cleaned copy is sent, not the original"
    member = load(Member, sara_id)
    assert member.voice_id == "voice_real_1" and member.voice_status == "ready"


def test_voice_upload_elevenlabs_failure_is_502_clone_failed(client, make_family, sample_audio, monkeypatch) -> None:
    sara_id, _ = sara_and_jon(make_family())
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        router.post("/v1/voices/add").respond(500, json={"detail": "boom"})
        response = upload(client, sara_id, sample_audio["webm"])
    assert response.status_code == 502
    assert error_of(response)["code"] == "clone_failed"
    member = load(Member, sara_id)
    assert member.voice_status != "ready" and not member.voice_id and member.consent_clone_at is None
    assert (get_settings().media_path / "consent" / f"{sara_id}.webm").exists(), "the consent recording is kept"


# ---------------------------------------------------------------- DELETE voice and opt-out


def test_delete_voice_fake_mode(client, make_family, sample_audio) -> None:
    sara_id, _ = sara_and_jon(make_family())
    assert upload(client, sara_id, sample_audio["webm"]).status_code == 200
    response = client.delete(f"/api/members/{sara_id}/voice")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    member = load(Member, sara_id)
    assert not member.voice_id
    assert member.voice_status == "deleted"


def test_delete_voice_calls_elevenlabs(client, make_family, monkeypatch) -> None:
    sara_id, _ = sara_and_jon(make_family())
    give_voice(sara_id, "voice_sara_9")
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.delete("/v1/voices/voice_sara_9").respond(200, json={"status": "ok"})
        response = client.delete(f"/api/members/{sara_id}/voice")
    assert response.status_code == 200
    assert route.call_count == 1
    member = load(Member, sara_id)
    assert not member.voice_id and member.voice_status == "deleted"


def test_delete_voice_not_claimed_when_elevenlabs_fails(client, make_family, monkeypatch) -> None:
    """Deletion is real: if ElevenLabs did not delete it, we do not say it is deleted."""
    sara_id, _ = sara_and_jon(make_family())
    give_voice(sara_id, "voice_sara_9")
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        router.delete("/v1/voices/voice_sara_9").respond(500, json={"detail": "boom"})
        response = client.delete(f"/api/members/{sara_id}/voice")
    assert response.status_code >= 400
    member = load(Member, sara_id)
    assert member.voice_id == "voice_sara_9" and member.voice_status != "deleted"


def test_delete_voice_unknown_member_is_404(client) -> None:
    response = client.delete("/api/members/mem_doesnotexist/voice")
    assert response.status_code == 404
    assert error_of(response)["code"] == "not_found"


def test_delete_voice_without_a_voice_makes_no_elevenlabs_call(client, make_family, monkeypatch) -> None:
    sara_id, _ = sara_and_jon(make_family())
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        any_delete = router.delete(url__startswith=f"{EL}/v1/voices/").respond(200, json={})
        response = client.delete(f"/api/members/{sara_id}/voice")
    assert response.status_code < 500
    assert any_delete.call_count == 0


def test_delete_voice_twice_is_not_a_server_error(client, make_family, sample_audio) -> None:
    sara_id, _ = sara_and_jon(make_family())
    upload(client, sara_id, sample_audio["webm"])
    assert client.delete(f"/api/members/{sara_id}/voice").status_code == 200
    assert client.delete(f"/api/members/{sara_id}/voice").status_code < 500
    assert load(Member, sara_id).voice_status == "deleted"


def test_opt_out_deletes_clone_and_records_it(client, make_family, monkeypatch) -> None:
    sara_id, _ = sara_and_jon(make_family())
    give_voice(sara_id, "voice_sara_9")
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.delete("/v1/voices/voice_sara_9").respond(200, json={"status": "ok"})
        response = client.post(f"/api/members/{sara_id}/opt-out")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert route.call_count == 1
    member = load(Member, sara_id)
    assert member.opted_out_at is not None
    assert not member.voice_id and member.voice_status == "deleted"
    assert [c.kind for c in consents_of(sara_id)].count("opt_out") == 1


def test_opt_out_without_a_voice(client, make_family) -> None:
    sara_id, _ = sara_and_jon(make_family())
    response = client.post(f"/api/members/{sara_id}/opt-out")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert load(Member, sara_id).opted_out_at is not None
    assert "opt_out" in [c.kind for c in consents_of(sara_id)]


def test_opt_out_unknown_member_is_404(client) -> None:
    response = client.post("/api/members/mem_doesnotexist/opt-out")
    assert response.status_code == 404
    assert error_of(response)["code"] == "not_found"


def test_opt_out_twice_is_not_a_server_error(client, make_family) -> None:
    sara_id, _ = sara_and_jon(make_family())
    assert client.post(f"/api/members/{sara_id}/opt-out").status_code == 200
    assert client.post(f"/api/members/{sara_id}/opt-out").status_code < 500
    assert load(Member, sara_id).opted_out_at is not None


def test_opted_out_target_cannot_be_practised(client, make_family) -> None:
    sara_id, _ = sara_and_jon(make_family())
    client.get(f"/api/members/{sara_id}/phone-state")
    client.post(f"/api/members/{sara_id}/opt-out")
    response = client.post("/api/practice-calls", json={"target_member_id": sara_id, "scenario": "police"})
    assert response.status_code == 409
    assert error_of(response)["code"] == "consent_missing"


def test_opted_out_voice_owner_cannot_be_used(client, make_family) -> None:
    sara_id, jon_id = sara_and_jon(make_family())
    give_voice(jon_id)
    client.get(f"/api/members/{sara_id}/phone-state")
    assert client.post(f"/api/members/{jon_id}/opt-out").status_code == 200
    response = client.post("/api/practice-calls", json={
        "target_member_id": sara_id, "voice_member_id": jon_id, "scenario": "relative_new_number"})
    assert response.status_code == 409
    assert error_of(response)["code"] == "voice_not_ready"


# ---------------------------------------------------------------- briefs


@pytest.mark.parametrize("key", SCENARIO_KEYS)
async def test_template_brief_is_complete(make_family, key: str) -> None:
    built = await build(make_family(), key, difficulty=2)
    assert isinstance(built, briefs.BuiltBrief)
    variables = built.variables
    for field in ("target_name", *BRIEF_FIELDS, "difficulty", "reveal_line"):
        assert variables[field] not in ("", None), field
    for name, value in variables.items():
        assert isinstance(value, (str, int)) and not isinstance(value, bool), name
        if isinstance(value, str):
            assert "{" not in value and "}" not in value, f"unfilled placeholder in {name}"
    assert variables["target_name"] == "Sara"
    assert variables["difficulty"] == 2
    assert isinstance(variables["tactic_order"], str)
    tactics = [part.strip() for part in variables["tactic_order"].split(",")]
    assert tactics and set(tactics) <= set(scenario_files()[key]["allowed_tactics"])
    assert built.caller_label == scenario_files()[key]["caller_label"]


async def test_template_brief_names_the_voice_member(make_family) -> None:
    built = await build(make_family(), "relative_new_number")
    assert "Jon" in built.variables["caller_claim"]
    assert built.variables["address_as"] in built.variables["opening_line"]


async def test_caller_number_is_made_up_and_not_real(make_family) -> None:
    for key in SCENARIO_KEYS:
        number = (await build(make_family(), key)).caller_number
        assert number and re.fullmatch(r"\+?[\d ]+", number)
        assert not re.match(r"\+[1-9]", number), "must not look like a real country code"


async def test_reveal_line_is_fixed_wording(make_family) -> None:
    family = make_family()
    assert (await build(family, "relative_new_number")).variables["reveal_line"] == CLONE_REVEAL
    for key in ("police", "bank_security", "hospital"):
        assert (await build(family, key)).variables["reveal_line"] == LIBRARY_REVEAL


async def test_build_brief_reads_only(make_family) -> None:
    family = make_family()
    sara_id, jon_id = sara_and_jon(family)
    with new_session() as s:
        target, voice = s.get(Member, sara_id), s.get(Member, jon_id)
        await briefs.build_brief(s, target, voice, "relative_new_number", 1)
        assert not s.new and not s.dirty and not s.deleted
    with new_session() as s:
        assert s.scalar(select(Call)) is None


async def test_director_receives_the_template(make_family, monkeypatch) -> None:
    seen = set_director(monkeypatch, None)
    built = await build(make_family(), "relative_new_number")
    assert len(seen) == 1
    template_brief, context = seen[0]
    assert set(template_brief) >= set(BRIEF_FIELDS)
    assert isinstance(context, dict)
    assert built.variables["ask"] == (template_brief["ask"])


async def test_valid_improved_brief_is_used(make_family, monkeypatch) -> None:
    def improve(brief: dict[str, Any]) -> dict[str, Any]:
        brief["scenario_brief"] = "You left your wallet at a friend's house and must pay a taxi driver today."
        brief["ask"] = "a transfer of 450 euros today, to the taxi company's account"
        brief["tactic_order"] = with_tactics(brief, ["urgency", "new_number"])
        return brief

    set_director(monkeypatch, improve)
    variables = (await build(make_family(), "relative_new_number")).variables
    assert variables["scenario_brief"] == "You left your wallet at a friend's house and must pay a taxi driver today."
    assert variables["ask"] == "a transfer of 450 euros today, to the taxi company's account"
    assert variables["tactic_order"].replace(" ", "") == "urgency,new_number"


async def template_variables(family: dict[str, Any], monkeypatch, key: str = "relative_new_number") -> dict[str, Any]:
    set_director(monkeypatch, None)
    return (await build(family, key)).variables


@pytest.mark.parametrize("field,bad", [
    ("ask", "a transfer of 123456 euros today"),
    ("opening_line", "Mum, it's me, my card is 4111111111111111"),
    ("scenario_brief", "You need to pay with code 7654321 today."),
    ("caller_claim", "her son Jon, phone 00491701234567"),
])
async def test_brief_with_a_long_digit_run_falls_back_to_template(make_family, monkeypatch, field, bad) -> None:
    family = make_family()
    template = await template_variables(family, monkeypatch)

    def improve(brief: dict[str, Any]) -> dict[str, Any]:
        brief["scenario_brief"] = "You left your wallet at a friend's house and must pay a taxi today."
        brief[field] = bad
        return brief

    set_director(monkeypatch, improve)
    variables = (await build(family, "relative_new_number")).variables
    for name in BRIEF_FIELDS:
        assert variables[name] == template[name], f"{name}: the whole brief is replaced by the template"


@pytest.mark.parametrize("bank", REAL_BANK_NAMES)
async def test_brief_naming_a_real_bank_falls_back_to_template(make_family, monkeypatch, bank: str) -> None:
    family = make_family()
    template = await template_variables(family, monkeypatch)

    def improve(brief: dict[str, Any]) -> dict[str, Any]:
        brief["scenario_brief"] = f"You are locked out of your {bank} account and need to pay today."
        return brief

    set_director(monkeypatch, improve)
    variables = (await build(family, "relative_new_number")).variables
    assert variables["scenario_brief"] == template["scenario_brief"]
    assert bank.lower() not in json.dumps(variables).lower()


async def test_brief_with_unknown_tactic_key_falls_back(make_family, monkeypatch) -> None:
    family = make_family()
    template = await template_variables(family, monkeypatch)

    def improve(brief: dict[str, Any]) -> dict[str, Any]:
        brief["ask"] = "a transfer of 450 euros today, to a friend's account"
        brief["tactic_order"] = with_tactics(brief, ["urgency", "guilt_trip"])
        return brief

    set_director(monkeypatch, improve)
    variables = (await build(family, "relative_new_number")).variables
    for name in BRIEF_FIELDS:
        assert variables[name] == template[name]


@pytest.mark.parametrize("field", ["caller_claim", "opening_line", "scenario_brief", "ask"])
async def test_overlong_field_falls_back_to_template(make_family, monkeypatch, field: str) -> None:
    family = make_family()
    template = await template_variables(family, monkeypatch)

    def improve(brief: dict[str, Any]) -> dict[str, Any]:
        brief[field] = "word " * 800
        return brief

    set_director(monkeypatch, improve)
    variables = (await build(family, "relative_new_number")).variables
    assert variables[field] == template[field]


async def test_director_cannot_change_the_reveal_line(make_family, monkeypatch) -> None:
    def improve(brief: dict[str, Any]) -> dict[str, Any]:
        brief["reveal_line"] = "Sara, relax, nothing to see here."
        brief["scenario_brief"] = "You left your wallet at a friend's house and must pay a taxi today."
        return brief

    set_director(monkeypatch, improve)
    variables = (await build(make_family(), "relative_new_number")).variables
    assert variables["reveal_line"] == CLONE_REVEAL


async def test_director_error_falls_back_to_template(make_family, monkeypatch) -> None:
    family = make_family()
    template = await template_variables(family, monkeypatch)
    set_director(monkeypatch, RuntimeError("model down"))
    variables = (await build(family, "relative_new_number")).variables
    for name in BRIEF_FIELDS:
        assert variables[name] == template[name]


async def test_slow_director_is_cut_off_after_about_four_seconds(make_family, monkeypatch) -> None:
    family = make_family()
    template = await template_variables(family, monkeypatch)

    from app.agents import director

    async def slow(template_brief: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(30)
        return template_brief

    monkeypatch.setattr(director, "improve_brief", slow)
    monkeypatch.setattr(briefs, "improve_brief", slow, raising=False)
    started = time.monotonic()
    variables = (await build(family, "relative_new_number")).variables
    elapsed = time.monotonic() - started
    assert 3.0 <= elapsed < 8.0, elapsed
    for name in BRIEF_FIELDS:
        assert variables[name] == template[name]


# ---------------------------------------------------------------- sessions (direct)


async def test_practice_session_with_clone(make_family) -> None:
    family = make_family()
    call_id = await practice_call_row(family, "relative_new_number", difficulty=2)
    session = await session_for(call_id)
    assert isinstance(session, schemas.Session)
    assert session.kind == "practice"
    assert session.conversation_token.startswith("fake-token-")
    assert session.conversation_id.startswith("conv_fake_")
    assert session.max_seconds == schemas.MAX_SECONDS["practice"] == 150

    variables = session.dynamic_variables
    for field in ("target_name", *BRIEF_FIELDS, "difficulty", "reveal_line"):
        assert field in variables, field
    assert variables["target_name"] == "Sara"
    assert variables["difficulty"] == 2
    assert variables["reveal_line"] == CLONE_REVEAL
    assert isinstance(variables["tactic_order"], str)
    for name, value in variables.items():
        assert isinstance(value, (str, int, float)) and not isinstance(value, bool), name
    assert session.reveal is not None and session.reveal.voice_of == "Jon"


async def test_practice_session_voice_override_uses_clone(make_family) -> None:
    family = make_family()
    _, jon_id = sara_and_jon(family)
    give_voice(jon_id, "voice_jon_77")
    session = await session_for(await practice_call_row(family))
    assert session.overrides == {"tts": {"voiceId": "voice_jon_77"}}


@pytest.mark.parametrize("scenario", ["police", "bank_security", "hospital"])
async def test_practice_session_library_voice(make_family, scenario: str) -> None:
    family = make_family()
    session = await session_for(await practice_call_row(family, scenario, difficulty=1))
    assert session.overrides == {"tts": {"voiceId": LIBRARY_VOICES[scenario]}}
    assert session.dynamic_variables["reveal_line"] == LIBRARY_REVEAL
    assert session.reveal is not None and session.reveal.voice_of is None
    assert session.max_seconds == 150


async def test_session_uses_the_stored_brief(make_family) -> None:
    family = make_family()
    built = await build(family, "police", 3)
    variables = dict(built.variables)
    variables["ask"] = "a stored ask that only this test would write"
    call_id = stored_call(family, "practice", scenario="police", difficulty=3, brief=variables)
    session = await session_for(call_id)
    assert session.dynamic_variables["ask"] == "a stored ask that only this test would write"
    assert session.dynamic_variables["difficulty"] == 3


async def test_tactic_order_is_joined_into_one_string(make_family) -> None:
    family = make_family()
    built = await build(family, "police", 1)
    variables: dict[str, Any] = dict(built.variables)
    variables["tactic_order"] = ["authority", "secrecy", "urgency"]
    call_id = stored_call(family, "practice", scenario="police", difficulty=1, brief=variables)
    order = (await session_for(call_id)).dynamic_variables["tactic_order"]
    assert isinstance(order, str)
    positions = [order.index(key) for key in ("authority", "secrecy", "urgency")]
    assert positions == sorted(positions)


async def test_session_stores_conversation_id_on_the_call(make_family) -> None:
    family = make_family()
    call_id = await practice_call_row(family)
    assert load(Call, call_id).conversation_id is None
    session = await session_for(call_id)
    assert load(Call, call_id).conversation_id == session.conversation_id


async def test_welcome_session(make_family) -> None:
    family = make_family()
    call_id = stored_call(family, "welcome", target=0, status="in_progress")
    session = await session_for(call_id)
    assert session.kind == "welcome"
    assert session.overrides == {}
    assert session.max_seconds == 330
    assert session.reveal is None
    assert session.conversation_token.startswith("fake-token-")
    variables = session.dynamic_variables
    assert variables["member_name"] == "Sara"
    assert variables["organiser_name"] == "Jon"
    assert variables["family_name"] == "Kovacs"  # prompts say "the {{family_name}} family"
    assert load(Call, call_id).conversation_id == session.conversation_id


async def test_family_line_session(make_family) -> None:
    family = make_family()
    practice_id = stored_call(family, "practice", scenario="relative_new_number", voice=True, status="scored")
    with new_session() as s:
        s.add(Result(call_id=practice_id, outcome="asked_safe_word", seconds_to_challenge=21.5,
                     tactics_used_json=json.dumps(["new_number", "urgency"]), tactics_worked_json="[]",
                     lesson="Asking for the family word stopped the call.", created_at=now_iso()))
        s.commit()
    line_id = stored_call(family, "family_line", parent=practice_id, status="in_progress")
    session = await session_for(line_id)
    assert session.kind == "family_line"
    assert session.overrides == {}
    assert session.max_seconds == 60
    assert session.reveal is None
    variables = session.dynamic_variables
    assert variables["caller_name"] == "Sara"
    assert variables["relative_name"] == "Jon"
    assert isinstance(variables["what_happened"], str) and variables["what_happened"].strip()
    assert load(Call, line_id).conversation_id == session.conversation_id


async def test_family_line_session_without_a_result_yet(make_family) -> None:
    family = make_family()
    practice_id = stored_call(family, "practice", scenario="relative_new_number", voice=True, status="ended")
    line_id = stored_call(family, "family_line", parent=practice_id)
    variables = (await session_for(line_id)).dynamic_variables
    assert isinstance(variables["what_happened"], str) and variables["what_happened"].strip()


@pytest.mark.parametrize("kind,prompt_file", [
    ("welcome", "### The welcome agent's prompt"),
    ("practice", "### The practice agent's prompt"),
    ("family_line", "### The family line agent's prompt"),
])
async def test_every_prompt_placeholder_gets_a_value(make_family, kind: str, prompt_file: str) -> None:
    family = make_family()
    if kind == "practice":
        call_id = await practice_call_row(family)
    elif kind == "welcome":
        call_id = stored_call(family, "welcome")
    else:
        parent = stored_call(family, "practice", scenario="relative_new_number", voice=True, status="scored")
        call_id = stored_call(family, "family_line", parent=parent)
    session = await session_for(call_id)
    placeholders = set(re.findall(r"\{\{(\w+)\}\}", ai_md_block(prompt_file, "text")))
    if kind == "practice":
        placeholders.add("opening_line")  # the first message
    missing = placeholders - set(session.dynamic_variables)
    assert not missing, f"{kind} prompt uses variables the session does not send: {missing}"


async def test_session_asks_for_the_right_agent(make_family, monkeypatch) -> None:
    family = make_family()
    asked: list[str] = []

    async def fake_token(agent_id: str) -> elevenlabs.ConversationToken:
        asked.append(agent_id)
        return elevenlabs.ConversationToken(token=f"tok-{len(asked)}", conversation_id=f"conv-{len(asked)}")

    monkeypatch.setattr(elevenlabs, "conversation_token", fake_token)
    monkeypatch.setattr(sessions, "conversation_token", fake_token, raising=False)

    welcome = await session_for(stored_call(family, "welcome"))
    practice = await session_for(await practice_call_row(family))
    parent = stored_call(family, "practice", scenario="relative_new_number", voice=True, status="scored")
    line = await session_for(stored_call(family, "family_line", parent=parent))

    assert asked == [AGENTS["welcome"], AGENTS["practice"], AGENTS["family_line"]]
    assert (welcome.conversation_token, welcome.conversation_id) == ("tok-1", "conv-1")
    assert (practice.conversation_token, practice.conversation_id) == ("tok-2", "conv-2")
    assert (line.conversation_token, line.conversation_id) == ("tok-3", "conv-3")


async def test_no_write_lock_is_held_while_awaiting_the_token(make_family, monkeypatch) -> None:
    """build_session awaits the token first, then writes conversation_id and commits."""
    family = make_family()
    call_id = await practice_call_row(family)
    sara_id, _ = sara_and_jon(family)

    async def token_while_another_writer_commits(agent_id: str) -> elevenlabs.ConversationToken:
        def other_writer() -> None:
            with new_session() as other:
                other.get(Member, sara_id).last_seen_at = now_iso()
                other.commit()

        await asyncio.to_thread(other_writer)  # would hit "database is locked" if a write lock were held
        return elevenlabs.ConversationToken(token="tok", conversation_id="conv-lock-test")

    monkeypatch.setattr(elevenlabs, "conversation_token", token_while_another_writer_commits)
    monkeypatch.setattr(sessions, "conversation_token", token_while_another_writer_commits, raising=False)
    session = await session_for(call_id)
    assert session.conversation_id == "conv-lock-test"
    assert load(Call, call_id).conversation_id == "conv-lock-test"


async def test_session_real_token_request_uses_the_practice_agent(make_family, monkeypatch) -> None:
    family = make_family()
    call_id = await practice_call_row(family)
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.get("/v1/convai/conversation/token").respond(
            200, json={"token": "tok_real", "conversation_id": "conv_real_9"})
        session = await session_for(call_id)
    assert route.calls.last.request.url.params["agent_id"] == AGENTS["practice"]
    assert (session.conversation_token, session.conversation_id) == ("tok_real", "conv_real_9")
    assert load(Call, call_id).conversation_id == "conv_real_9"


# ---------------------------------------------------------------- sessions through the HTTP API


def test_answer_returns_the_practice_session(client, make_family) -> None:
    family = make_family()
    _, jon_id = sara_and_jon(family)
    call_id = start_practice(client, family, "relative_new_number", difficulty=2)
    ringing = client.get(f"/api/members/{sara_and_jon(family)[0]}/phone-state").json()["incoming_call"]
    assert ringing["call_id"] == call_id and ringing["kind"] == "practice"
    assert ringing["caller"]["label"] == scenario_files()["relative_new_number"]["caller_label"]
    assert ringing["caller"]["number"] and not re.match(r"\+[1-9]", ringing["caller"]["number"])

    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 200, response.text
    session = schemas.Session.model_validate(response.json())
    assert session.kind == "practice"
    assert session.overrides == {"tts": {"voiceId": "voice_jon_1"}}
    assert session.dynamic_variables["target_name"] == "Sara"
    assert session.dynamic_variables["difficulty"] == 2
    assert session.dynamic_variables["reveal_line"] == CLONE_REVEAL
    assert session.max_seconds == 150
    assert session.reveal is not None and session.reveal.voice_of == "Jon"
    call = load(Call, call_id)
    assert call.status == "in_progress"
    assert call.conversation_id == session.conversation_id


@pytest.mark.parametrize("scenario", ["police", "bank_security", "hospital"])
def test_answer_library_voice_session(client, make_family, scenario: str) -> None:
    family = make_family()
    call_id = start_practice(client, family, scenario, difficulty=1)
    session = schemas.Session.model_validate(client.post(f"/api/calls/{call_id}/answer").json())
    assert session.overrides == {"tts": {"voiceId": LIBRARY_VOICES[scenario]}}
    assert session.reveal is not None and session.reveal.voice_of is None
    assert session.dynamic_variables["reveal_line"] == LIBRARY_REVEAL


def test_answer_welcome_session(client, make_family) -> None:
    family = make_family()
    sara_id, _ = sara_and_jon(family)
    created = client.post(f"/api/members/{sara_id}/welcome-call")
    assert created.status_code in (200, 201), created.text
    call_id = created.json()["call_id"]
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 200, response.text
    session = schemas.Session.model_validate(response.json())
    assert session.kind == "welcome"
    assert session.overrides == {}
    assert session.max_seconds == 330
    assert session.reveal is None
    assert session.dynamic_variables["member_name"] == "Sara"
    assert session.dynamic_variables["organiser_name"] == "Jon"
    assert session.dynamic_variables["family_name"] == "Kovacs"  # prompts say "the {{family_name}} family"


def test_answer_with_missing_agent_id_is_503(client, make_family, monkeypatch) -> None:
    family = make_family()
    call_id = start_practice(client, family, "police")
    go_real(monkeypatch, ELEVENLABS_PRACTICE_AGENT_ID="")
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 503
    error = error_of(response)
    assert error["code"] == "agent_not_configured" and error["message"]


def test_answer_with_missing_api_key_is_a_clear_error(client, make_family, monkeypatch) -> None:
    family = make_family()
    call_id = start_practice(client, family, "police")
    go_real(monkeypatch, key="")
    response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 503
    error = error_of(response)
    assert error["code"] and error["message"]


def test_answer_when_elevenlabs_token_fails_marks_the_call_failed(client, make_family, monkeypatch) -> None:
    family = make_family()
    call_id = start_practice(client, family, "police")
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        router.get("/v1/convai/conversation/token").respond(500, json={"detail": "down"})
        response = client.post(f"/api/calls/{call_id}/answer")
    assert 500 <= response.status_code < 600
    assert "error" in response.json()
    assert client.get(f"/api/calls/{call_id}").json()["status"] == "failed"


def test_answer_real_mode_returns_elevenlabs_token(client, make_family, monkeypatch) -> None:
    family = make_family()
    call_id = start_practice(client, family, "bank_security")
    go_real(monkeypatch)
    with respx.mock(base_url=EL, assert_all_called=False) as router:
        route = router.get("/v1/convai/conversation/token").respond(
            200, json={"token": "tok_http", "conversation_id": "conv_http_1"})
        response = client.post(f"/api/calls/{call_id}/answer")
    assert response.status_code == 200, response.text
    assert response.json()["conversation_token"] == "tok_http"
    assert response.json()["conversation_id"] == "conv_http_1"
    assert route.calls.last.request.url.params["agent_id"] == AGENTS["practice"]
    assert load(Call, call_id).conversation_id == "conv_http_1"


# ---------------------------------------------------------------- the voice agent files


@pytest.mark.parametrize("file_name,heading", [
    ("welcome.md", "### The welcome agent's prompt"),
    ("practice.md", "### The practice agent's prompt"),
    ("family_line.md", "### The family line agent's prompt"),
])
def test_agent_prompts_are_copied_verbatim_from_ai_md(file_name: str, heading: str) -> None:
    prompt = ai_md_block(heading, "text").strip()
    content = (BACKEND_DIR / "voice_agents" / file_name).read_text()
    assert prompt in content


def test_tools_json_matches_ai_md() -> None:
    expected = json.loads(ai_md_block("### Tools", "json"))
    actual = json.loads((BACKEND_DIR / "voice_agents" / "tools.json").read_text())
    assert actual == expected
    assert [tool["name"] for tool in actual] == ["mark_tactic", "practice_result", "consent_result"]
    assert all(tool["type"] == "client" and tool["expects_response"] is False for tool in actual)


def test_voice_agents_readme_is_a_setup_checklist() -> None:
    text = (BACKEND_DIR / "voice_agents" / "README.md").read_text()
    for needle in ("360", "180", "90", "end_call", "mark_tactic", "practice_result", "consent_result",
                   "{{opening_line}}", "Hi {{member_name}}, this is Callback."):
        assert needle in text, needle
    assert "- [ ]" in text or "[ ]" in text, "written as a checklist"
