"""Track B tests: the scheduler's rules, one pass at a time. OWNER: track B."""

import asyncio
from datetime import timedelta

import pytest

from app import events, schemas
from app.db import new_session, now_iso, to_iso, utcnow
from app.ids import new_call_id
from app.models import Call, Member
from app.routers import calls
from app.services import pipeline, scheduler


@pytest.fixture
def started(monkeypatch) -> list[str]:
    """Fakes pipeline.after_call; returns the call ids it was started for."""
    ids: list[str] = []

    def fake_after_call(call_id):
        ids.append(call_id)

        async def nothing() -> None:
            return None

        return nothing()

    monkeypatch.setattr(pipeline, "after_call", fake_after_call)
    return ids


def add_call(family, status: str, kind: str = "practice", **fields) -> str:
    with new_session() as db:
        call = Call(id=new_call_id(), family_id=family["family_id"], kind=kind,
                    target_member_id=family["members"][0]["id"], status=status, difficulty=1,
                    created_at=now_iso(), **fields)
        db.add(call)
        db.commit()
        return call.id


def status_of(call_id: str) -> str:
    with new_session() as db:
        return db.get(Call, call_id).status


def statuses(call_id: str) -> list[str]:
    return [e["data"]["status"] for e in events.list_events(call_id) if e["type"] == "call.status"]


async def tick(seconds_from_now: float = 0) -> None:
    with new_session() as db:
        await scheduler.tick(db, utcnow() + timedelta(seconds=seconds_from_now))


def later(seconds: float) -> str:
    return to_iso(utcnow() + timedelta(seconds=seconds))


async def test_due_scheduled_call_rings(client, make_family, started):
    family = make_family()
    due = add_call(family, "scheduled", scheduled_for=later(60))
    await tick(30)
    assert status_of(due) == "scheduled"
    await tick(61)
    assert status_of(due) == "ringing"
    assert statuses(due) == ["ringing"]


async def test_due_call_waits_while_the_target_is_busy(client, make_family, started):
    family = make_family()
    due = add_call(family, "scheduled", scheduled_for=later(-1))
    other = add_call(family, "in_progress", answered_at=now_iso())
    await tick()
    assert status_of(due) == "scheduled"
    with new_session() as db:
        db.get(Call, other).status = "ended"
        db.commit()
    await tick()
    assert status_of(due) == "ringing"


async def test_due_call_fails_when_consent_is_gone(client, make_family, started):
    family = make_family()
    due = add_call(family, "scheduled", scheduled_for=later(-1))
    with new_session() as db:
        db.get(Member, family["members"][0]["id"]).opted_out_at = now_iso()
        db.commit()
    await tick()
    assert status_of(due) == "failed"
    assert statuses(due) == ["failed"]


async def test_ringing_call_is_missed_after_45_seconds(client, make_family, started):
    family = make_family()
    call_id = add_call(family, "ringing", ring_at=now_iso())
    await tick(44)
    assert status_of(call_id) == "ringing"
    await tick(46)
    assert status_of(call_id) == "missed"
    assert statuses(call_id) == ["missed"]


@pytest.mark.parametrize("kind", ["practice", "welcome", "family_line"])
async def test_long_call_ends_by_timeout_and_starts_the_pipeline(client, make_family, started, kind):
    family = make_family()
    call_id = add_call(family, "in_progress", kind=kind, answered_at=now_iso())
    limit = schemas.MAX_SECONDS[kind] + 30
    await tick(limit - 1)
    assert status_of(call_id) == "in_progress"
    await tick(limit + 1)
    with new_session() as db:
        call = db.get(Call, call_id)
        assert (call.status, call.ended_by) == ("ended", "timeout")
    assert statuses(call_id) == ["ended"]
    assert started == [call_id]


async def test_one_bad_call_does_not_stop_the_pass(client, make_family, started, monkeypatch):
    family = make_family()
    broken = add_call(family, "scheduled", scheduled_for=later(-1))
    ringing = add_call(family, "ringing", ring_at=later(-60))

    def explode(*args, **kwargs):
        raise RuntimeError("bad row")

    monkeypatch.setattr(calls, "check_practice_gate", explode)
    await tick()
    assert status_of(broken) == "scheduled"
    assert status_of(ringing) == "missed"


async def test_run_forever_survives_a_failing_pass(client, make_family, monkeypatch):
    passes: list[int] = []

    async def flaky_tick(db, now):
        passes.append(1)
        if len(passes) == 1:
            raise RuntimeError("one bad pass")

    monkeypatch.setattr(scheduler, "tick", flaky_tick)
    monkeypatch.setattr(scheduler, "TICK_SECONDS", 0.01)
    task = asyncio.create_task(scheduler.run_forever())
    await asyncio.sleep(0.2)
    assert not task.done()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(passes) >= 2


async def test_a_drill_waits_two_minutes_after_the_previous_call_ended(client, make_family, started):
    family = make_family()
    add_call(family, "scored", ended_at=later(-30))  # the reveal may still be on screen
    due = add_call(family, "scheduled", scheduled_for=later(-1))
    await tick()
    assert status_of(due) == "scheduled"
    await tick(scheduler.AFTER_CALL_QUIET_SECONDS)
    assert status_of(due) == "ringing"
