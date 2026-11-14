"""The event broker: one channel per call, stored first, then fanned out.

An event, as returned by publish(), list_events() and subscribe():

    {"call_id": "call_...", "seq": 3, "type": "tactic", "t": 12.4,
     "data": {"key": "urgency", "label": "Urgency"}, "created_at": "2026-...Z"}

- `seq` is 1, 2, 3 within the call, and is the stream's event id.
- `t` is seconds since the call's answered_at, stamped by the server, or None
  before the call was answered.
- `data` holds the event's own fields (not seq or t).

One process only: do not run uvicorn with several workers.
"""

import asyncio
import json
import threading
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import new_session, now_iso, seconds_between
from app.models import Call, CallEvent

# call_id -> set of (loop, queue) pairs, one per open subscriber
_subscribers: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
_subscribers_lock = threading.Lock()
# Serialises seq allocation and fan-out, so two publishes at once never take
# the same seq and go out in seq order.
_seq_lock = threading.Lock()


def _row_to_event(row: CallEvent) -> dict[str, Any]:
    return {
        "call_id": row.call_id,
        "seq": row.seq,
        "type": row.type,
        "t": row.t,
        "data": json.loads(row.data_json),
        "created_at": row.created_at,
    }


def _insert_event(db: Session, call_id: str, type: str, data: dict[str, Any]) -> CallEvent:
    call = db.get(Call, call_id)
    if call is None:
        raise ValueError(f"unknown call {call_id}")
    created_at = now_iso()
    last_seq = db.scalar(select(func.max(CallEvent.seq)).where(CallEvent.call_id == call_id))
    row = CallEvent(
        call_id=call_id,
        seq=(last_seq or 0) + 1,
        type=type,
        t=seconds_between(call.answered_at, created_at),
        data_json=json.dumps(data),
        created_at=created_at,
    )
    db.add(row)
    db.commit()
    return row


def _store(call_id: str, type: str, data: dict[str, Any], db: Session | None) -> dict[str, Any]:
    """Insert and commit one event. Call with _seq_lock held.

    No retry: inside this one process _seq_lock already serialises seq
    allocation, so an IntegrityError means the caller's own pending writes
    are bad. It is raised as is, and rolling back is the caller's job.
    """
    if db is not None:
        return _row_to_event(_insert_event(db, call_id, type, data))
    with new_session() as own_db:
        return _row_to_event(_insert_event(own_db, call_id, type, data))


def _fan_out(event: dict[str, Any]) -> None:
    with _subscribers_lock:
        targets = list(_subscribers.get(event["call_id"], ()))
    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None
    for loop, queue in targets:
        if loop is current_loop:
            queue.put_nowait(event)
        elif not loop.is_closed():
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:
                pass  # that loop closed just now; its subscriber is gone


def publish(call_id: str, type: str, data: dict[str, Any] | None = None,
            db: Session | None = None) -> dict[str, Any]:
    """Store one event for a call (next seq, server-stamped t) and send it to
    every open subscriber. Returns the event dict.

    `db`: pass your request's session if it has uncommitted writes; publish
    then uses it and COMMITS it. Without `db`, publish opens its own short
    session, so commit your own changes first (SQLite allows one writer).
    If that commit fails (your own writes were bad), the error is raised and
    nothing is stored or sent; roll your session back yourself.
    """
    with _seq_lock:
        event = _store(call_id, type, dict(data or {}), db)
        _fan_out(event)  # inside the lock, so events go out in seq order
    return event


def list_events(call_id: str, after_seq: int = 0, db: Session | None = None) -> list[dict[str, Any]]:
    """The call's stored events with seq > after_seq, in order."""
    query = (
        select(CallEvent)
        .where(CallEvent.call_id == call_id, CallEvent.seq > after_seq)
        .order_by(CallEvent.seq)
    )
    if db is not None:
        return [_row_to_event(row) for row in db.scalars(query)]
    with new_session() as own_db:
        return [_row_to_event(row) for row in own_db.scalars(query)]


def _add_subscriber(call_id: str) -> tuple[asyncio.AbstractEventLoop, asyncio.Queue]:
    entry = (asyncio.get_running_loop(), asyncio.Queue())
    with _subscribers_lock:
        _subscribers.setdefault(call_id, set()).add(entry)
    return entry


def _remove_subscriber(call_id: str, entry: tuple[asyncio.AbstractEventLoop, asyncio.Queue]) -> None:
    with _subscribers_lock:
        entries = _subscribers.get(call_id)
        if entries is not None:
            entries.discard(entry)
            if not entries:
                del _subscribers[call_id]


def _in_order(call_id: str, last_seq: int, event: dict[str, Any]) -> list[dict[str, Any]]:
    """The events to send after last_seq, given a live event that just came in.

    An event published from another thread can arrive before an earlier one.
    If there is a gap, read the stored events instead (every event is stored
    before it is sent), so nothing is skipped and the order holds.
    """
    if event["seq"] == last_seq + 1:
        return [event]
    return list_events(call_id, last_seq)


async def subscribe(call_id: str, after_seq: int = 0,
                    keepalive_seconds: float | None = None) -> AsyncIterator[dict[str, Any] | None]:
    """Yield the call's stored events after after_seq, then live ones, forever.

    With keepalive_seconds, yields None after that many idle seconds, so a
    stream can send a comment line. Wrap it in contextlib.aclosing() so the
    subscriber is removed as soon as you stop:

        async with aclosing(events.subscribe(call_id, after_seq, 15)) as stream:
            async for event in stream:
                ...
    """
    entry = _add_subscriber(call_id)  # before the replay, so nothing is missed
    last_seq = after_seq
    try:
        for event in list_events(call_id, after_seq):
            last_seq = event["seq"]
            yield event
        queue = entry[1]
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=keepalive_seconds)
            except asyncio.TimeoutError:
                yield None
                continue
            if event["seq"] <= last_seq:
                continue  # already sent
            for item in _in_order(call_id, last_seq, event):
                last_seq = item["seq"]
                yield item
    finally:
        _remove_subscriber(call_id, entry)


def subscriber_count(call_id: str) -> int:
    with _subscribers_lock:
        return len(_subscribers.get(call_id, ()))


def sse_format(event: dict[str, Any]) -> str:
    """One server-sent event: id is seq, event is the type, data is the
    event's fields plus t."""
    payload = {**event["data"], "t": event["t"]}
    return f"id: {event['seq']}\nevent: {event['type']}\ndata: {json.dumps(payload)}\n\n"


SSE_KEEPALIVE = ": keep-alive\n\n"
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
