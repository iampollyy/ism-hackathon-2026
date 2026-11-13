"""Track 3: protection settings, random drills and the surprise drill
(services/protection.py, routers/protection.py). No network: the director
has no model key, so briefs use the scenario templates, and ElevenLabs is
faked. Time is passed in (now=...) and randomness is seeded."""

import asyncio
import json
import random
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app import schemas
from app.config import get_settings
from app.db import new_session, now_iso, parse_time, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, DrillCall, Member, MemberDrillSettings, ProtectionSettings
from app.services import protection, scheduler

VILNIUS = ZoneInfo("Europe/Vilnius")


# ---------------------------------------------------------------- helpers


def ids(family) -> list[str]:
    return [member["id"] for member in family["members"]]


def update_member(member_id: str, **fields) -> None:
    with new_session() as db:
        member = db.get(Member, member_id)
        for name, value in fields.items():
            setattr(member, name, value)
        db.commit()


def give_voice(member_id: str) -> None:
    update_member(member_id, consent_clone_at=now_iso(), voice_id=f"voice_{member_id}", voice_status="ready")


def enable(client, family_id: str, **fields) -> dict:
    response = client.put(f"/api/families/{family_id}/protection", json={"enabled": True, **fields})
    assert response.status_code == 200, response.text
    return response.json()


def drill_calls() -> list[tuple[Call, DrillCall]]:
    with new_session() as db:
        return list(db.execute(select(Call, DrillCall).join(DrillCall, DrillCall.call_id == Call.id)
                               .order_by(Call.created_at)).all())


def load_call(call_id: str) -> Call:
    with new_session() as db:
        return db.get(Call, call_id)


def add_rung_practice(family, member_id: str, ring_at: datetime, status: str = "scored") -> str:
    with new_session() as db:
        call = Call(id=new_call_id(), family_id=family["family_id"], kind="practice", target_member_id=member_id,
                    scenario="police", difficulty=1, status=status, ring_at=to_iso(ring_at),
                    created_at=to_iso(ring_at))
        db.add(call)
        db.commit()
        return call.id


def settings_row(**fields) -> ProtectionSettings:
    return ProtectionSettings(family_id="fam_x", **{**protection.DEFAULTS, **fields})


def in_window(moment: datetime, start: int = 10, end: int = 19, zone=VILNIUS) -> bool:
    local = moment.astimezone(zone)
    minutes = local.hour * 60 + local.minute
    return start * 60 <= minutes < end * 60


@pytest.fixture
def fresh_pass_state():
    protection._pass = None
    protection._last_pass_at = None
    yield
    protection._pass = None
    protection._last_pass_at = None


# ---------------------------------------------------------------- settings


def test_protection_defaults(client, make_family):
    family = make_family()
    sara, jon = ids(family)
    body = client.get(f"/api/families/{family['family_id']}/protection").json()
    assert {key: body[key] for key in ("enabled", "drills_per_week", "window_start_hour", "window_end_hour",
                                       "timezone", "shield_enabled", "updated_at")} == {
        "enabled": False, "drills_per_week": 2, "window_start_hour": 10, "window_end_hour": 19,
        "timezone": "Europe/Vilnius", "shield_enabled": True, "updated_at": None}
    assert body["members"] == [
        {"member_id": sara, "name": "Sara", "eligible": True, "reason_if_not": None, "paused": False,
         "next_drill_at": None, "drills_last_7_days": 0},
        {"member_id": jon, "name": "Jon", "eligible": True, "reason_if_not": None, "paused": False,
         "next_drill_at": None, "drills_last_7_days": 0},
    ]
    assert client.get("/api/families/fam_nobody/protection").status_code == 404


def test_put_protection_changes_only_the_given_fields(client, make_family):
    family_id = make_family()["family_id"]
    body = enable(client, family_id, drills_per_week=4, window_start_hour=9, window_end_hour=21)
    assert (body["enabled"], body["drills_per_week"], body["window_start_hour"], body["window_end_hour"]) == (
        True, 4, 9, 21)
    assert body["updated_at"] is not None
    body = client.put(f"/api/families/{family_id}/protection",
                      json={"drills_per_week": None, "shield_enabled": False, "timezone": "Europe/Berlin"}).json()
    assert (body["enabled"], body["drills_per_week"], body["shield_enabled"], body["timezone"]) == (
        True, 4, False, "Europe/Berlin")


