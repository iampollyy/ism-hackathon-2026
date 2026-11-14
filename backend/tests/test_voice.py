"""Track A tests: services/audio.py and routers/voice.py. OWNER: track A."""

import json
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import new_session, now_iso
from app.models import Consent, FamilyOwner, Member, MemberJoin
from app.routers import voice as voice_router
from app.services import audio, elevenlabs


def make_audio(path: Path, codec: str, silence_ms: int = 1500, seconds: int = 2) -> Path:
    """`seconds` of a stereo tone after `silence_ms` of silence."""
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
         f"sine=frequency=440:sample_rate=48000:duration={seconds}",
         "-af", f"adelay={silence_ms}:all=1,aformat=channel_layouts=stereo", "-c:a", codec, str(path)],
        check=True,
    )
    return path


def probe(path: Path) -> dict[str, str]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=channels,sample_rate,codec_name:format=duration",
         "-of", "default=noprint_wrappers=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return dict(line.split("=", 1) for line in out.strip().splitlines())


@pytest.fixture(scope="module")
def webm(tmp_path_factory) -> bytes:
    return make_audio(tmp_path_factory.mktemp("a") / "in.webm", "libopus").read_bytes()


@pytest.fixture(scope="module")
def mp4(tmp_path_factory) -> bytes:
    return make_audio(tmp_path_factory.mktemp("a") / "in.mp4", "aac").read_bytes()


def member(member_id: str) -> Member:
    with new_session() as s:
        return s.get(Member, member_id)


def consents(member_id: str) -> list[Consent]:
    with new_session() as s:
        return list(s.scalars(select(Consent).where(Consent.member_id == member_id).order_by(Consent.id)))


def set_voice(member_id: str, voice_id: str) -> None:
    with new_session() as s:
        row = s.get(Member, member_id)
        row.voice_id, row.voice_status, row.consent_clone_at = voice_id, "ready", now_iso()
        s.commit()


def record_deletes(monkeypatch, fail: bool = False) -> list[str]:
    deleted: list[str] = []

    async def fake_delete(voice_id: str) -> None:
        if fail:
            raise elevenlabs.ElevenLabsError("ElevenLabs answered 500", upstream_status=500)
        deleted.append(voice_id)

    monkeypatch.setattr(elevenlabs, "delete_voice", fake_delete)
    return deleted


def owned_family(client) -> dict:
    """A family made by a logged-in organiser (a family_owners row): Sara
    (mother) and Jon (son, the organiser)."""
    registered = client.post("/api/auth/register", json={"name": "Jon", "email": "jon@example.com",
                                                         "password": "correct horse"})
    assert registered.status_code in (200, 201), registered.text
    response = client.post("/api/families", json={"name": "The Kovacs", "safe_word_set": True, "members": [
        {"name": "Sara", "relationship": "mother", "consent_practice": True},
        {"name": "Jon", "relationship": "son", "is_organiser": True, "consent_practice": True},
    ]})
    assert response.status_code == 201, response.text
    family = response.json()
    with new_session() as s:
        assert s.get(FamilyOwner, family["family_id"]) is not None
    return family


def join(client, member_id: str, clone: bool, phone: str | None = None) -> None:
    body = {"consent_practice": True, "consent_clone_from_call": clone, "phone_number": phone}
    response = client.post(f"/api/join/{member_id}", json=body)
    assert response.status_code == 200, response.text


def upload(client, member_id: str, audio: bytes):
    return client.post(f"/api/members/{member_id}/voice", files={"audio": ("recording.webm", audio, "audio/webm")})


def consent_files(member_id: str) -> list[str]:
    folder = get_settings().media_path / "consent"
    return sorted(path.name for path in folder.glob(f"{member_id}.*")) if folder.is_dir() else []


# ---------------------------------------------------------------- audio clean-up


