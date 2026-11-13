"""The laptop's live stream for one call. OWNER: track B.

GET /api/calls/{id}/events: server-sent events. Replays stored events after
Last-Event-ID (or from the start), then sends live ones, forever:
- each event's `id` is its seq, `event` its type, `data` its JSON fields plus t;
- a comment line (events.SSE_KEEPALIVE) after 15 idle seconds;
- headers: text/event-stream, events.SSE_HEADERS;
- the subscriber is removed when the client goes away (aclosing).
404 not_found for an unknown call.
"""

from collections.abc import AsyncIterator
from contextlib import aclosing

from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse

from app import events
from app.db import new_session
from app.models import Call
from app.schemas import ApiError

router = APIRouter(tags=["streams"])

KEEPALIVE_SECONDS = 15.0


def parse_last_event_id(value: str | None) -> int:
    """The seq to resume after; 0 (replay everything) if missing or bad."""
    try:
        return max(0, int((value or "").strip()))
    except ValueError:
        return 0


async def event_stream(call_id: str, after_seq: int) -> AsyncIterator[str]:
    async with aclosing(events.subscribe(call_id, after_seq, KEEPALIVE_SECONDS)) as stream:
        async for event in stream:
            yield events.SSE_KEEPALIVE if event is None else events.sse_format(event)


@router.get("/calls/{call_id}/events")
async def stream_events(call_id: str, last_event_id: str | None = Header(default=None)) -> StreamingResponse:
    # A short session of our own: a request session would stay open for the
    # whole life of the stream.
    with new_session() as db:
        if db.get(Call, call_id) is None:
            raise ApiError(404, "not_found", "No call with this id.")
    return StreamingResponse(
        event_stream(call_id, parse_last_event_id(last_event_id)),
        media_type="text/event-stream",
        headers=events.SSE_HEADERS,
    )
