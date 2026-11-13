"""Drive the whole practice path over HTTP, the way the phone page and the
laptop will. Run it against a server started with FAKE_ELEVENLABS=true.

Usage (from backend/):
    .venv/bin/python scripts/fake_phone.py [BASE_URL]      # default http://localhost:8765

Prints PASS or FAIL per step and exits non-zero on the first failure.
"""

import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

DEFAULT_BASE_URL = "http://localhost:8765"


class StepFailed(Exception):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise StepFailed(message)


def expect(response: httpx.Response, status: int) -> Any:
    check(response.status_code == status,
          f"{response.request.method} {response.request.url.path} -> {response.status_code}, "
          f"expected {status}: {response.text[:300]}")
    return response.json() if response.content else None


def make_tone(folder: Path) -> tuple[Path, str]:
    """A two-second 440 Hz tone, as webm (opus) or, failing that, mp4 (aac)."""
    check(shutil.which("ffmpeg") is not None, "ffmpeg is not installed")
    for name, codec, mime in (("tone.webm", "libopus", "audio/webm"), ("tone.mp4", "aac", "audio/mp4")):
        path = folder / name
        result = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
             "-c:a", codec, str(path)],
            capture_output=True,
        )
        if result.returncode == 0 and path.exists():
            return path, mime
    raise StepFailed("ffmpeg could not make a test tone")


def poll(fetch, done, seconds: float, interval: float = 0.5) -> Any:
    """Call fetch() until done(value) is true or the time runs out."""
    deadline = time.monotonic() + seconds
    value = None
    while time.monotonic() < deadline:
        value = fetch()
        if done(value):
            return value
        time.sleep(interval)
    raise StepFailed(f"timed out after {seconds:.0f} s; last value: {str(value)[:300]}")