@pytest.mark.parametrize("payload", [
    {"drills_per_week": 0}, {"drills_per_week": 8}, {"window_start_hour": 24}, {"window_end_hour": 0},
    {"window_start_hour": 19, "window_end_hour": 10}, {"window_start_hour": 12, "window_end_hour": 12},
    {"window_start_hour": 19}, {"timezone": "Mars/Olympus"},
])
def test_put_protection_rejects_bad_values(client, make_family, payload):
    family_id = make_family()["family_id"]
    response = client.put(f"/api/families/{family_id}/protection", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert client.get(f"/api/families/{family_id}/protection").json()["updated_at"] is None


def test_put_protection_unknown_family_is_404(client):
    assert client.put("/api/families/fam_nobody/protection", json={"enabled": True}).status_code == 404


def test_eligibility_reasons(client, make_family):
    family = make_family(members=4)
    sara, jon, ana, ben = ids(family)
    update_member(jon, consent_practice_at=None)
    update_member(ana, opted_out_at=now_iso())
    assert client.put(f"/api/members/{ben}/drills", json={"paused": True}).status_code == 200
    members = {m["member_id"]: m for m in client.get(f"/api/families/{family['family_id']}/protection").json()["members"]}
    assert (members[sara]["eligible"], members[sara]["reason_if_not"]) == (True, None)
    assert (members[jon]["eligible"], members[jon]["reason_if_not"]) == (False, "Has not agreed to practice calls.")
    assert (members[ana]["eligible"], members[ana]["reason_if_not"]) == (False, "Has left Callback.")
    assert (members[ben]["eligible"], members[ben]["reason_if_not"], members[ben]["paused"]) == (
        False, "Drills are paused.", True)


def test_no_usable_scenario_makes_a_member_ineligible(client, make_family, monkeypatch):
    family = make_family()
    sara, jon = ids(family)
    clone_only = [{"key": "relative_new_number", "voice": "clone", "allowed_tactics": ["urgency"]}]
    monkeypatch.setattr(protection.pipeline, "available_scenarios", lambda: clone_only)
    members = client.get(f"/api/families/{family['family_id']}/protection").json()["members"]
    assert members[0]["reason_if_not"] == "No practice scenario can be used yet."
    give_voice(jon)  # now Sara can hear Jon's clone
    members = client.get(f"/api/families/{family['family_id']}/protection").json()["members"]
    assert members[0]["eligible"] is True
    assert members[1]["eligible"] is False  # Sara has no voice for Jon's drill


def test_pause_and_resume(client, make_family):
    sara, _ = ids(make_family())
    body = client.put(f"/api/members/{sara}/drills", json={"paused": True}).json()
    assert (body["member_id"], body["paused"], body["eligible"]) == (sara, True, False)
    body = client.put(f"/api/members/{sara}/drills", json={"paused": False}).json()
    assert (body["paused"], body["eligible"]) == (False, True)
    with new_session() as db:
        assert db.get(MemberDrillSettings, sara).paused is False
    assert client.put("/api/members/mem_nobody/drills", json={"paused": True}).status_code == 404
    assert client.put(f"/api/members/{sara}/drills", json={}).status_code == 422


def test_drills_last_7_days_counts_rung_practices_only(client, make_family):
    family = make_family()
    sara, _ = ids(family)
    now = utcnow()
    add_rung_practice(family, sara, now - timedelta(days=1))
    add_rung_practice(family, sara, now - timedelta(days=6, hours=23))
    add_rung_practice(family, sara, now - timedelta(days=8))  # too old
    with new_session() as db:
        db.add(Call(id=new_call_id(), family_id=family["family_id"], kind="practice", target_member_id=sara,
                    status="scheduled", scheduled_for=to_iso(now + timedelta(hours=2)), created_at=now_iso()))
        db.add(Call(id=new_call_id(), family_id=family["family_id"], kind="welcome", target_member_id=sara,
                    status="scored", ring_at=to_iso(now - timedelta(hours=1)), created_at=now_iso()))
        db.commit()
        assert protection.drills_last_7_days(db, sara, now) == 2
    member = client.get(f"/api/families/{family['family_id']}/protection").json()["members"][0]
    assert member["drills_last_7_days"] == 2
    assert parse_time(member["next_drill_at"]) == now + timedelta(hours=2)


# ---------------------------------------------------------------- when a drill rings


@pytest.mark.parametrize("seed", range(40))
def test_drill_time_is_inside_the_window_and_the_horizon(seed):
    now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)  # 14:00 in Vilnius
    for per_week in (1, 2, 7):
        moment = protection.drill_time(now, settings_row(drills_per_week=per_week), random.Random(seed))
        assert in_window(moment)
        assert now + timedelta(minutes=10) <= moment <= now + timedelta(days=7 / per_week)


