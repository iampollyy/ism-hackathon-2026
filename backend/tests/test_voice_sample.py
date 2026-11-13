"""Track 2 (full app): the member's voice from their own side of the welcome
call. services/voice_sample.py, routers/voice_sample.py and the
`voice_consent` event in routers/calls.py.

clean_recording and clone_voice are faked (the fake cleaner writes a real mp3
of a chosen length, so the length is measured by the real ffprobe); one test
runs the real ffmpeg clean-up end to end."""

import json
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import new_session, now_iso
from app.models import Call, CallEvent, Consent, Member, VoiceSample
from app.routers import voice as voice_router
from app.services import audio, elevenlabs, pipeline, voice_sample

REAL_CLEAN = audio.clean_recording

# ---------------------------------------------------------------- audio


def tone_mp3(path: Path, seconds: float, silence: float = 0.0) -> Path:
    """`seconds` of a tone, then `silence` seconds of silence, as mono mp3."""
    filters = f"apad=pad_dur={silence}" if silence else "anull"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=220:duration={seconds}",
         "-af", filters, "-ac", "1", "-codec:a", "libmp3lame", "-q:a", "9", str(path)],
        check=True,
    )
    return path


@pytest.fixture(scope="module")
def long_mp3(tmp_path_factory) -> bytes:
    return tone_mp3(tmp_path_factory.mktemp("a") / "long.mp3", 30).read_bytes()


@pytest.fixture(scope="module")
def short_mp3(tmp_path_factory) -> bytes:
    return tone_mp3(tmp_path_factory.mktemp("a") / "short.mp3", 4).read_bytes()


# ---------------------------------------------------------------- fakes


@pytest.fixture
def fakes(monkeypatch, long_mp3) -> SimpleNamespace:
    """The cleaner writes `state.cleaned` (30 s by default) to its target;
    the cloner returns `state.voice_id`, or raises `state.clone_error`;
    deletes at ElevenLabs are recorded. The after-call pipeline is off."""
    state = SimpleNamespace(cleaned=long_mp3, cleans=[], clones=[], deleted=[],
                            voice_id="voice_from_call", clone_error=None, during_clone=None)

    async def fake_clean(source: Path, target: Path) -> Path:
        assert source.exists(), "the upload is cleaned from its stored file"
        state.cleans.append(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(state.cleaned)
        return target

    async def fake_clone(name: str, path: Path) -> str:
        state.clones.append((name, path.name, path.exists()))
        if state.during_clone:
            state.during_clone()
        if state.clone_error:
            raise state.clone_error
        return state.voice_id

    async def fake_delete(voice_id: str) -> None:
        state.deleted.append(voice_id)

    def no_after_call(call_id: str):
        async def nothing() -> None:
            return None
        return nothing()

    monkeypatch.setattr(audio, "clean_recording", fake_clean)
    monkeypatch.setattr(elevenlabs, "clone_voice", fake_clone)
    monkeypatch.setattr(elevenlabs, "delete_voice", fake_delete)
    monkeypatch.setattr(pipeline, "after_call", no_after_call)
    return state


# ---------------------------------------------------------------- helpers


def tick(member_id: str) -> None:
    """The join tick written by the invite flow (track 1)."""
    with new_session() as db:
        db.add(Consent(member_id=member_id, kind="clone_from_call", source="invite",
                       evidence="my voice may be cloned from my welcome call", created_at=now_iso()))
        db.commit()


def set_voice(member_id: str, voice_id: str) -> None:
    with new_session() as db:
        row = db.get(Member, member_id)
        row.voice_id, row.voice_status, row.consent_clone_at = voice_id, "ready", now_iso()
        db.commit()


def member(member_id: str) -> Member:
    with new_session() as db:
        return db.get(Member, member_id)


def sample_row(call_id: str) -> VoiceSample | None:
    with new_session() as db:
        return db.get(VoiceSample, call_id)


def clone_rows(member_id: str) -> list[Consent]:
    with new_session() as db:
        return list(db.scalars(select(Consent).where(Consent.member_id == member_id, Consent.kind == "clone")))


def welcome_call(client, member_id: str, answer: bool = True) -> str:
    client.get(f"/api/members/{member_id}/phone-state")
    response = client.post(f"/api/members/{member_id}/welcome-call")
    assert response.status_code == 201, response.text
    call_id = response.json()["call_id"]
    if answer:
        assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    return call_id


def upload(client, call_id: str, content: bytes = b"opus bytes from MediaRecorder",
           name: str = "welcome.webm", content_type: str = "audio/webm"):
    return client.post(f"/api/calls/{call_id}/voice-sample", files={"audio": (name, content, content_type)})


def say(client, call_id: str, given: bool):
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "voice_consent", "given": given}]})
    assert response.status_code == 200, response.text
    return response


