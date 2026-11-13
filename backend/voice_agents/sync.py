"""Push the agents' prompts and settings in voice_agents/ to ElevenLabs.
OWNER: track A. See docs/backend.md "The agents as files" and README.md here.

Usage (from backend/):
    .venv/bin/python voice_agents/sync.py           # dry run: print what would be sent
    .venv/bin/python voice_agents/sync.py --push    # send it

For each agent it sets the system prompt (the .md file), the first message,
the variable placeholders, the longest call, authentication and the
override toggles, with PATCH /v1/convai/agents/{agent_id}. It never adds or
removes tools; add the client tools from tools.json in the dashboard. The
request shape follows ElevenLabs' API reference but was not tried live
(check). The API key is read through app.config and never printed.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from app.config import get_settings  # noqa: E402

BASE_URL = "https://api.elevenlabs.io"

AGENTS: dict[str, dict[str, Any]] = {
    "welcome": {
        "agent_id_setting": "elevenlabs_welcome_agent_id",
        "prompt_file": "welcome.md",
        "first_message": "Hi {{member_name}}, this is Callback. {{organiser_name}} set this up for your "
                         "family. Have you got two minutes?",
        "max_duration_seconds": 360,
        "overrides": False,
        "placeholders": {"member_name": "Sara", "organiser_name": "Jon", "family_name": "The Kovacs"},
    },
    "practice": {
        "agent_id_setting": "elevenlabs_practice_agent_id",
        "prompt_file": "practice.md",
        "first_message": "{{opening_line}}",
        "max_duration_seconds": 180,
        "overrides": True,
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
        "agent_id_setting": "elevenlabs_family_line_agent_id",
        "prompt_file": "family_line.md",
        "first_message": "Family line. Hi {{caller_name}}, you did the right thing by calling.",
        "max_duration_seconds": 90,
        "overrides": False,
        "placeholders": {
            "family_name": "The Kovacs",
            "caller_name": "Sara",
            "relative_name": "Jon",
            "what_happened": "It was a practice call in Jon's voice about a new phone number. "
                             "They asked for the family word.",
        },
    },
}


def agent_payload(spec: dict[str, Any]) -> dict[str, Any]:
    """The PATCH body for one agent."""
    prompt = (HERE / spec["prompt_file"]).read_text(encoding="utf-8")
    overrides = spec["overrides"]
    return {
        "conversation_config": {
            "agent": {
                "first_message": spec["first_message"],
                "prompt": {"prompt": prompt},
                "dynamic_variables": {"dynamic_variable_placeholders": spec["placeholders"]},
            },
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--push", action="store_true", help="send the changes (default: dry run)")
    args = parser.parse_args()
    settings = get_settings()

    failures = 0
    for name, spec in AGENTS.items():
        agent_id = getattr(settings, spec["agent_id_setting"])
        payload = agent_payload(spec)
        if not args.push:
            print(f"--- {name} ({spec['agent_id_setting'].upper()} {'set' if agent_id else 'NOT SET'})")
            print(json.dumps(payload, indent=2)[:1500])
            continue
        if not agent_id or not settings.elevenlabs_api_key:
            print(f"{name}: skipped, {spec['agent_id_setting'].upper()} or ELEVENLABS_API_KEY is not set")
            failures += 1
            continue
        response = httpx.patch(f"{BASE_URL}/v1/convai/agents/{agent_id}", json=payload,
                               headers={"xi-api-key": settings.elevenlabs_api_key}, timeout=30)
        print(f"{name}: HTTP {response.status_code}")
        if not response.is_success:
            print(response.text[:500])
            failures += 1
    if not args.push:
        print("\nDry run only. Run with --push to send.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
