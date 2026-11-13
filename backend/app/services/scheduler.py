"""The background loop that rings due calls and ends stale ones. OWNER: track B."""

from datetime import datetime

from sqlalchemy.orm import Session as DbSession


async def run_forever() -> None:
    """Every two seconds, with a fresh db.new_session(), call tick(db, now).
    Catch and log errors inside the loop so one bad tick never stops it.
    Started by main.py's lifespan when settings.scheduler_enabled.
    OWNER: track B."""
    raise NotImplementedError


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
    Publish call.status for each change. Commit before any await; never
    hold uncommitted writes across an await (db.py, "Hard rule").
    OWNER: track B."""
    raise NotImplementedError
