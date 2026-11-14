"""Live: the ElevenLabs account, the three agents' settings, the library
voices, conversation tokens, and (with LIVE_CLONE=1) a clone round trip.

The agent checks read GET /v1/convai/agents/{id}. Field paths are the ones
the live API returns (checked on 13 Nov 2026):
- platform_settings.auth.enable_auth
- platform_settings.overrides.conversation_config_override.{tts.voice_id,
  agent.first_message, agent.prompt.prompt}  (true = the client may override)
- conversation_config.agent.prompt.tools[]  ({type, name, expects_response,
  parameters.required, parameters.properties}; resolved from tool_ids)
- conversation_config.agent.prompt.built_in_tools.end_call
- conversation_config.agent.dynamic_variables.dynamic_variable_placeholders
"""

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import new_session, now_iso
from app.models import Member
from app.services import elevenlabs, pipeline, sessions
from tests.live.support import need, need_tool, storage, xi_get

pytestmark = pytest.mark.live

VOICE_AGENTS = Path(__file__).resolve().parents[2] / "voice_agents"
TOOLS = {tool["name"]: tool for tool in json.loads((VOICE_AGENTS / "tools.json").read_text(encoding="utf-8"))}

KINDS = ("welcome", "practice", "family_line")
# Which client tools go on which agent (voice_agents/README.md, "Settings per agent").
CLIENT_TOOLS = {"welcome": {"consent_result", "voice_consent_result"}, "practice": {"mark_tactic", "practice_result"},
                "family_line": set()}
VOICES = ("police", "bank", "nurse")
VARIABLE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")

_agents: dict[str, dict[str, Any]] = {}


def agent_setting(kind: str) -> str:
    return sessions.AGENT_SETTINGS[kind].upper()


def agent(kind: str) -> dict[str, Any]:
    """The live config of one agent, fetched once per run."""
    need("ELEVENLABS_API_KEY", agent_setting(kind))
    if kind not in _agents:
        agent_id = getattr(get_settings(), sessions.AGENT_SETTINGS[kind])
        response = xi_get(f"/v1/convai/agents/{agent_id}")
        assert response.status_code == 200, (
            f"{kind} agent: GET /v1/convai/agents/{{id}} answered {response.status_code}: {response.text[:200]}")
        _agents[kind] = response.json()
    return _agents[kind]


def prompt_of(config: dict[str, Any]) -> dict[str, Any]:
    return config["conversation_config"]["agent"]["prompt"]


# ---------------------------------------------------------------- the account


def test_api_key_works_and_there_is_credit(report):
    need("ELEVENLABS_API_KEY")
    response = xi_get("/v1/user/subscription")
    assert response.status_code == 200, f"GET /v1/user/subscription answered {response.status_code}"
    body = response.json()
    used, limit = body["character_count"], body["character_limit"]
    report(f"ElevenLabs: {body.get('tier')} plan, {used:,} of {limit:,} characters used, {limit - used:,} left; "
           f"voice slots {body.get('voice_slots_used')} of {body.get('voice_limit')}")
    assert limit - used > 0, "no characters left this month"


# ---------------------------------------------------------------- the agents


@pytest.mark.parametrize("kind", KINDS)
def test_agent_exists_with_authentication_on(kind):
    config = agent(kind)
    assert config["platform_settings"]["auth"]["enable_auth"] is True, f"{kind} agent: authentication is off"


@pytest.mark.parametrize("kind", KINDS)
def test_agent_has_its_client_tools(kind):
    tools = prompt_of(agent(kind)).get("tools") or []
    client = {tool["name"]: tool for tool in tools if tool.get("type") == "client"}
    assert set(client) == CLIENT_TOOLS[kind], (
        f"{kind} agent: client tools {sorted(client)}, expected {sorted(CLIENT_TOOLS[kind])}")
    for name, tool in client.items():
        wanted = TOOLS[name]
        assert tool.get("expects_response") is False, f"{kind} agent: {name} has 'Wait for response' on"
        parameters = tool.get("parameters") or {}
        assert sorted(parameters.get("required") or []) == sorted(wanted["parameters"]["required"]), (
            f"{kind} agent: {name} requires {parameters.get('required')}, tools.json says "
            f"{wanted['parameters']['required']}")
        for field, spec in wanted["parameters"]["properties"].items():
            live = (parameters.get("properties") or {}).get(field)
            assert live is not None, f"{kind} agent: {name} has no parameter {field}"
            assert live.get("type") == spec["type"], f"{kind} agent: {name}.{field} is {live.get('type')}"


@pytest.mark.parametrize("kind", KINDS)
def test_agent_can_end_the_call(kind):
    prompt = prompt_of(agent(kind))
    built_in = (prompt.get("built_in_tools") or {}).get("end_call")
    listed = any(tool.get("type") == "system" and tool.get("name") == "end_call" for tool in prompt.get("tools") or [])
    assert built_in or listed, f"{kind} agent: the end_call system tool is off"


def test_practice_agent_allows_the_overrides():
    override = agent("practice")["platform_settings"]["overrides"]["conversation_config_override"]
    allowed = {
        "tts.voice_id": override["tts"].get("voice_id"),
        "agent.first_message": override["agent"].get("first_message"),
        "agent.prompt.prompt": override["agent"]["prompt"].get("prompt"),
    }
    off = [name for name, on in allowed.items() if on is not True]
    assert not off, f"practice agent: these overrides are off: {off} (the voice override is sent on every call)"