def status(client, call_id: str) -> dict:
    response = client.get(f"/api/calls/{call_id}/voice-sample/status")
    assert response.status_code == 200, response.text
    return response.json()


def wait_until_done(call_id: str, seconds: float = 5.0) -> VoiceSample:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        row = sample_row(call_id)
        if row is not None and row.state not in ("cloning", "waiting_for_consent"):
            return row
        time.sleep(0.02)
    raise AssertionError(f"the voice sample of {call_id} is still {sample_row(call_id).state}")


def samples_dir() -> Path:
    return get_settings().media_path / "samples"


def stored_files() -> list[str]:
    folder = samples_dir()
    return sorted(path.name for path in folder.iterdir()) if folder.exists() else []


@pytest.fixture
def sara_joined(make_family) -> tuple[dict, str]:
    """A family; Sara has the join tick. Returns (family, sara_id)."""
    family = make_family()
    sara = family["members"][0]["id"]
    tick(sara)
    return family, sara


# ---------------------------------------------------------------- both orders


def test_sample_then_consent_clones_the_voice(client, sara_joined, fakes) -> None:
    family, sara = sara_joined
    call_id = welcome_call(client, sara)
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"}).status_code == 200

    response = upload(client, call_id)
    assert response.status_code == 200, response.text
    assert response.json() == {"accepted": True, "cloning": False,
                               "reason": "Waiting for Sara's spoken yes on the welcome call."}
    assert status(client, call_id)["state"] == "waiting_for_consent"
    assert len(stored_files()) == 1 and stored_files()[0].startswith(call_id)
    assert fakes.clones == []

    say(client, call_id, True)
    row = wait_until_done(call_id)
    assert row.state == "ready" and row.reason is None and row.path is None
    assert 29 <= row.speech_seconds <= 31  # measured by ffprobe on the cleaned file

    assert fakes.clones == [(f"callback-{sara}", fakes.clones[0][1], True)]
    assert fakes.clones[0][1].endswith(".clean.mp3")
    who = member(sara)
    assert (who.voice_id, who.voice_status) == ("voice_from_call", "ready") and who.consent_clone_at
    rows = clone_rows(sara)
    assert len(rows) == 1
    assert (rows[0].source, rows[0].call_id) == ("welcome_call", call_id)
    assert rows[0].evidence == "Said yes on the welcome call (voice_consent_result)"

    assert stored_files() == [], "the upload is deleted once the voice is made"
    assert voice_router.clean_path(sara).read_bytes() == fakes.cleaned, "the cleaned copy is kept like an upload's"

    view = next(m for m in client.get(f"/api/families/{family['family_id']}").json()["members"] if m["id"] == sara)
    assert view["voice_ready"] is True and view["voice_status"] == "ready" and view["consent"]["clone"] is True
    assert status(client, call_id) == {"call_id": call_id, "state": "ready", "reason": None,
                                       "speech_seconds": row.speech_seconds}