@pytest.mark.parametrize("name,codec", [("in.webm", "libopus"), ("in.mp4", "aac"), ("in.m4a", "aac")])
async def test_clean_recording_mono_mp3_with_silence_trimmed(tmp_path, name, codec) -> None:
    source = make_audio(tmp_path / name, codec)
    target = await audio.clean_recording(source, tmp_path / "out" / "clean.mp3")
    info = probe(target)
    assert info["codec_name"] == "mp3"
    assert info["channels"] == "1" and info["sample_rate"] == "44100"
    assert float(info["duration"]) < 2.6  # the 1.5 s of leading silence is gone


async def test_clean_recording_rejects_garbage(tmp_path) -> None:
    source = tmp_path / "bad.webm"
    source.write_bytes(b"this is not audio")
    with pytest.raises(audio.AudioError):
        await audio.clean_recording(source, tmp_path / "out.mp3")


async def test_clean_recording_rejects_silence(tmp_path) -> None:
    source = tmp_path / "silent.webm"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=2",
                    "-c:a", "libopus", str(source)], check=True)
    with pytest.raises(audio.AudioError, match="silent"):
        await audio.clean_recording(source, tmp_path / "out.mp3")


@pytest.mark.parametrize("filename,content_type,expected", [
    ("recording.webm", "audio/webm", "webm"),
    ("blob", "audio/webm;codecs=opus", "webm"),
    ("blob", "audio/mp4", "mp4"),
    ("voice.m4a", "application/octet-stream", "m4a"),
    (None, "audio/x-m4a", "m4a"),
    ("blob", "application/octet-stream", "bin"),
])
def test_upload_extension(filename, content_type, expected) -> None:
    assert voice_router.upload_extension(filename, content_type) == expected


# ---------------------------------------------------------------- POST /voice


def test_upload_webm_clones_and_records_consent(client, make_family, webm) -> None:
    jon = make_family()["members"][1]["id"]
    response = client.post(f"/api/members/{jon}/voice", files={"audio": ("recording.webm", webm, "audio/webm")})
    assert response.status_code == 200, response.text
    assert response.json() == {"voice_ready": True}

    row = member(jon)
    assert row.voice_id.startswith("voice_fake_")
    assert row.voice_status == "ready" and row.consent_clone_at
    clone_rows = [c for c in consents(jon) if c.kind == "clone"]
    assert len(clone_rows) == 1 and clone_rows[0].source == "voice_recording"
    original = Path(clone_rows[0].evidence)
    assert original.name == f"{jon}.webm" and original.parent.name == "consent"
    assert original.read_bytes() == webm  # saved unchanged
    assert voice_router.clean_path(jon).exists()

    family = client.get(f"/api/families/{row.family_id}").json()
    view = next(m for m in family["members"] if m["id"] == jon)
    assert view["voice_ready"] is True and view["consent"]["clone"] is True


def test_upload_mp4_blob_from_iphone(client, make_family, mp4) -> None:
    jon = make_family()["members"][1]["id"]
    response = client.post(f"/api/members/{jon}/voice", files={"audio": ("blob", mp4, "audio/mp4")})
    assert response.status_code == 200, response.text
    assert Path(consents(jon)[-1].evidence).name == f"{jon}.mp4"


def test_upload_unknown_member_is_404(client, webm) -> None:
    response = client.post("/api/members/mem_nobody/voice", files={"audio": ("r.webm", webm, "audio/webm")})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_upload_empty_file_is_422(client, make_family) -> None:
    jon = make_family()["members"][1]["id"]
    response = client.post(f"/api/members/{jon}/voice", files={"audio": ("r.webm", b"", "audio/webm")})
    assert response.status_code == 422


def test_upload_garbage_is_clone_failed(client, make_family) -> None:
    jon = make_family()["members"][1]["id"]
    response = client.post(f"/api/members/{jon}/voice", files={"audio": ("r.webm", b"nope" * 100, "audio/webm")})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "clone_failed"
    assert member(jon).voice_status == "failed"
    assert [c.kind for c in consents(jon)].count("clone") == 1  # the recording is still the record


