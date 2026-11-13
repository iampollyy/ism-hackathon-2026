"""Create or update the three ElevenLabs agents from the files in voice_agents/.
OWNER: track A. See docs/backend.md "The agents as files" and README.md here.

Usage (from backend/):
    .venv/bin/python voice_agents/sync.py               # dry run: print what would be sent
    .venv/bin/python voice_agents/sync.py --push        # create what is missing, update the rest
    .venv/bin/python voice_agents/sync.py --push --write-env
                                                        # also put the agent and voice ids in .env

--push does, in order:
1. The client tools in tools.json: created once (POST /v1/convai/tools), found
   by name afterwards and updated (PATCH), so their ids stay the same.
2. The agents: an agent whose id is not in .env is found by name
   ("Callback - Welcome", ...) or created (POST /v1/convai/agents/create).
3. Each agent gets its full settings (PATCH /v1/convai/agents/{id}): system
   prompt (the .md file), first message, language model, voice, variable
   placeholders, longest call, authentication on, override toggles, its client
   tools (tool_ids) and the end_call system tool.

--write-env sets ELEVENLABS_*_AGENT_ID and ELEVENLABS_{POLICE,BANK,NURSE}_VOICE_ID
in backend/.env, replacing those lines or adding them. It touches no other
line and prints nothing from the file. The API key is read through app.config
and never printed.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
BACKEND_DIR = HERE.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402

BASE_URL = "https://api.elevenlabs.io"

# The agents' language model. Fast, stays in role, calls the tools reliably.
# Judge by ear on a real call and move up (gpt-6.1-terra) only if it drifts.
AGENT_LLM = "gpt-6-luna"

# Library voices ("premade", offered for general use). Ids from GET /v1/voices.
VOICES = {
    "welcome": "EXAVITQu4vr4xnSDxMaL",      # Sarah: mature, reassuring
    "practice": "cjVigY5qzO86Huf0OWal",     # Eric: default only, replaced on every call
    "family_line": "pFZP5JQG7iQjIQuC4Bku",  # Lily: calm, warm
}
SCENARIO_VOICES = {
    "ELEVENLABS_POLICE_VOICE_ID": "pNInz6obpgDQGcFmaJgB",  # Adam: dominant, firm
    "ELEVENLABS_BANK_VOICE_ID": "XrExE9yKIg1WjnnlVkGX",    # Matilda: knowledgeable, professional
    "ELEVENLABS_NURSE_VOICE_ID": "Xb7hH8MSUJpSbSDYk0k2",   # Alice: clear, friendly
}

AGENTS: dict[str, dict[str, Any]] = {
    "welcome": {
        "name": "Callback - Welcome",
        "agent_id_setting": "elevenlabs_welcome_agent_id",
        "prompt_file": "welcome.md",
        "first_message": "Hi {{member_name}}, this is Callback. {{organiser_name}} set this up for your "
                         "family. Have you got two minutes?",
        "max_duration_seconds": 360,
        "overrides": False,
        "tools": ["consent_result", "voice_consent_result"],
        "placeholders": {"member_name": "Sara", "organiser_name": "Jon", "family_name": "The Kovacs"},
    },
    "practice": {
        "name": "Callback - Practice",
        "agent_id_setting": "elevenlabs_practice_agent_id",
        "prompt_file": "practice.md",
        "first_message": "{{opening_line}}",
        "max_duration_seconds": 180,
        "overrides": True,
        "tools": ["mark_tactic", "practice_result"],
        "placeholders": {
            "target_name": "Sara",
            "caller_claim": "Sara's son, Jon",
            "address_as": "Mum",
            "opening_line": "Mum? It's me. I dropped my phone, so this is a new number.",
            "scenario_brief": "You broke your phone this morning and are using a borrowed one.",
            "ask": "a transfer of a few hundred euros today, to a friend's account",
            "tactic_order": "new_number, urgency, secrecy",
            "difficulty": 1,
            "reveal_line": "Sara, this was a Callback practice call. The voice you heard was artificial.",
        },
    },
    "family_line": {
        "name": "Callback - Family line",
        "agent_id_setting": "elevenlabs_family_line_agent_id",
        "prompt_file": "family_line.md",
        "first_message": "Family line. Hi {{caller_name}}, you did the right thing by calling.",
        "max_duration_seconds": 90,
        "overrides": False,
        "tools": [],
        "placeholders": {
            "family_name": "The Kovacs",
            "caller_name": "Sara",
            "relative_name": "Jon",
            "what_happened": "It was a practice call in Jon's voice about a new phone number. "
                             "They asked for the family word.",
        },
    },
}

END_CALL = {
    "type": "system",
    "name": "end_call",
    "description": "",
    "params": {"system_tool_type": "end_call"},
}


def client_tools() -> dict[str, dict[str, Any]]:
    """tools.json by name."""
    tools = json.loads((HERE / "tools.json").read_text(encoding="utf-8"))
    return {tool["name"]: tool for tool in tools}


def agent_payload(key: str, spec: dict[str, Any], tool_ids: list[str]) -> dict[str, Any]:
    """The PATCH body for one agent."""
    prompt = (HERE / spec["prompt_file"]).read_text(encoding="utf-8")
    overrides = spec["overrides"]
    return {
        "name": spec["name"],
        "conversation_config": {
            "agent": {
                "first_message": spec["first_message"],
                "language": "en",
                "prompt": {
                    "prompt": prompt,
                    "llm": AGENT_LLM,
                    "tool_ids": tool_ids,
                    "built_in_tools": {"end_call": END_CALL},
                },
                "dynamic_variables": {"dynamic_variable_placeholders": spec["placeholders"]},
            },
            "tts": {"voice_id": VOICES[key]},
            "conversation": {"max_duration_seconds": spec["max_duration_seconds"]},
        },
        "platform_settings": {
            "auth": {"enable_auth": True},
            "overrides": {
                "conversation_config_override": {
                    "tts": {"voice_id": overrides},
                    "agent": {"prompt": {"prompt": overrides}, "first_message": overrides},
                },
            },
        },
    }


class Api:
    def __init__(self, api_key: str) -> None:
        self.client = httpx.Client(base_url=BASE_URL, headers={"xi-api-key": api_key}, timeout=30)

    def call(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.client.request(method, path, **kwargs)
        if not response.is_success:
            raise SystemExit(f"{method} {path}: HTTP {response.status_code}\n{response.text[:800]}")
        return response.json() if response.content else None

    def sync_tools(self) -> dict[str, str]:
        """Create or update the client tools; return their ids by name."""
        existing = {t["tool_config"]["name"]: t["id"] for t in self.call("GET", "/v1/convai/tools").get("tools", [])}
        ids: dict[str, str] = {}
        for name, tool in client_tools().items():
            body = {"tool_config": tool}
            if name in existing:
                self.call("PATCH", f"/v1/convai/tools/{existing[name]}", json=body)
                ids[name] = existing[name]
                print(f"tool {name}: updated")
            else:
                ids[name] = self.call("POST", "/v1/convai/tools", json=body)["id"]
                print(f"tool {name}: created")
        return ids

    def find_agent(self, name: str) -> str | None:
        found = self.call("GET", "/v1/convai/agents", params={"search": name, "page_size": 100})
        for agent in found.get("agents", []):
            if agent.get("name") == name:
                return agent["agent_id"]
        return None

    def ensure_agent(self, spec: dict[str, Any], agent_id: str) -> str:
        if agent_id:
            return agent_id
        found = self.find_agent(spec["name"])
        if found:
            print(f"agent {spec['name']}: found")
            return found
        created = self.call("POST", "/v1/convai/agents/create",
                            json={"name": spec["name"], "conversation_config": {"agent": {"prompt": {"prompt": "-"}}}})
        print(f"agent {spec['name']}: created")
        return created["agent_id"]


def write_env(values: dict[str, str]) -> None:
    """Set these keys in backend/.env, keeping every other line as it is."""
    path = BACKEND_DIR / ".env"
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    done: set[str] = set()
    out: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0].strip()
        if key in values:
            out.append(f"{key}={values[key]}")
            done.add(key)
        else:
            out.append(line)
    out += [f"{key}={value}" for key, value in values.items() if key not in done]
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f".env: set {', '.join(values)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--push", action="store_true", help="create or update on ElevenLabs (default: dry run)")
    parser.add_argument("--write-env", action="store_true", help="with --push: put the ids in backend/.env")
    args = parser.parse_args()
    settings = get_settings()

    if not args.push:
        for key, spec in AGENTS.items():
            agent_id = getattr(settings, spec["agent_id_setting"])
            print(f"--- {key} ({spec['agent_id_setting'].upper()} {'set' if agent_id else 'NOT SET'})")
            print(json.dumps(agent_payload(key, spec, [f"<{t}>" for t in spec["tools"]]), indent=2)[:1500])
        print("\nDry run only. Run with --push to send.")
        return 0
    if not settings.elevenlabs_api_key:
        print("ELEVENLABS_API_KEY is not set")
        return 1

    api = Api(settings.elevenlabs_api_key)
    tool_ids = api.sync_tools()
    env: dict[str, str] = {}
    for key, spec in AGENTS.items():
        agent_id = api.ensure_agent(spec, getattr(settings, spec["agent_id_setting"]))
        api.call("PATCH", f"/v1/convai/agents/{agent_id}",
                 json=agent_payload(key, spec, [tool_ids[name] for name in spec["tools"]]))
        print(f"agent {spec['name']}: settings pushed ({agent_id})")
        env[spec["agent_id_setting"].upper()] = agent_id
    env.update(SCENARIO_VOICES)
    changed = {key: value for key, value in env.items() if getattr(settings, key.lower(), None) != value}
    if not changed:
        print("\n.env already has every id.")
    elif args.write_env:
        write_env(changed)
    else:
        print("\nPut these in backend/.env (or run again with --write-env):")
        for key, value in changed.items():
            print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
