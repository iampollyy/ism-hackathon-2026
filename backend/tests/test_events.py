"""app/events.py: storing, numbering and fanning out call events."""

import asyncio
import threading
from contextlib import aclosing

from app import events
from app.db import new_session, now_iso
from app.ids import new_call_id
from app.models import Call


def make_call(make_family, answered: bool = True) -> str:
    family = make_family()
    with new_session() as db:
        call = Call(
            id=new_call_id(), family_id=family["family_id"], kind="practice",
            target_member_id=family["members"][0]["id"], status="in_progress",
            answered_at=now_iso() if answered else None, created_at=now_iso(),
        )
        db.add(call)
        db.commit()
        return call.id


def test_publish_numbers_events_and_stamps_t(client, make_family):
    call_id = make_call(make_family)
    first = events.publish(call_id, "turn", {"speaker": "agent", "text": "Hi"})
    second = events.publish(call_id, "tactic", {"key": "urgency", "label": "Urgency"})
    assert (first["seq"], second["seq"]) == (1, 2)
    assert first["t"] is not None and first["t"] >= 0
    assert second["data"] == {"key": "urgency", "label": "Urgency"}
    assert [e["seq"] for e in events.list_events(call_id)] == [1, 2]
    assert [e["seq"] for e in events.list_events(call_id, after_seq=1)] == [2]


def test_t_is_none_before_answer(client, make_family):
    call_id = make_call(make_family, answered=False)
    assert events.publish(call_id, "call.status", {"status": "ringing"})["t"] is None


def test_concurrent_publishes_get_distinct_seqs(client, make_family):
    call_id = make_call(make_family)
    threads = [threading.Thread(target=events.publish, args=(call_id, "turn", {"text": str(i)}))
               for i in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(e["seq"] for e in events.list_events(call_id)) == list(range(1, 21))


async def test_subscribe_replays_then_streams_live(client, make_family):
    call_id = make_call(make_family)
    events.publish(call_id, "call.status", {"status": "in_progress"})
    events.publish(call_id, "turn", {"speaker": "agent", "text": "Hi"})

    received: list[int] = []

    async def listen() -> None:
        async with aclosing(events.subscribe(call_id, after_seq=1)) as stream:
            async for event in stream:
                received.append(event["seq"])
                if len(received) == 3:
                    break

    task = asyncio.create_task(listen())
    await asyncio.sleep(0.05)
    events.publish(call_id, "tactic", {"key": "urgency"})
    # Published from another thread, as a sync endpoint would.
    await asyncio.to_thread(events.publish, call_id, "revealed", {})
    await asyncio.wait_for(task, timeout=2)
    assert received == [2, 3, 4]
    assert events.subscriber_count(call_id) == 0


async def test_subscribe_keepalive_yields_none(client, make_family):
    call_id = make_call(make_family)
    async with aclosing(events.subscribe(call_id, keepalive_seconds=0.05)) as stream:
        async for event in stream:
            assert event is None
            break
    assert events.subscriber_count(call_id) == 0


def test_sse_format():
    text = events.sse_format({"seq": 4, "type": "tactic", "t": 1.5, "data": {"key": "urgency"}})
    assert text == 'id: 4\nevent: tactic\ndata: {"key": "urgency", "t": 1.5}\n\n'