def test_clone_failure_is_502_and_keeps_an_earlier_voice(client, make_family, webm, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    set_voice(jon, "voice_old")

    async def failing_clone(name: str, path: Path) -> str:
        raise elevenlabs.ElevenLabsError("ElevenLabs answered 400", upstream_status=400)

    monkeypatch.setattr(elevenlabs, "clone_voice", failing_clone)
    response = client.post(f"/api/members/{jon}/voice", files={"audio": ("r.webm", webm, "audio/webm")})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "clone_failed"
    row = member(jon)
    assert row.voice_id == "voice_old" and row.voice_status == "ready"


def test_new_recording_replaces_and_deletes_the_old_clone(client, make_family, webm, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    set_voice(jon, "voice_old")
    deleted = record_deletes(monkeypatch)

    async def clone(name: str, path: Path) -> str:
        assert path.suffix == ".mp3" and path.exists()  # the cleaned copy is sent
        return "voice_new"

    monkeypatch.setattr(elevenlabs, "clone_voice", clone)
    response = client.post(f"/api/members/{jon}/voice", files={"audio": ("r.webm", webm, "audio/webm")})
    assert response.status_code == 200
    assert member(jon).voice_id == "voice_new"
    assert deleted == ["voice_old"]


def test_opt_out_during_cloning_keeps_the_id_when_its_delete_fails(client, make_family, webm,
                                                                     monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]

    async def clone_then_opt_out(name: str, path: Path) -> str:
        with new_session() as db:  # the member opts out while the clone is being made
            db.get(Member, jon).opted_out_at = now_iso()
            db.commit()
        return "voice_new"

    monkeypatch.setattr(elevenlabs, "clone_voice", clone_then_opt_out)
    record_deletes(monkeypatch, fail=True)
    response = client.post(f"/api/members/{jon}/voice", files={"audio": ("r.webm", webm, "audio/webm")})
    assert (response.status_code, response.json()["error"]["code"]) == (502, "voice_delete_failed")
    assert member(jon).voice_id == "voice_new", "kept, so a retried opt-out can delete it"

    deleted = record_deletes(monkeypatch)
    assert client.post(f"/api/members/{jon}/opt-out").status_code == 200
    assert deleted == ["voice_new"]
    assert member(jon).voice_id is None and member(jon).voice_status == "deleted"


def test_delete_keeps_the_status_of_a_clone_stored_meanwhile(client, make_family, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    set_voice(jon, "voice_old")
    deleted: list[str] = []

    async def delete_while_a_new_clone_arrives(voice_id: str) -> None:
        deleted.append(voice_id)
        if voice_id == "voice_old":
            set_voice(jon, "voice_new")

    monkeypatch.setattr(elevenlabs, "delete_voice", delete_while_a_new_clone_arrives)
    assert client.delete(f"/api/members/{jon}/voice").status_code == 200
    row = member(jon)
    assert deleted == ["voice_old"]
    assert (row.voice_id, row.voice_status) == ("voice_new", "ready")

    set_voice(jon, "voice_old")
    deleted.clear()
    assert client.post(f"/api/members/{jon}/opt-out").status_code == 200
    assert deleted == ["voice_old", "voice_new"], "an opt-out deletes the newer clone too"
    assert (member(jon).voice_id, member(jon).voice_status) == (None, "deleted")


def test_opted_out_member_cannot_upload(client, make_family, webm) -> None:
    jon = make_family()["members"][1]["id"]
    assert client.post(f"/api/members/{jon}/opt-out").status_code == 200
    response = client.post(f"/api/members/{jon}/voice", files={"audio": ("r.webm", webm, "audio/webm")})
    assert response.status_code == 409


# ---------------------------------------------------------------- POST /voice in a family an account made


def test_owned_family_refuses_a_member_who_never_joined(client, webm) -> None:
    sara = owned_family(client)["members"][0]["id"]
    response = upload(client, sara, webm)
    assert response.status_code == 409, response.text
    assert response.json()["error"] == {
        "code": "consent_missing",
        "message": "Sara hasn't agreed to a copy of their voice. They can tick it on their own phone first.",
    }
    row = member(sara)
    assert row.voice_id is None and row.voice_status == "none" and row.consent_clone_at is None
    assert consent_files(sara) == [], "refused before anything is written"
    assert not voice_router.clean_path(sara).exists()
    assert [c.kind for c in consents(sara) if c.kind == "clone"] == []


def test_owned_family_refuses_a_member_who_joined_without_the_voice_tick(client, webm) -> None:
    sara = owned_family(client)["members"][0]["id"]
    join(client, sara, clone=False)
    response = upload(client, sara, webm)
    assert (response.status_code, response.json()["error"]["code"]) == (409, "consent_missing")
    assert member(sara).voice_id is None and consent_files(sara) == []


def test_owned_family_clones_a_member_who_ticked_it_themselves(client, webm) -> None:
    sara = owned_family(client)["members"][0]["id"]
    join(client, sara, clone=True)
    response = upload(client, sara, webm)
    assert response.status_code == 200, response.text
    row = member(sara)
    assert row.voice_id and row.voice_status == "ready"
    assert consent_files(sara) == [f"{sara}.webm"]


def test_owned_family_refuses_once_the_voice_tick_is_taken_back(client, webm) -> None:
    sara = owned_family(client)["members"][0]["id"]
    join(client, sara, clone=True)
    join(client, sara, clone=False)  # joined again, the tick left empty
    response = upload(client, sara, webm)
    assert (response.status_code, response.json()["error"]["code"]) == (409, "consent_missing")


def test_owned_family_lets_the_organiser_record_their_own_voice(client, webm) -> None:
    jon = owned_family(client)["members"][1]["id"]
    with new_session() as s:
        assert s.get(MemberJoin, jon) is not None  # the organiser joins at sign-up
    response = upload(client, jon, webm)
    assert response.status_code == 200, response.text
    assert member(jon).voice_status == "ready"


def test_owned_family_withdrawal_while_cloning_keeps_no_clone(client, webm, monkeypatch) -> None:
    sara = owned_family(client)["members"][0]["id"]
    join(client, sara, clone=True)
    deleted = record_deletes(monkeypatch)

    async def clone_then_untick(name: str, path: Path) -> str:
        with new_session() as s:  # the member takes the tick back while the clone is being made
            s.add(Consent(member_id=sara, kind="clone_from_call_withdrawn", source="invite",
                          evidence="Left the voice tick empty on the invite page.", created_at=now_iso()))
            s.commit()
        return "voice_new"

    monkeypatch.setattr(elevenlabs, "clone_voice", clone_then_untick)
    response = upload(client, sara, webm)
    assert (response.status_code, response.json()["error"]["code"]) == (409, "consent_missing")
    assert deleted == ["voice_new"]
    assert member(sara).voice_id is None
    assert consent_files(sara) == [] and not voice_router.clean_path(sara).exists()


# ---------------------------------------------------------------- DELETE /voice


def test_delete_voice_also_deletes_the_raw_recordings(client, make_family, webm, mp4, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    assert upload(client, jon, webm).status_code == 200
    assert client.post(f"/api/members/{jon}/voice", files={"audio": ("blob", mp4, "audio/mp4")}).status_code == 200
    assert consent_files(jon) == [f"{jon}.mp4", f"{jon}.webm"]
    other = make_family()["members"][1]["id"]
    assert upload(client, other, webm).status_code == 200
    record_deletes(monkeypatch)

    assert client.delete(f"/api/members/{jon}/voice").status_code == 200
    assert consent_files(jon) == [], "the raw recording is enough to clone again"
    assert not voice_router.clean_path(jon).exists()
    assert [c.kind for c in consents(jon)].count("clone") == 2, "the consents rows stay as the record"
    assert consent_files(other) == [f"{other}.webm"], "nobody else's recording is touched"


def test_delete_voice_deletes_a_raw_recording_whose_clone_failed(client, make_family, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    assert upload(client, jon, b"nope" * 100).status_code == 502  # kept as the record, no clone
    assert consent_files(jon) == [f"{jon}.webm"]
    assert client.delete(f"/api/members/{jon}/voice").status_code == 200
    assert consent_files(jon) == []



def test_delete_voice_deletes_at_elevenlabs_and_clears_it(client, make_family, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    set_voice(jon, "voice_jon")
    deleted = record_deletes(monkeypatch)
    response = client.delete(f"/api/members/{jon}/voice")
    assert response.status_code == 200 and response.json() == {"ok": True}
    assert deleted == ["voice_jon"]
    row = member(jon)
    assert row.voice_id is None and row.voice_status == "deleted"


def test_delete_voice_failure_keeps_the_id_for_a_retry(client, make_family, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    set_voice(jon, "voice_jon")
    record_deletes(monkeypatch, fail=True)
    response = client.delete(f"/api/members/{jon}/voice")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "voice_delete_failed"
    row = member(jon)
    assert row.voice_id == "voice_jon" and row.voice_status == "ready"


def test_delete_voice_without_a_voice_is_ok(client, make_family, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    deleted = record_deletes(monkeypatch)
    assert client.delete(f"/api/members/{jon}/voice").status_code == 200
    assert deleted == []
    assert member(jon).voice_status == "none"


def test_delete_voice_unknown_member_is_404(client) -> None:
    assert client.delete("/api/members/mem_nobody/voice").status_code == 404


# ---------------------------------------------------------------- opt-out


def test_opt_out_records_and_deletes_the_clone(client, make_family, monkeypatch) -> None:
    family = make_family()
    jon = family["members"][1]["id"]
    set_voice(jon, "voice_jon")
    deleted = record_deletes(monkeypatch)
    response = client.post(f"/api/members/{jon}/opt-out")
    assert response.status_code == 200 and response.json() == {"ok": True}
    assert deleted == ["voice_jon"]
    row = member(jon)
    assert row.opted_out_at and row.voice_id is None and row.voice_status == "deleted"
    opt_outs = [c for c in consents(jon) if c.kind == "opt_out"]
    assert len(opt_outs) == 1 and opt_outs[0].source == "manual"
    view = next(m for m in client.get(f"/api/families/{family['family_id']}").json()["members"] if m["id"] == jon)
    assert view["consent"] == {"clone": False, "practice": False}


def test_opt_out_deletes_the_raw_recording_and_forgets_the_phone_number(client, webm, monkeypatch) -> None:
    sara = owned_family(client)["members"][0]["id"]
    join(client, sara, clone=True, phone="+49 151 23456789")
    assert upload(client, sara, webm).status_code == 200
    assert client.get(f"/api/join/{sara}").json()["phone_number"] == "+49 151 23456789"
    record_deletes(monkeypatch)

    assert client.post(f"/api/members/{sara}/opt-out").status_code == 200
    assert consent_files(sara) == [] and not voice_router.clean_path(sara).exists()
    view = client.get(f"/api/join/{sara}").json()
    assert (view["opted_out"], view["phone_number"]) == (True, None)
    with new_session() as s:
        assert s.get(MemberJoin, sara).phone_number is None
    kinds = [c.kind for c in consents(sara)]
    assert "clone" in kinds and "opt_out" in kinds, "the consents rows stay as the record"


def test_opt_out_is_recorded_even_if_deletion_fails_and_can_be_retried(client, make_family, monkeypatch) -> None:
    jon = make_family()["members"][1]["id"]
    set_voice(jon, "voice_jon")
    record_deletes(monkeypatch, fail=True)
    response = client.post(f"/api/members/{jon}/opt-out")
    assert response.status_code == 502
    assert member(jon).opted_out_at is not None  # no new practice can use them meanwhile

    deleted = record_deletes(monkeypatch)
    assert client.post(f"/api/members/{jon}/opt-out").status_code == 200
    assert deleted == ["voice_jon"]
    assert member(jon).voice_id is None
    assert [c.kind for c in consents(jon)].count("opt_out") == 1


def test_opt_out_unknown_member_is_404(client) -> None:
    response = client.post("/api/members/mem_nobody/opt-out")
    assert response.status_code == 404
    assert json.loads(response.text)["error"]["code"] == "not_found"
