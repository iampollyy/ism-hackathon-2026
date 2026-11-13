"""Live: the practice path in process with the real models and a fake voice.

The same steps as scripts/fake_phone.py, through TestClient instead of HTTP,
with FAKE_ELEVENLABS=true (no voice, no ElevenLabs credit) and the model keys
from backend/.env: the director writes the brief, the scorer the lesson and
the planner the next step. Afterwards model_runs must hold director, scorer
and planner rows, none with an error.
"""

import json
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agents import llm, scorer
from app.config import get_settings
from app.db import new_session
from app.models import Call, ModelRun, Result
from tests.live.support import need_job, need_tool

pytestmark = pytest.mark.live

JOBS = ("director", "scorer", "planner")
SCORED_SECONDS = 30  # as fake_phone.py waits
PLANNED_SECONDS = 2 * llm.JOB_SECONDS["planner"] + 5  # both planner models, at worst
CLOSE = 0.8  # an answer slower than this share of the limit is flagged in the report


def tone(folder: Path) -> Path:
    """A two-second tone as mp4 (aac), standing in for a voice recording."""
    path = folder / "tone.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                    "-c:a", "aac", str(path)], check=True, capture_output=True)
    return path


def wait_for(fetch: Callable[[], Any], done: Callable[[Any], bool], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    value = fetch()
    while not done(value):
        assert time.monotonic() < deadline, f"{what} within {seconds:.0f} s; last: {str(value)[:300]}"
        time.sleep(0.5)
        value = fetch()
    return value


def job_rows() -> list[ModelRun]:
    with new_session() as db:
        return list(db.scalars(select(ModelRun).where(ModelRun.job.in_(JOBS)).order_by(ModelRun.id)))


def test_practice_path_with_real_models(tmp_path, monkeypatch, report):
    for job in JOBS:
        need_job(job)
    need_tool("ffmpeg")
    monkeypatch.setenv("FAKE_ELEVENLABS", "true")
    get_settings.cache_clear()
    from app.main import app

    started = time.monotonic()
    with TestClient(app) as client:
        family = client.post("/api/families", json={"name": "The Kovacs", "safe_word_set": True, "members": [
            {"name": "Sara", "relationship": "mother", "consent_practice": True},
            {"name": "Jon", "relationship": "son", "is_organiser": True, "consent_practice": True},
        ]}).json()
        sara, jon = family["members"][0]["id"], family["members"][1]["id"]
        with tone(tmp_path).open("rb") as audio:
            uploaded = client.post(f"/api/members/{jon}/voice", files={"audio": ("tone.mp4", audio, "audio/mp4")})
        assert uploaded.json() == {"voice_ready": True}, uploaded.text[:300]

        client.get(f"/api/members/{sara}/phone-state")
        created = client.post("/api/practice-calls", json={
            "target_member_id": sara, "voice_member_id": jon, "scenario": "relative_new_number",
            "difficulty": 1, "delay_seconds": 0})
        assert created.status_code == 201 and created.json()["status"] == "ringing", created.text[:300]
        call_id = created.json()["call_id"]
        state = client.get(f"/api/members/{sara}/phone-state").json()
        assert (state["incoming_call"] or {}).get("call_id") == call_id

        session = client.post(f"/api/calls/{call_id}/answer").json()
        assert session["kind"] == "practice" and session["conversation_token"], str(session)[:300]
        assert "voiceId" in session["overrides"].get("tts", {}) and session["reveal"]["voice_of"] == "Jon"
        client.post(f"/api/calls/{call_id}/events", json={"events": [
            {"type": "turn", "speaker": "agent", "text": "Mum? It's me. I dropped my phone, so this is a new number."},
            {"type": "tactic", "key": "new_number"},
            {"type": "turn", "speaker": "user", "text": "Jon? What's our family word?"},
            {"type": "outcome", "outcome": "asked_safe_word"},
            {"type": "revealed"},
        ]})
        client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"})

        call = wait_for(lambda: client.get(f"/api/calls/{call_id}").json(), lambda c: c["status"] == "scored",
                        SCORED_SECONDS, "the call was not scored")
        assert call["result"]["outcome"] == "asked_safe_word" and call["result"]["lesson"]
        wait_for(job_rows, lambda rows: any(row.job == "planner" for row in rows), PLANNED_SECONDS,
                 "the planner did not run")
        line = client.post(f"/api/members/{sara}/family-line")
        assert line.status_code == 200 and line.json()["session"]["kind"] == "family_line"
        kinds = [message["kind"] for message in client.get(f"/api/members/{jon}/phone-state").json()["messages"]]
        assert "callback_notice" in kinds

    rows = job_rows()
    with new_session() as db:
        result = db.get(Result, call_id)
        brief = json.loads(db.get(Call, call_id).brief_json or "{}")
    for row in rows:
        limit = llm.JOB_SECONDS[row.job]
        close = " CLOSE TO THE LIMIT" if (row.latency_ms or 0) > CLOSE * limit * 1000 else ""
        report(f"practice path: {row.job} on {row.model}: {'ok' if row.ok else 'FAILED (' + str(row.error) + ')'} "
               f"in {(row.latency_ms or 0) / 1000:.1f} s (limit {limit:g} s{close})")
    report(f"practice path: scored and planned in {time.monotonic() - started:.1f} s")

    for job in JOBS:
        assert any(row.job == job for row in rows), f"no {job} row in model_runs"
    failed = [f"{row.job} on {row.model}: {row.error}" for row in rows if not row.ok or row.error]
    assert not failed, f"model_runs rows with errors: {failed}"
    assert result is not None and result.scorer_version == scorer.PROMPT_VERSION, (
        f"the result's words came from {result.scorer_version if result else 'nowhere'}, not the scorer")
    assert brief.get("opening_line"), "the call has no brief"
