"""The laptop's live stream for one call. OWNER: track B.

GET /api/calls/{id}/events: server-sent events. Replay stored events from
Last-Event-ID (or from the start), then live ones, using
events.subscribe(call_id, after_seq, keepalive_seconds=15) and
events.sse_format(event); send events.SSE_KEEPALIVE when it yields None.
Headers: events.SSE_HEADERS, media type text/event-stream.
404 not_found for an unknown call.
"""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.events import SSE_HEADERS

router = APIRouter(tags=["streams"])

SAMPLE_EVENTS = [
    (1, "call.status", {"status": "ringing"}, None),
    (2, "call.status", {"status": "in_progress"}, 0.0),
    (3, "turn", {"speaker": "agent", "text": "Mum? It's me. I dropped my phone, so this is a new number."}, 1.2),
    (4, "tactic", {"key": "new_number", "label": "New number"}, 1.2),
    (5, "turn", {"speaker": "user", "text": "Jon? What's our family word?"}, 9.8),
    (6, "outcome", {"outcome": "asked_safe_word", "seconds_to_challenge": 9.8}, 9.8),
    (7, "revealed", {}, 20.5),
    (8, "call.status", {"status": "ended"}, 41.0),
]


@router.get("/calls/{call_id}/events")
async def stream_events(call_id: str) -> StreamingResponse:
    # STUB (track B): replace. This sample replays fixed events and closes.
    async def sample() -> AsyncIterator[str]:
        for seq, kind, data, t in SAMPLE_EVENTS:
            yield f"id: {seq}\nevent: {kind}\ndata: {json.dumps({**data, 't': t})}\n\n"

    return StreamingResponse(sample(), media_type="text/event-stream", headers=SSE_HEADERS)