@pytest.fixture(scope="module")
def sent_variables(tmp_path_factory) -> dict[str, set[str]]:
    """The dynamic-variable names the back end really sends, per kind of
    call: a welcome, a practice and a family-line call, answered through the
    API (FAKE_ELEVENLABS on, no model keys, no after-call work)."""
    from app.main import app

    async def nothing() -> None:
        return None

    env = {"FAKE_ELEVENLABS": "true", "OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": ""}
    with storage(tmp_path_factory.mktemp("variables"), **env), pytest.MonkeyPatch.context() as patch:
        patch.setattr(pipeline, "after_call", lambda call_id: nothing())
        with TestClient(app) as client:
            family = client.post("/api/families", json={"name": "The Kovacs", "safe_word_set": True, "members": [
                {"name": "Sara", "relationship": "mother", "consent_practice": True},
                {"name": "Jon", "relationship": "son", "is_organiser": True, "consent_practice": True},
            ]}).json()
            sara, jon = family["members"][0]["id"], family["members"][1]["id"]
            with new_session() as db:
                member = db.get(Member, jon)
                member.consent_clone_at, member.voice_id, member.voice_status = now_iso(), "voice_fake_jon", "ready"
                db.commit()
            sent: dict[str, set[str]] = {}

            client.get(f"/api/members/{sara}/phone-state")
            call_id = client.post(f"/api/members/{sara}/welcome-call").json()["call_id"]
            sent["welcome"] = set(client.post(f"/api/calls/{call_id}/answer").json()["dynamic_variables"])
            client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})

            client.get(f"/api/members/{sara}/phone-state")
            call_id = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon}
                                  ).json()["call_id"]
            sent["practice"] = set(client.post(f"/api/calls/{call_id}/answer").json()["dynamic_variables"])
            client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})

            line = client.post(f"/api/members/{sara}/family-line").json()
            sent["family_line"] = set(line["session"]["dynamic_variables"])
    return sent


@pytest.mark.parametrize("kind", KINDS)
def test_agent_defines_every_variable_the_back_end_sends(kind, sent_variables):
    config = agent(kind)
    agent_part = config["conversation_config"]["agent"]
    placeholders = set((agent_part.get("dynamic_variables") or {}).get("dynamic_variable_placeholders") or {})
    sent = sent_variables[kind]
    missing = sorted(sent - placeholders)
    assert not missing, f"{kind} agent: no placeholder for {missing} (the back end sends {sorted(sent)})"
    # The other way round: a variable the prompt uses but nobody sends stops the conversation from starting.
    used = set(VARIABLE.findall(agent_part.get("first_message") or ""))
    used |= set(VARIABLE.findall(prompt_of(config).get("prompt") or ""))
    unsent = sorted(name for name in used - sent if not name.startswith("system__"))
    assert not unsent, f"{kind} agent: the prompt or first message uses {unsent}, which the back end never sends"


# ---------------------------------------------------------------- voices and tokens


@pytest.mark.parametrize("which", VOICES)
def test_library_voice_exists(which, report):
    setting = f"ELEVENLABS_{which.upper()}_VOICE_ID"
    need("ELEVENLABS_API_KEY", setting)
    response = xi_get(f"/v1/voices/{getattr(get_settings(), setting.lower())}")
    assert response.status_code == 200, f"{setting}: GET /v1/voices/{{id}} answered {response.status_code}"
    body = response.json()
    report(f"voice {which}: {body.get('name')} ({body.get('category')})")


@pytest.mark.parametrize("kind", KINDS)
async def test_token_for_each_agent(kind):
    need("ELEVENLABS_API_KEY", agent_setting(kind))
    token = await elevenlabs.conversation_token(sessions.agent_id_for(kind, get_settings()))
    assert token.token, f"{kind}: no conversation token"
    assert token.conversation_id, f"{kind}: the token answer had no conversation_id"


# ---------------------------------------------------------------- a clone round trip (LIVE_CLONE=1)


SPEECH = ("This is a test recording for Callback. It was made by the computer, and the voice made from it "
          "is deleted again straight after the test. One, two, three, four, five.")


def speech_file(folder: Path) -> Path:
    """About ten seconds of computer speech as mp4 (aac), like an iPhone recording."""
    aiff, mp4 = folder / "speech.aiff", folder / "speech.mp4"
    subprocess.run(["say", "-o", str(aiff), SPEECH], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-c:a", "aac", str(mp4)],
                   check=True, capture_output=True)
    return mp4


def test_voice_clone_round_trip(tmp_path, report):
    if os.environ.get("LIVE_CLONE") != "1":
        pytest.skip("uses a voice slot; set LIVE_CLONE=1 to run it")
    need("ELEVENLABS_API_KEY")
    need_tool("say")
    need_tool("ffmpeg")
    from app.main import app

    path = speech_file(tmp_path)
    voice_id = None
    with TestClient(app) as client:
        family = client.post("/api/families", json={"name": "Live Test", "members": [
            {"name": "Jon", "relationship": "son", "is_organiser": True}]}).json()
        jon = family["members"][0]["id"]
        try:
            with path.open("rb") as audio:
                response = client.post(f"/api/members/{jon}/voice", files={"audio": (path.name, audio, "audio/mp4")})
            assert response.status_code == 200 and response.json() == {"voice_ready": True}, response.text[:300]
            with new_session() as db:
                voice_id = db.get(Member, jon).voice_id
            assert voice_id and xi_get(f"/v1/voices/{voice_id}").status_code == 200
            assert client.delete(f"/api/members/{jon}/voice").status_code == 200
            gone = xi_get(f"/v1/voices/{voice_id}").status_code
            assert gone in (400, 404), f"the clone is still at ElevenLabs after deletion ({gone})"
            report("voice clone: made from 10 s of speech, then deleted")
            voice_id = None
        finally:
            if voice_id:  # the test failed half way: do not leave the clone behind
                client.delete(f"/api/members/{jon}/voice")