def test_consent_then_sample_clones_the_voice(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    assert len(clone_rows(sara)) == 1, "the spoken yes is recorded at once"
    assert status(client, call_id) == {"call_id": call_id, "state": "none",
                                       "reason": "No recording from this call yet.", "speech_seconds": None}

    response = upload(client, call_id)
    assert response.json() == {"accepted": True, "cloning": True, "reason": None}
    assert wait_until_done(call_id).state == "ready"
    assert len(fakes.clones) == 1
    assert member(sara).voice_id == "voice_from_call"


def test_the_upload_is_taken_while_the_call_is_still_in_progress(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    assert upload(client, call_id, name="blob", content_type="audio/mp4").json()["cloning"] is True
    assert wait_until_done(call_id).state == "ready"
    assert fakes.cleans[0].suffix == ".mp4"


def test_a_repeated_yes_writes_one_row_and_clones_once(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    upload(client, call_id)
    client.post(f"/api/calls/{call_id}/events", json={"events": [
        {"type": "voice_consent", "given": True}, {"type": "voice_consent", "given": True}]})
    say(client, call_id, True)
    assert wait_until_done(call_id).state == "ready"
    assert len(clone_rows(sara)) == 1
    assert len(fakes.clones) == 1
    again = upload(client, call_id).json()
    assert again == {"accepted": True, "cloning": False, "reason": "A voice was already made from this call."}
    assert len(fakes.clones) == 1 and stored_files() == []


# ---------------------------------------------------------------- never without both consents


def test_without_the_join_tick_nothing_is_cloned_or_kept(client, make_family, fakes) -> None:
    sara = make_family()["members"][0]["id"]
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    with new_session() as db:
        stored = list(db.scalars(select(CallEvent.type).where(CallEvent.call_id == call_id)))
    assert "voice_consent" in stored, "the event is stored"
    assert clone_rows(sara) == [], "but no clone consent is recorded"

    response = upload(client, call_id).json()
    assert response["cloning"] is False
    assert "did not agree, when joining" in response["reason"]
    assert stored_files() == [] and sample_row(call_id) is None
    assert fakes.cleans == [] and fakes.clones == []
    assert status(client, call_id)["state"] == "none"
    assert "did not agree, when joining" in status(client, call_id)["reason"]
    assert member(sara).voice_status == "none"


def test_without_a_spoken_yes_the_recording_waits_and_nothing_is_cloned(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    assert client.post(f"/api/calls/{call_id}/end", json={"ended_by": "agent"}).status_code == 200
    assert upload(client, call_id).json()["cloning"] is False
    time.sleep(0.1)
    assert status(client, call_id)["state"] == "waiting_for_consent"
    assert fakes.clones == [] and clone_rows(sara) == []
    assert member(sara).voice_id is None


def test_a_spoken_no_lets_go_of_the_recording(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    upload(client, call_id)
    assert len(stored_files()) == 1
    say(client, call_id, False)
    row = sample_row(call_id)
    assert row.state == "none" and "did not say a clear yes" in row.reason
    assert stored_files() == [], "the recording is deleted"
    assert clone_rows(sara) == [] and fakes.clones == []
    assert status(client, call_id)["state"] == "none"


def test_a_no_before_the_upload_means_it_is_not_kept(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    say(client, call_id, False)
    response = upload(client, call_id).json()
    assert response["cloning"] is False and "did not say a clear yes" in response["reason"]
    assert stored_files() == [] and fakes.clones == []


def test_the_latest_answer_counts(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    say(client, call_id, False)  # changed their mind before the recording arrived
    assert upload(client, call_id).json()["cloning"] is False
    assert fakes.clones == [] and stored_files() == []
    assert len(clone_rows(sara)) == 1, "the yes stays on record; the no is the stored event after it"


def test_a_no_never_touches_an_existing_clone(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    set_voice(sara, "voice_recorded_earlier")
    call_id = welcome_call(client, sara)
    say(client, call_id, False)
    upload(client, call_id)
    assert (member(sara).voice_id, member(sara).voice_status) == ("voice_recorded_earlier", "ready")
    assert fakes.deleted == []


def test_an_opt_out_while_waiting_lets_go_of_the_recording(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    upload(client, call_id)
    assert client.post(f"/api/members/{sara}/opt-out").status_code == 200
    say(client, call_id, True)
    assert clone_rows(sara) == [], "an opted-out member's yes is not recorded"
    assert sample_row(call_id).state == "none" and "has left Callback" in sample_row(call_id).reason
    assert stored_files() == [] and fakes.clones == []


def test_opting_out_during_the_clone_deletes_the_new_voice(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    say(client, call_id, True)

    def opt_out() -> None:
        with new_session() as db:
            db.get(Member, sara).opted_out_at = now_iso()
            db.commit()

    fakes.during_clone = opt_out
    upload(client, call_id)
    row = wait_until_done(call_id)
    assert row.state == "none" and "has left Callback" in row.reason
    assert fakes.deleted == ["voice_from_call"]
    assert member(sara).voice_id is None and stored_files() == []


def test_voice_consent_on_other_calls_changes_nothing(client, sara_joined, fakes) -> None:
    family, sara = sara_joined
    jon = family["members"][1]["id"]
    set_voice(jon, "voice_jon")
    client.get(f"/api/members/{sara}/phone-state")
    created = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon})
    call_id = created.json()["call_id"]
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    say(client, call_id, True)
    assert clone_rows(sara) == []
    assert sample_row(call_id) is None


def test_the_event_takes_only_a_boolean(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    response = client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "voice_consent"}]})
    assert response.status_code == 422
    response = client.post(f"/api/calls/{call_id}/events",
                           json={"events": [{"type": "voice_consent", "given": "maybe"}]})
    assert response.status_code == 422


# ---------------------------------------------------------------- too little voice, failures


def test_short_audio_fails_with_a_reason(client, sara_joined, fakes, short_mp3) -> None:
    family, sara = sara_joined
    fakes.cleaned = short_mp3
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    upload(client, call_id)
    row = wait_until_done(call_id)
    assert row.state == "failed"
    assert row.reason == "Only about 4 seconds of Sara's voice were heard on the call; a voice needs at least 10."
    assert 3.5 <= row.speech_seconds <= 4.5
    assert fakes.clones == [], "too little voice is never sent to ElevenLabs"
    assert member(sara).voice_status == "failed" and member(sara).voice_id is None
    assert stored_files() == []
    body = status(client, call_id)
    assert body["state"] == "failed" and body["reason"] == row.reason
    view = next(m for m in client.get(f"/api/families/{family['family_id']}").json()["members"] if m["id"] == sara)
    assert view["voice_status"] == "failed" and view["voice_ready"] is False


def test_short_audio_keeps_the_previous_clone(client, sara_joined, fakes, short_mp3) -> None:
    _, sara = sara_joined
    set_voice(sara, "voice_old")
    fakes.cleaned = short_mp3
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    upload(client, call_id)
    row = wait_until_done(call_id)
    assert row.state == "failed" and row.reason.endswith("Sara's earlier voice is still used.")
    assert (member(sara).voice_id, member(sara).voice_status) == ("voice_old", "ready")
    assert fakes.deleted == []


def test_the_minimum_is_a_setting(client, sara_joined, fakes, short_mp3, monkeypatch) -> None:
    monkeypatch.setenv("VOICE_SAMPLE_MIN_SECONDS", "3")
    get_settings.cache_clear()
    _, sara = sara_joined
    fakes.cleaned = short_mp3
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    upload(client, call_id)
    assert wait_until_done(call_id).state == "ready"


def test_a_new_clone_replaces_and_deletes_the_older_one(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    set_voice(sara, "voice_old")
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    upload(client, call_id)
    assert wait_until_done(call_id).state == "ready"
    assert member(sara).voice_id == "voice_from_call"
    assert fakes.deleted == ["voice_old"]


def test_an_elevenlabs_failure_is_kept_as_the_reason(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    fakes.clone_error = elevenlabs.ElevenLabsError("ElevenLabs answered 400: voice_limit_reached",
                                                   upstream_status=400)
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    upload(client, call_id)
    row = wait_until_done(call_id)
    assert row.state == "failed" and "voice_limit_reached" in row.reason
    assert member(sara).voice_status == "failed"
    assert stored_files() == []


def test_a_new_upload_after_a_failure_tries_again(client, sara_joined, fakes, short_mp3, long_mp3) -> None:
    _, sara = sara_joined
    fakes.cleaned = short_mp3
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    upload(client, call_id)
    assert wait_until_done(call_id).state == "failed"

    fakes.cleaned = long_mp3
    assert upload(client, call_id).json()["cloning"] is True
    assert wait_until_done(call_id).state == "ready"
    assert member(sara).voice_status == "ready"


def test_unreadable_audio_fails_with_the_real_cleaner(client, sara_joined, fakes, monkeypatch) -> None:
    monkeypatch.setattr(audio, "clean_recording", REAL_CLEAN)
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    upload(client, call_id, content=b"this is not audio" * 50)
    row = wait_until_done(call_id)
    assert row.state == "failed" and row.reason.startswith("The recording from the call could not be used")
    assert fakes.clones == []


def test_the_real_cleaner_counts_only_the_voice(client, sara_joined, fakes, monkeypatch, tmp_path) -> None:
    """End to end with ffmpeg: 6 s of sound and 20 s of silence is too little."""
    monkeypatch.setattr(audio, "clean_recording", REAL_CLEAN)
    content = tone_mp3(tmp_path / "quiet.mp3", 6, silence=20).read_bytes()
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    upload(client, call_id, content=content, name="welcome.mp3", content_type="audio/mpeg")
    row = wait_until_done(call_id, seconds=20)
    assert row.state == "failed" and row.speech_seconds < 10
    assert fakes.clones == []


# ---------------------------------------------------------------- which calls, the upload's limits


def test_wrong_call_kind_is_409(client, sara_joined, fakes) -> None:
    family, sara = sara_joined
    jon = family["members"][1]["id"]
    set_voice(jon, "voice_jon")
    client.get(f"/api/members/{sara}/phone-state")
    call_id = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": jon}).json()["call_id"]
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    response = upload(client, call_id)
    assert response.status_code == 409 and response.json()["error"]["code"] == "not_a_welcome_call"
    assert status(client, call_id)["state"] == "none"
    assert stored_files() == []


def test_unanswered_welcome_call_is_409(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara, answer=False)
    response = upload(client, call_id)
    assert response.status_code == 409 and response.json()["error"]["code"] == "not_answered"
    assert client.post(f"/api/calls/{call_id}/decline").status_code == 200
    assert upload(client, call_id).json()["error"]["code"] == "not_answered"


def test_failed_call_is_409(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    with new_session() as db:
        db.get(Call, call_id).status = "failed"
        db.commit()
    response = upload(client, call_id)
    assert response.status_code == 409 and response.json()["error"]["code"] == "call_over"


def test_unknown_call_is_404(client, fakes) -> None:
    assert upload(client, "call_nope").status_code == 404
    assert client.get("/api/calls/call_nope/voice-sample/status").status_code == 404
    assert client.get("/api/members/mem_nope/voice-sample").status_code == 404


def test_opted_out_member_cannot_upload(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    assert client.post(f"/api/members/{sara}/opt-out").status_code == 200
    response = upload(client, call_id)
    assert response.status_code == 409 and response.json()["error"]["code"] == "opted_out"


def test_empty_and_too_large_uploads(client, sara_joined, fakes, monkeypatch) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    assert upload(client, call_id, content=b"").status_code == 422
    monkeypatch.setattr(voice_router, "MAX_UPLOAD_BYTES", 10)
    response = upload(client, call_id, content=b"x" * 11)
    assert response.status_code == 413 and response.json()["error"]["code"] == "too_large"
    assert stored_files() == []


# ---------------------------------------------------------------- the daily cap


def use_clones_today(member_id: str, count: int) -> None:
    with new_session() as db:
        for _ in range(count):
            db.add(Consent(member_id=member_id, kind="clone", source="voice_recording",
                           evidence="an upload", created_at=now_iso()))
        db.commit()


def test_the_cap_allows_the_last_clone_of_the_day(client, sara_joined, fakes, monkeypatch) -> None:
    monkeypatch.setenv("DAILY_CLONE_LIMIT", "2")
    get_settings.cache_clear()
    family, sara = sara_joined
    use_clones_today(family["members"][1]["id"], 1)
    call_id = welcome_call(client, sara)
    upload(client, call_id)
    say(client, call_id, True)  # its own row is the second of the day: still allowed
    assert wait_until_done(call_id).state == "ready"


def test_over_the_cap_the_yes_is_recorded_but_nothing_is_cloned(client, sara_joined, fakes, monkeypatch) -> None:
    monkeypatch.setenv("DAILY_CLONE_LIMIT", "1")
    get_settings.cache_clear()
    family, sara = sara_joined
    use_clones_today(family["members"][1]["id"], 1)
    call_id = welcome_call(client, sara)
    upload(client, call_id)
    say(client, call_id, True)
    row = sample_row(call_id)
    assert row.state == "failed" and "daily limit" in row.reason
    assert len(clone_rows(sara)) == 1, "what they said is still recorded"
    assert stored_files() == [] and fakes.clones == []

    response = upload(client, call_id)  # a new attempt today
    assert response.status_code == 429 and response.json()["error"]["code"] == "daily_limit"
    assert status(client, call_id)["state"] == "failed"


def test_over_the_cap_before_the_upload(client, sara_joined, fakes, monkeypatch) -> None:
    monkeypatch.setenv("DAILY_CLONE_LIMIT", "1")
    get_settings.cache_clear()
    family, sara = sara_joined
    use_clones_today(family["members"][1]["id"], 1)
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    assert status(client, call_id)["state"] == "failed"
    assert upload(client, call_id).status_code == 429
    assert fakes.clones == [] and stored_files() == []


# ---------------------------------------------------------------- status


def test_member_status_follows_the_latest_welcome_call(client, sara_joined, fakes) -> None:
    _, sara = sara_joined
    body = client.get(f"/api/members/{sara}/voice-sample").json()
    assert body == {"call_id": None, "state": "none", "reason": "No welcome call yet.", "speech_seconds": None}

    call_id = welcome_call(client, sara)
    upload(client, call_id)
    body = client.get(f"/api/members/{sara}/voice-sample").json()
    assert (body["call_id"], body["state"]) == (call_id, "waiting_for_consent")

    say(client, call_id, True)
    wait_until_done(call_id)
    assert client.get(f"/api/members/{sara}/voice-sample").json()["state"] == "ready"


def test_a_clone_cut_short_by_a_restart_starts_again(client, sara_joined, fakes, long_mp3) -> None:
    _, sara = sara_joined
    call_id = welcome_call(client, sara)
    say(client, call_id, True)
    path = samples_dir() / f"{call_id}.abcd1234.webm"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"left over from before the restart")
    with new_session() as db:
        db.add(VoiceSample(call_id=call_id, member_id=sara, state="cloning", path=str(path),
                           created_at=now_iso(), updated_at=now_iso()))
        db.commit()
    assert not voice_sample.is_running(call_id)
    assert status(client, call_id)["state"] in ("cloning", "ready")
    assert wait_until_done(call_id).state == "ready"
    assert len(fakes.clones) == 1


# ---------------------------------------------------------------- measuring


async def test_speech_seconds_measures_the_file(tmp_path) -> None:
    seconds = await voice_sample.speech_seconds(tone_mp3(tmp_path / "three.mp3", 3))
    assert seconds is not None and 2.8 <= seconds <= 3.3


async def test_speech_seconds_of_garbage_is_none(tmp_path) -> None:
    junk = tmp_path / "junk.mp3"
    junk.write_bytes(b"not audio at all")
    assert await voice_sample.speech_seconds(junk) is None


# ---------------------------------------------------------------- the agent side


VOICE_AGENTS = Path(__file__).resolve().parents[1] / "voice_agents"


def test_the_tool_is_defined_and_on_the_welcome_agent() -> None:
    import sys

    tools = {tool["name"]: tool for tool in json.loads((VOICE_AGENTS / "tools.json").read_text())}
    tool = tools["voice_consent_result"]
    assert tool["type"] == "client" and tool["expects_response"] is False
    assert tool["parameters"]["required"] == ["given"]
    assert tool["parameters"]["properties"]["given"] == {"type": "boolean", "description": "true only for a clear yes"}

    sys.path.insert(0, str(VOICE_AGENTS))
    try:
        import agent_tests
        import sync
    finally:
        sys.path.remove(str(VOICE_AGENTS))
    assert sync.AGENTS["welcome"]["tools"] == ["consent_result", "voice_consent_result"]
    scenario = next(s for s in agent_tests.SCENARIOS if s.key == "welcome_yes")
    assert scenario.expect == {"given": True} and scenario.tool == "consent_result"
    assert scenario.also == {"voice_consent_result": {"given": True}}


def test_the_welcome_prompt_asks_about_the_voice() -> None:
    prompt = (VOICE_AGENTS / "welcome.md").read_text()
    assert "voice_consent_result" in prompt
    assert "can delete it any time" in prompt or "deleted any time" in prompt
    assert prompt.index("consent_result with their answer") < prompt.index("voice_consent_result")
