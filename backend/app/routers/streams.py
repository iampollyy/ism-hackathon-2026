"""The laptop's live stream for one call. OWNER: track B.

GET /api/calls/{id}/events: server-sent events. Replays stored events after
Last-Event-ID (or from the start), then sends live ones:
- each event's `id` is its seq, `event` its type, `data` its JSON fields plus t;
- a comment line (events.SSE_KEEPALIVE) after 15 idle seconds;
- headers: text/event-stream, events.SSE_HEADERS;
- the subscriber is removed when the client goes away (aclosing).
404 not_found for an unknown call.

The stream ends once the call is over (call_is_over), so finished calls do
not hold connections open (a browser allows six per origin over HTTP/1.1,
and uvicorn waits for open streams before it stops or reloads). A browser's
EventSource then reconnects with Last-Event-ID; when the call is over and
nothing new is stored, the answer is 204, which tells it to stop.
"""

from collections.abc import AsyncIterator
from contextlib import aclosing

from fastapi import APIRouter, Header, Response
from fastapi.responses import StreamingResponse

from app import events
from app.db import new_session, parse_time, utcnow
from app.models import Call
from app.schemas import ApiError

router = APIRouter(tags=["streams"])

KEEPALIVE_SECONDS = 15.0
FINAL_STATUSES = ("failed", "missed", "declined")
# The family number can be tapped this long after a practice ends, which
# publishes callback.connected on the practice's stream (phone.py).
CALLBACK_WINDOW_SECONDS = 600
# After these events (and after each keep-alive) the stream checks whether the call is over.
CHECK_AFTER = ("call.status", "result", "callback.connected")


def parse_last_event_id(value: str | None) -> int:
    """The seq to resume after; 0 (replay everything) if missing or bad."""
    try:
        return max(0, int((value or "").strip()))
    except ValueError:
        return 0


def call_is_over(call_id: str) -> bool:
    """True when no more events are worth waiting for: the call failed, was
    missed or declined, or it was scored and (for a practice) the family
    number was tapped or its ten minutes have passed."""
    with new_session() as db:
        call = db.get(Call, call_id)
        if call is None or call.status in FINAL_STATUSES:
            return True
        if call.status != "scored":
            return False
        if call.kind != "practice" or call.callback_seconds is not None:
            return True
        ended = parse_time(call.ended_at)
        return ended is None or (utcnow() - ended).total_seconds() > CALLBACK_WINDOW_SECONDS


def should_check(event: dict | None, replay_until: int) -> bool:
    """Check whether the call is over after a keep-alive, or after one of
    CHECK_AFTER once the replay is done (the whole replay is always sent)."""
    if event is None:
        return True
    return event["seq"] >= replay_until and event["type"] in CHECK_AFTER


async def event_stream(call_id: str, after_seq: int, replay_until: int = 0) -> AsyncIterator[str]:
    """replay_until: the last stored seq when the stream opened."""
    async with aclosing(events.subscribe(call_id, after_seq, KEEPALIVE_SECONDS)) as stream:
        async for event in stream:
            yield events.SSE_KEEPALIVE if event is None else events.sse_format(event)
            if should_check(event, replay_until) and call_is_over(call_id):
                return


@router.get("/calls/{call_id}/events", response_model=None)
async def stream_events(call_id: str,
                        last_event_id: str | None = Header(default=None)) -> StreamingResponse | Response:
    after_seq = parse_last_event_id(last_event_id)
    # A short session of our own: a request session would stay open for the
    # whole life of the stream.
    with new_session() as db:
        if db.get(Call, call_id) is None:
            raise ApiError(404, "not_found", "No call with this id.")
    stored = events.list_events(call_id, after_seq)
    if call_is_over(call_id) and not stored:
        return Response(status_code=204)  # nothing more will come: EventSource stops reconnecting
    replay_until = stored[-1]["seq"] if stored else after_seq
    return StreamingResponse(
        event_stream(call_id, after_seq, replay_until),
        media_type="text/event-stream",
        headers=events.SSE_HEADERS,
    )