class Run:
    def __init__(self, base_url: str) -> None:
        self.http = httpx.Client(base_url=base_url.rstrip("/"), timeout=30)
        self.state: dict[str, Any] = {}

    def phone_state(self, member_id: str) -> dict[str, Any]:
        return expect(self.http.get(f"/api/members/{member_id}/phone-state"), 200)

    # ---------------------------------------------------------------- steps

    def health(self) -> None:
        body = expect(self.http.get("/api/health"), 200)
        check(body.get("ok") is True, f"health: {body}")

    def create_family(self) -> None:
        body = expect(self.http.post("/api/families", json={
            "name": "The Kovacs", "safe_word_set": True,
            "members": [
                {"name": "Sara", "relationship": "mother", "consent_practice": True},
                {"name": "Jon", "relationship": "son", "is_organiser": True, "consent_practice": True},
            ],
        }), 201)
        check(len(body["members"]) == 2, f"expected two members: {body}")
        self.state["family_id"] = body["family_id"]
        self.state["sara"] = body["members"][0]["id"]
        self.state["jon"] = body["members"][1]["id"]

    def upload_voice(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path, mime = make_tone(Path(folder))
            with path.open("rb") as audio:
                body = expect(self.http.post(f"/api/members/{self.state['jon']}/voice",
                                             files={"audio": (path.name, audio, mime)}), 200)
        check(body == {"voice_ready": True}, f"voice: {body}")

    def phone_online(self) -> None:
        state = self.phone_state(self.state["sara"])
        check(state["member"]["id"] == self.state["sara"], f"phone-state is for another member: {state['member']}")
        check(state["incoming_call"] is None, f"unexpected incoming call before any practice: {state['incoming_call']}")

    def start_practice(self) -> None:
        self.phone_state(self.state["sara"])  # keep the phone "online" right before the check
        body = expect(self.http.post("/api/practice-calls", json={
            "target_member_id": self.state["sara"], "voice_member_id": self.state["jon"],
            "scenario": "relative_new_number", "difficulty": 1, "delay_seconds": 0,
        }), 201)
        check(body["status"] == "ringing", f"status: {body}")
        self.state["call_id"] = body["call_id"]

    def see_incoming_call(self) -> None:
        state = poll(lambda: self.phone_state(self.state["sara"]),
                     lambda s: (s["incoming_call"] or {}).get("call_id") == self.state["call_id"], 10)
        check(state["incoming_call"]["kind"] == "practice", f"kind: {state['incoming_call']}")

    def answer(self) -> None:
        session = expect(self.http.post(f"/api/calls/{self.state['call_id']}/answer"), 200)
        check(session["kind"] == "practice", f"kind: {session.get('kind')}")
        check(bool(session.get("conversation_token")), "no conversation_token")
        check(bool(session.get("conversation_id")), "no conversation_id")
        check("voiceId" in session.get("overrides", {}).get("tts", {}), f"overrides: {session.get('overrides')}")
        check(session.get("dynamic_variables", {}).get("target_name") == "Sara",
              f"target_name: {session.get('dynamic_variables')}")
        check((session.get("reveal") or {}).get("voice_of") == "Jon", f"reveal: {session.get('reveal')}")

    def post_events(self) -> None:
        expect(self.http.post(f"/api/calls/{self.state['call_id']}/events", json={"events": [
            {"type": "turn", "speaker": "agent", "text": "Mum? It's me. I dropped my phone, so this is a new number."},
            {"type": "tactic", "key": "new_number"},
            {"type": "turn", "speaker": "user", "text": "Jon? What's our family word?"},
            {"type": "outcome", "outcome": "asked_safe_word"},
            {"type": "revealed"},
        ]}), 200)

    def end(self) -> None:
        expect(self.http.post(f"/api/calls/{self.state['call_id']}/end", json={"ended_by": "agent"}), 200)

    def wait_scored(self) -> None:
        call = poll(lambda: expect(self.http.get(f"/api/calls/{self.state['call_id']}"), 200),
                    lambda c: c["status"] == "scored", 30)
        check(call["id"] == self.state["call_id"], f"id: {call['id']}")
        check(call["result"] is not None and call["result"]["outcome"] == "asked_safe_word",
              f"result: {call['result']}")
        check([t["key"] for t in call["tactics"]] == ["new_number"], f"tactics: {call['tactics']}")
        check(len(call["turns"]) == 2, f"turns: {call['turns']}")

    def tap_family_number(self) -> None:
        body = expect(self.http.post(f"/api/members/{self.state['sara']}/family-line"), 200)
        check(bool(body.get("call_id")) and body["call_id"] != self.state["call_id"], f"family-line: {body}")
        check(body["session"]["kind"] == "family_line", f"session: {body['session']}")

    def relative_told(self) -> None:
        state = self.phone_state(self.state["jon"])
        kinds = [message["kind"] for message in state["messages"]]
        check("callback_notice" in kinds, f"Jon's messages: {state['messages']}")


STEPS = [
    ("health", Run.health),
    ("create a family of two, both consent ticks", Run.create_family),
    ("upload a two-second tone as member 2's voice", Run.upload_voice),
    ("member 1's phone polls phone-state", Run.phone_online),
    ("start a practice call (target 1, voice 2)", Run.start_practice),
    ("member 1's phone sees incoming_call", Run.see_incoming_call),
    ("answer and get a session", Run.answer),
    ("post one events batch", Run.post_events),
    ("end the call (ended_by agent)", Run.end),
    ("call becomes scored within 30 s", Run.wait_scored),
    ("member 1 taps the family number", Run.tap_family_number),
    ("member 2's phone shows a callback_notice", Run.relative_told),
]


def main() -> int:
    base_url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BASE_URL
    print(f"Fake phone against {base_url}")
    run = Run(base_url)
    for number, (name, step) in enumerate(STEPS, start=1):
        try:
            step(run)
        except (StepFailed, httpx.HTTPError, KeyError, TypeError, ValueError) as error:
            print(f"FAIL {number:2d}. {name}: {type(error).__name__}: {error}")
            return 1
        print(f"PASS {number:2d}. {name}")
    print("All steps passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