def test_drill_time_after_the_window_moves_to_the_next_day():
    now = datetime(2026, 11, 14, 18, 0, tzinfo=timezone.utc)  # 20:00 in Vilnius, after the window
    for seed in range(20):
        moment = protection.drill_time(now, settings_row(drills_per_week=7), random.Random(seed))
        assert moment.astimezone(VILNIUS).date() == datetime(2026, 11, 15).date()
        assert in_window(moment)


def test_drill_time_is_never_within_ten_minutes():
    now = datetime(2026, 11, 14, 7, 55, tzinfo=timezone.utc)  # 09:55 in Vilnius
    row = settings_row(drills_per_week=7, window_start_hour=10, window_end_hour=11)
    for seed in range(30):
        moment = protection.drill_time(now, row, random.Random(seed))
        assert moment >= now + timedelta(minutes=10)
        assert in_window(moment, 10, 11)


def test_drill_time_follows_the_family_time_zone():
    now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
    tokyo = ZoneInfo("Asia/Tokyo")
    for seed in range(20):
        moment = protection.drill_time(now, settings_row(timezone="Asia/Tokyo", window_start_hour=8,
                                                         window_end_hour=9, drills_per_week=1), random.Random(seed))
        assert in_window(moment, 8, 9, tokyo)


def test_drill_time_window_to_midnight():
    now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
    for seed in range(20):
        moment = protection.drill_time(now, settings_row(window_start_hour=23, window_end_hour=24),
                                       random.Random(seed))
        assert moment.astimezone(VILNIUS).hour == 23


# ---------------------------------------------------------------- the random drill pass


async def test_random_pass_schedules_one_drill_per_eligible_member(client, make_family):
    family = make_family()
    sara, jon = ids(family)
    give_voice(jon)
    enable(client, family["family_id"])
    now = utcnow()
    created = await protection.schedule_random_drills(now=now, rng=random.Random(3))
    assert len(created) == 2
    rows = {call.target_member_id: (call, drill) for call, drill in drill_calls()}
    sara_call, sara_drill = rows[sara]
    assert (sara_call.kind, sara_call.status, sara_call.scenario, sara_call.voice_member_id) == (
        "practice", "scheduled", "relative_new_number", jon)
    assert sara_drill.source == "random"
    jon_call, _ = rows[jon]  # Sara has no voice: a library scenario instead
    assert jon_call.scenario in ("bank_security", "police", "hospital") and jon_call.voice_member_id is None
    for call, _ in rows.values():
        moment = parse_time(call.scheduled_for)
        assert in_window(moment) and now + timedelta(minutes=10) <= moment <= now + timedelta(days=3.5)
        assert json.loads(call.brief_json)["target_name"] in ("Sara", "Jon")
    # A scheduled drill blocks the next one.
    assert await protection.schedule_random_drills(now=now, rng=random.Random(4)) == []
    members = client.get(f"/api/families/{family['family_id']}/protection").json()["members"]
    assert all(member["next_drill_at"] for member in members)


async def test_random_pass_leaves_families_without_drills_alone(client, make_family):
    family = make_family()
    assert await protection.schedule_random_drills(now=utcnow(), rng=random.Random(1)) == []
    enable(client, family["family_id"])
    client.put(f"/api/families/{family['family_id']}/protection", json={"enabled": False})
    assert await protection.schedule_random_drills(now=utcnow(), rng=random.Random(1)) == []


async def test_random_pass_skips_paused_and_unconsented_members(client, make_family):
    family = make_family(members=3)
    sara, jon, ana = ids(family)
    enable(client, family["family_id"])
    client.put(f"/api/members/{sara}/drills", json={"paused": True})
    update_member(jon, consent_practice_at=None)
    created = await protection.schedule_random_drills(now=utcnow(), rng=random.Random(1))
    assert [load_call(call_id).target_member_id for call_id in created] == [ana]


