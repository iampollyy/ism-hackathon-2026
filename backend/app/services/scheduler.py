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
    - scheduled calls with scheduled_for <= now become ringing (ring_at=now);
    - ringing calls with ring_at more than 45 s ago become missed;
    - in_progress calls answered more than schemas.MAX_SECONDS[kind] + 30 s
      ago become ended with ended_by timeout, and the after-call work starts.
    Publish call.status for each change. OWNER: track B."""
    raise NotImplementedError
