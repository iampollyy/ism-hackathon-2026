"""The live risk check on practice calls: when it runs, and where its results
go. The job itself (signals, level, fallback) is agents/risk.py.

start_check(call_id) is called by POST /api/calls/{id}/events (calls.py) when
a batch for a practice call holds a caller turn (speaker "agent"). It returns
at once; the check runs in the background (services.run_in_background):
- At most one check per call at a time. Caller turns that arrive meanwhile
  ask for one more run, which reads the latest transcript when the running
  check finishes (any number of batches meanwhile make one more run).
- A check reads the call's turns up to its first `outcome` event (after
  that the agent reveals, and there is nothing left to judge) and runs only
  if a caller line came after the last stored check.
- Its result is stored and published as a `risk` event (events.publish), so
  the laptop's live stream and GET /api/calls/{id} both carry it. The last
  stored `risk` event is what the next check builds on, so within a call the
  signals only grow and the level never goes down.
- Right after storing it, services/shield.on_risk alerts the family, once,
  if the call is a shield call and the event warns (track 3). Training
  drills never alert.

Welcome and family-line calls are never checked. Settings.risk_check_enabled
switches it off (the test suite does, except tests/test_risk.py).

Database rule: the events are read in a short session that is closed before
the model is awaited; publish opens its own (db.py, "Hard rule").
"""

import asyncio
import logging
from typing import Any

from app import events
from app.agents import risk
from app.config import get_settings
from app.db import new_session
from app.models import Call
from app.services import run_in_background, shield

log = logging.getLogger("app.live_risk")

# call_id -> its running check; the call ids whose turns arrived while it ran.
# Only touched from the event loop, between awaits, so no lock is needed.
_running: dict[str, asyncio.Task] = {}
_again: set[str] = set()


def start_check(call_id: str) -> bool:
    """Start the risk check for this practice call in the background, or, if
    one is running, ask it to run once more when it finishes. Returns True if
    a new check started. Call from inside the running event loop (a request
    handler). Never raises."""
    try:
        if not get_settings().risk_check_enabled:
            return False
        running = _running.get(call_id)
        if running is not None and not running.done():
            _again.add(call_id)
            return False
        _again.discard(call_id)
        _running[call_id] = run_in_background(_check_until_current(call_id), f"risk:{call_id}")
        return True
    except Exception:
        log.exception("could not start the risk check for %s", call_id)
        return False


def is_running(call_id: str) -> bool:
    running = _running.get(call_id)
    return running is not None and not running.done()


async def _check_until_current(call_id: str) -> None:
    """Check, then check once more while new caller turns came in meanwhile."""
    try:
        while True:
            _again.discard(call_id)
            await check_once(call_id)
            if call_id not in _again:
                return
    finally:
        if _running.get(call_id) is asyncio.current_task():
            del _running[call_id]


def turns_to_check(stored: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """From a call's stored events: its turns before the first `outcome`
    event, as [{speaker, text}] (a prefix of GET /api/calls/{id}'s turns, so
    the indexes match), and the last `risk` event's data, or None."""
    turns: list[dict[str, Any]] = []
    previous: dict[str, Any] | None = None
    decided = False
    for event in stored:
        data = event.get("data") or {}
        if event["type"] == "outcome":
            decided = True
        elif event["type"] == "turn" and not decided:
            if data.get("speaker") in ("agent", "user") and data.get("text"):
                turns.append({"speaker": data["speaker"], "text": data["text"]})
        elif event["type"] == "risk":
            previous = data
    return turns, previous


async def check_once(call_id: str) -> dict[str, Any] | None:
    """One check on the practice call's transcript so far. Stores and
    publishes a `risk` event and returns its data, or returns None when
    there is no new caller line to judge (or the call is not a practice).
    Never raises (cancellation still propagates)."""
    try:
        with new_session() as db:
            call = db.get(Call, call_id)
            if call is None or call.kind != "practice":
                return None
            stored = events.list_events(call_id, db=db)
        turns, previous = turns_to_check(stored)
        index = risk.caller_turn_index(turns)
        last_checked = (previous or {}).get("turn_index")
        if index is None or (isinstance(last_checked, int) and index <= last_checked):
            return None
        data = await risk.check_risk(turns, previous)
        stored = events.publish(call_id, "risk", data)["data"]
        shield.on_risk(call_id, stored)  # a shield call alerts the family once; never raises
        return stored
    except Exception:
        log.exception("the risk check for %s failed", call_id)
        return None
