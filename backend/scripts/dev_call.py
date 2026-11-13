"""Set up a test family and ring a real phone, for testing real calls with the
bare test phone page (app/routers/dev.py) before the real front end has one.

Usage (from backend/, with the back end running without FAKE_ELEVENLABS):
    .venv/bin/python scripts/dev_call.py setup --voice ~/Desktop/me.m4a [--public https://xyz.trycloudflare.com]
    .venv/bin/python scripts/dev_call.py ring  [--scenario relative_new_number] [--difficulty 1]
    .venv/bin/python scripts/dev_call.py ring  --scenario bank_security      # a library voice, no clone
    .venv/bin/python scripts/dev_call.py welcome
    .venv/bin/python scripts/dev_call.py status

`setup` creates a family of two with both consent ticks: "You" (who gets the
calls) and "Your voice" (whose recording is cloned, so the caller sounds like
you). Record 30 to 60 seconds of your own voice for --voice; never use someone
else's without their yes. It prints the phone link to open on your phone. The
phone page must be open before `ring`, or the back end answers phone_offline.
State is kept in data/dev_call.json (git-ignored).
"""

import argparse
import json
import mimetypes
import sys
from pathlib import Path
from typing import Any

import httpx

BACKEND_DIR = Path(__file__).resolve().parent.parent
STATE = BACKEND_DIR / "data" / "dev_call.json"


def load() -> dict[str, Any]:
    if not STATE.exists():
        raise SystemExit("No test family yet. Run: scripts/dev_call.py setup --voice FILE")
    return json.loads(STATE.read_text())


def save(state: dict[str, Any]) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2))


def call(http: httpx.Client, method: str, path: str, **kwargs: Any) -> Any:
    response = http.request(method, path, **kwargs)
    if not response.is_success:
        raise SystemExit(f"{method} {path}: HTTP {response.status_code}\n{response.text[:600]}")
    return response.json() if response.content else None


def setup(http: httpx.Client, args: argparse.Namespace) -> None:
    voice = Path(args.voice).expanduser()
    if not voice.exists():
        raise SystemExit(f"No such file: {voice}")
    family = call(http, "POST", "/api/families", json={
        "name": "The Testers", "safe_word_set": True,
        "members": [
            {"name": args.name, "relationship": "parent", "consent_practice": True},
            {"name": args.voice_name, "relationship": "child", "is_organiser": True, "consent_practice": True},
        ],
    })
    target, owner = family["members"][0]["id"], family["members"][1]["id"]
    mime = mimetypes.guess_type(voice.name)[0] or "audio/mp4"
    with voice.open("rb") as audio:
        call(http, "POST", f"/api/members/{owner}/voice", files={"audio": (voice.name, audio, mime)}, timeout=120)
    public = (args.public or args.base).rstrip("/")
    state = {"family_id": family["family_id"], "target": target, "voice_owner": owner, "public": public}
    save(state)
    print(f"Family {family['family_id']}: {args.name} gets the calls, the caller sounds like {args.voice_name}.")
    print(f"Open on your phone:  {public}/api/dev/phone/{target}")
    print(f"Owner's page:        {public}/api/dev/phone/{owner}   (gets the family-number notice)")


def ring(http: httpx.Client, args: argparse.Namespace) -> None:
    state = load()
    scenarios = {s["key"]: s for s in call(http, "GET", "/api/scenarios")}
    if args.scenario not in scenarios:
        raise SystemExit(f"Unknown scenario. Choose one of: {', '.join(scenarios)}")
    uses_clone = scenarios[args.scenario].get("voice") == "clone"
    body = {"target_member_id": state["target"], "voice_member_id": state["voice_owner"] if uses_clone else None,
            "scenario": args.scenario, "difficulty": args.difficulty, "delay_seconds": 0}
    started = call(http, "POST", "/api/practice-calls", json=body)
    state["last_call"] = started["call_id"]
    save(state)
    print(f"Ringing: {started['call_id']} ({args.scenario}, difficulty {args.difficulty}, "
          f"{'cloned voice' if uses_clone else 'library voice'}). Answer on the phone.")


def welcome(http: httpx.Client, _args: argparse.Namespace) -> None:
    state = load()
    started = call(http, "POST", f"/api/members/{state['target']}/welcome-call")
    state["last_call"] = started["call_id"]
    save(state)
    print(f"Welcome call ringing: {started['call_id']}")


def status(http: httpx.Client, _args: argparse.Namespace) -> None:
    state = load()
    if not state.get("last_call"):
        raise SystemExit("No call yet. Run: scripts/dev_call.py ring")
    view = call(http, "GET", f"/api/calls/{state['last_call']}")
    print(f"{view['id']}: {view['kind']} {view['status']}")
    for turn in view.get("turns", []):
        print(f"  {turn['speaker']:5} {turn['text'][:150]}")
    print("  tactics:", [t["key"] for t in view.get("tactics", [])])
    if view.get("result"):
        print("  result:", json.dumps(view["result"], ensure_ascii=False)[:600])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://localhost:8000", help="the back end (default localhost:8000)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("setup")
    p.add_argument("--voice", required=True, help="30-60 s recording of your own voice")
    p.add_argument("--name", default="You")
    p.add_argument("--voice-name", default="Your voice")
    p.add_argument("--public", help="the HTTPS address the phone uses (tunnel)")
    p = sub.add_parser("ring")
    p.add_argument("--scenario", default="relative_new_number")
    p.add_argument("--difficulty", type=int, default=1, choices=(1, 2, 3))
    sub.add_parser("welcome")
    sub.add_parser("status")
    args = parser.parse_args()
    with httpx.Client(base_url=args.base, timeout=30) as http:
        {"setup": setup, "ring": ring, "welcome": welcome, "status": status}[args.command](http, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
