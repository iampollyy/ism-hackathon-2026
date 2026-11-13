"""The background loop that rings due calls and ends stale ones. OWNER: track B.

Every two seconds (backend.md, "Live updates inside the back end"):
- scheduled calls that are due become ringing (a practice re-runs the gate
  first: busy waits for the next pass, any other failure makes it failed);
- calls ringing for more than 45 seconds become missed;
- calls in progress for more than schemas.MAX_SECONDS[kind] + 30 seconds
  become ended with ended_by timeout, and the after-call work starts.
Each change publishes call.status. A failure on one call is logged and the
pass moves on; a failing pass is logged and the loop goes on.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import new_session, parse_time, to_iso, utcnow
from app.models import Call
from app.routers import calls

log = logging.getLogger("app.scheduler")

TICK_SECONDS = 2.0
RING_SECONDS = 45
END_GRACE_SECONDS = 30


async def run_forever() -> None:
    """Every two seconds, with a fresh db.new_session(), call tick(db, now).
    Errors are caught and logged inside the loop so one bad tick never stops
    it. Started by main.py's lifespan when settings.scheduler_enabled.
    OWNER: track B."""
    while True:
        try:
            with new_session() as db:
                await tick(db, utcnow())
        except Exception:  # CancelledError is not an Exception, so cancelling still stops the loop

            log.exception("scheduler pass failed; trying again in %s seconds", TICK_SECONDS)
        await asyncio.sleep(TICK_SECONDS)


def calls_with_status(db: DbSession, status: str) -> list[Call]:
    return list(db.scalars(select(Call).where(Call.status == status).order_by(Call.created_at)))


def seconds_since(value: str | None, now: datetime) -> float | None:
    moment = parse_time(value)
    return None if moment is None else (now - moment).total_seconds()


def ring_if_due(db: DbSession, call: Call, now: datetime) -> None:
    due = parse_time(call.scheduled_for)
    if due is not None and due > now:
        return
    if call.kind == "practice":
        try:
            calls.check_practice_gate(db, call.target_member_id, call.voice_member_id,
                                      check_phone_online=False)
        except schemas.ApiError as error:
            if error.code == "busy":
                return  # try again on the next pass
            log.info("scheduled call %s cannot ring (%s); marking it failed", call.id, error.code)
            calls.change_status(db, call, "failed", ended_at=to_iso(now))
            return
    calls.change_status(db, call, "ringing", ring_at=to_iso(now))


def miss_if_unanswered(db: DbSession, call: Call, now: datetime) -> None:
    ringing_for = seconds_since(call.ring_at or call.created_at, now)
    if ringing_for is not None and ringing_for > RING_SECONDS:
        calls.change_status(db, call, "missed", ended_at=to_iso(now))


def end_if_overdue(db: DbSession, call: Call, now: datetime) -> None:
    running_for = seconds_since(call.answered_at or call.created_at, now)
    limit = schemas.MAX_SECONDS.get(call.kind, schemas.MAX_SECONDS["practice"]) + END_GRACE_SECONDS
    if running_for is not None and running_for > limit:
        calls.change_status(db, call, "ended", ended_at=to_iso(now), ended_by="timeout")
        calls.start_after_call(call.id)


def run_step(db: DbSession, call: Call, step: Callable[[DbSession, Call, datetime], None],
             now: datetime) -> None:
    """One call's update; a failure is logged and rolled back, and the pass goes on."""
    try:
        step(db, call, now)
    except Exception:
        log.exception("scheduler could not update call %s", call.id)
        db.rollback()


async def tick(db: DbSession, now: datetime) -> None:
    """One pass:
    - scheduled calls with scheduled_for <= now: first re-run the gate with
      calls.check_practice_gate(db, call.target_member_id,
      call.voice_member_id, check_phone_online=False), since consent, the
      voice or the target's other calls may have changed since it was
      scheduled. ApiError "busy": leave it scheduled (try again next tick).
      Any other ApiError: status failed. Otherwise ringing (ring_at=now);
    - ringing calls with ring_at more than 45 s ago become missed;
    - in_progress calls answered more than schemas.MAX_SECONDS[kind] + 30 s
      ago become ended with ended_by timeout, and the after-call work starts.
    Publish call.status for each change. Every change is committed at once
    (change_status), and nothing here awaits. OWNER: track B."""
    for call in calls_with_status(db, "scheduled"):
        run_step(db, call, ring_if_due, now)
    for call in calls_with_status(db, "ringing"):
        run_step(db, call, miss_if_unanswered, now)
    for call in calls_with_status(db, "in_progress"):
        run_step(db, call, end_if_overdue, now)