async def test_random_pass_stops_at_drills_per_week(client, make_family):
    family = make_family()
    sara, jon = ids(family)
    enable(client, family["family_id"], drills_per_week=2)
    client.put(f"/api/members/{jon}/drills", json={"paused": True})
    now = utcnow()
    add_rung_practice(family, sara, now - timedelta(days=1))
    add_rung_practice(family, sara, now - timedelta(days=2))
    assert await protection.schedule_random_drills(now=now, rng=random.Random(1)) == []
    # A week later the old ones no longer count.
    later = now + timedelta(days=6)
    created = await protection.schedule_random_drills(now=later, rng=random.Random(1))
    assert len(created) == 1
    assert parse_time(load_call(created[0]).scheduled_for) >= later + timedelta(minutes=10)


async def test_random_pass_uses_the_plan_step_and_marks_it_scheduled(client, make_family):
    family = make_family()
    sara, jon = ids(family)
    client.put(f"/api/members/{jon}/drills", json={"paused": True})
    plan = {"member_id": sara, "weak_spot": "authority", "this_week": "One call.",
            "steps": [{"when": "today", "scenario": "police", "difficulty": 2, "voice_of": None, "why": "x",
                       "status": "done"},
                      {"when": "tomorrow", "scenario": "hospital", "difficulty": 3, "voice_of": None, "why": "y"}]}
    update_member(sara, plan_json=json.dumps(plan))
    enable(client, family["family_id"])
    created = await protection.schedule_random_drills(now=utcnow(), rng=random.Random(1))
    call = load_call(created[0])
    assert (call.scenario, call.difficulty, call.voice_member_id) == ("hospital", 3, None)
    with new_session() as db:
        steps = json.loads(db.get(Member, sara).plan_json)["steps"]
    assert [step.get("status", "planned") for step in steps] == ["done", "scheduled"]


async def test_random_pass_keeps_the_daily_cap_and_never_raises(client, make_family, monkeypatch):
    family = make_family()
    sara, jon = ids(family)
    enable(client, family["family_id"])
    add_rung_practice(family, jon, utcnow())  # one call today
    monkeypatch.setenv("DAILY_CALL_LIMIT", "1")
    get_settings.cache_clear()
    assert await protection.schedule_random_drills(now=utcnow(), rng=random.Random(1)) == []
    assert drill_calls() == []


async def test_random_pass_survives_a_failing_member(client, make_family, monkeypatch):
    family = make_family()
    enable(client, family["family_id"])
    original = protection.choose_drill
    seen: list[str] = []

    def flaky(db, member, *args):
        seen.append(member.name)
        if member.name == "Sara":
            raise RuntimeError("boom")
        return original(db, member, *args)

    monkeypatch.setattr(protection, "choose_drill", flaky)
    created = await protection.schedule_random_drills(now=utcnow(), rng=random.Random(1))
    assert seen == ["Sara", "Jon"]
    assert [load_call(call_id).target_member_id for call_id in created] == [ids(family)[1]]


async def test_a_settings_change_cancels_pending_random_drills(client, make_family):
    family = make_family()
    enable(client, family["family_id"])
    first = await protection.schedule_random_drills(now=utcnow(), rng=random.Random(1))
    assert len(first) == 2
    client.put(f"/api/families/{family['family_id']}/protection", json={"enabled": True})  # no change
    assert {load_call(call_id).status for call_id in first} == {"scheduled"}
    client.put(f"/api/families/{family['family_id']}/protection", json={"window_end_hour": 20})
    assert {load_call(call_id).status for call_id in first} == {"failed"}
    second = await protection.schedule_random_drills(now=utcnow(), rng=random.Random(2))
    assert len(second) == 2
    for call_id in second:
        assert in_window(parse_time(load_call(call_id).scheduled_for), 10, 20)


async def test_pausing_cancels_the_members_pending_drills_only(client, make_family):
    family = make_family()
    sara, jon = ids(family)
    enable(client, family["family_id"])
    created = await protection.schedule_random_drills(now=utcnow(), rng=random.Random(1))
    by_member = {load_call(call_id).target_member_id: call_id for call_id in created}
    client.put(f"/api/members/{sara}/drills", json={"paused": True})
    assert load_call(by_member[sara]).status == "failed"
    assert load_call(by_member[jon]).status == "scheduled"


async def test_start_random_drills_runs_one_pass_at_a_time_about_once_a_minute(client, monkeypatch,
                                                                                fresh_pass_state):
    started: list[datetime] = []
    gate = asyncio.Event()

    async def fake_pass(now=None, rng=None):
        started.append(now)
        await gate.wait()
        return []

    monkeypatch.setattr(protection, "schedule_random_drills", fake_pass)
    now = utcnow()
    assert protection.start_random_drills(now) is True
    await asyncio.sleep(0)
    assert protection.start_random_drills(now + timedelta(seconds=120)) is False  # one still running
    gate.set()
    await asyncio.sleep(0.01)
    assert protection.start_random_drills(now + timedelta(seconds=30)) is False  # too soon
    assert protection.start_random_drills(now + timedelta(seconds=61)) is True
    await asyncio.sleep(0.01)
    assert len(started) == 2


async def test_start_random_drills_can_be_switched_off(client, monkeypatch, fresh_pass_state):
    monkeypatch.setenv("RANDOM_DRILLS_ENABLED", "false")
    get_settings.cache_clear()
    assert protection.start_random_drills(utcnow()) is False


async def test_the_scheduler_loop_calls_the_drill_hook(monkeypatch):
    calls_seen: list[datetime] = []
    monkeypatch.setattr(protection, "start_random_drills", lambda now: calls_seen.append(now) or False)

    async def stop(_seconds):
        raise asyncio.CancelledError

    monkeypatch.setattr(scheduler.asyncio, "sleep", stop)
    with pytest.raises(asyncio.CancelledError):
        await scheduler.run_forever()
    assert len(calls_seen) == 1


# ---------------------------------------------------------------- the surprise drill


async def test_surprise_drill_for_a_member(client, make_family):
    family = make_family()
    sara, jon = ids(family)
    give_voice(jon)
    before = utcnow()
    response = client.post(f"/api/families/{family['family_id']}/surprise-drill",
                           json={"member_id": sara, "within_seconds": 30})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["member"] == {"id": sara, "name": "Sara"}
    assert body["scenario"] == "relative_new_number"
    moment = parse_time(body["scheduled_for"])
    assert before + timedelta(seconds=protection.SURPRISE_MIN_SECONDS) <= moment <= utcnow() + timedelta(seconds=30)
    call = load_call(body["call_id"])
    assert (call.status, call.voice_member_id, call.kind) == ("scheduled", jon, "practice")
    assert drill_calls()[0][1].source == "surprise"
    # The scheduler rings it when due, with the phone page closed.
    with new_session() as db:
        await scheduler.tick(db, moment + timedelta(seconds=1))
    assert load_call(body["call_id"]).status == "ringing"


async def test_surprise_drill_picks_a_random_eligible_member(client, make_family):
    family = make_family(members=3)
    sara, jon, ana = ids(family)
    update_member(sara, consent_practice_at=None)
    client.put(f"/api/members/{jon}/drills", json={"paused": True})
    body = client.post(f"/api/families/{family['family_id']}/surprise-drill").json()
    assert body["member"]["id"] == ana
    assert body["scenario"] in schemas.SCENARIOS


def test_surprise_drill_with_nobody_eligible_is_409(client, make_family):
    family = make_family(consent=False)
    response = client.post(f"/api/families/{family['family_id']}/surprise-drill", json={})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "not_eligible"
    assert "Nobody in this family" in response.json()["error"]["message"]


def test_surprise_drill_for_an_ineligible_member_is_409(client, make_family):
    family = make_family()
    sara, _ = ids(family)
    client.put(f"/api/members/{sara}/drills", json={"paused": True})
    response = client.post(f"/api/families/{family['family_id']}/surprise-drill", json={"member_id": sara})
    assert response.status_code == 409
    assert response.json()["error"] == {"code": "not_eligible",
                                        "message": "Sara cannot get a drill now. Drills are paused."}


def test_surprise_drill_checks_its_input(client, make_family):
    family = make_family()
    other = make_family()
    url = f"/api/families/{family['family_id']}/surprise-drill"
    assert client.post(url, json={"member_id": ids(other)[0]}).status_code == 404
    assert client.post("/api/families/fam_nobody/surprise-drill", json={}).status_code == 404
    assert client.post(url, json={"within_seconds": 19}).status_code == 422
    assert client.post(url, json={"within_seconds": 301}).status_code == 422


def test_surprise_drill_for_a_busy_member_is_409_busy(client, make_family):
    family = make_family()
    sara, _ = ids(family)
    with new_session() as db:
        db.add(Call(id=new_call_id(), family_id=family["family_id"], kind="practice", target_member_id=sara,
                    status="in_progress", answered_at=now_iso(), created_at=now_iso()))
        db.commit()
    response = client.post(f"/api/families/{family['family_id']}/surprise-drill", json={"member_id": sara})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "busy"
