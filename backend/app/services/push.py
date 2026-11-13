"""Web Push (VAPID): wake a member's phone when a call rings for them or a
message is written for them, even while their phone page is closed.

Push is only a wake-up. The phone page still polls phone-state; a push shows
a notification whose tap opens the page, and the page then polls as before.

When (SQLAlchemy session events, so every writer is covered without a call
of its own):
- after_flush notes each welcome or practice call that became ringing (the
  welcome call, calls.create_practice, the scheduler) and each new message
  row (the family number's callback_notice, the weekly run's messages);
- after_commit hands them to deliver() in the background; a rollback drops
  them. So a push goes out once phone-state can see the row, never before.
While push is off (a VAPID key is empty) nothing is noted.

deliver() runs on a small thread pool, because pywebpush blocks and commits
happen both on the event loop and off it. It re-reads what phone-state would
show (incoming_call, or the message while unread), skips a member who has
opted out, POSTs one push to each of the member's subscriptions with no
database session open, then records each answer in one short commit:
2xx sets last_success_at and resets failure_count; 404 or 410 (the browser
unsubscribed) deletes the subscription; anything else, or no answer, adds
one to failure_count. Nothing here raises into the request that caused it.

The payload carries no more than the phone page shows: for a call, the
caller label and number of the ringing screen; never the call's kind or
scenario. FAKE_ELEVENLABS does not turn push off.

Tests replace send() (the only network call) and start_in_background().
"""

import json
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from pywebpush import WebPushException, webpush
from sqlalchemy import event, select
from sqlalchemy.orm import Session, attributes

from app import schemas
from app.config import DEFAULT_VAPID_SUBJECT, get_settings
from app.db import new_session, now_iso
from app.models import Call, Member, Message, PushSubscription
from app.routers.families import phone_link
from app.routers.phone import RINGING_KINDS, incoming_call
from app.services.scheduler import RING_SECONDS

log = logging.getLogger("app.push")

CALL_TTL_SECONDS = RING_SECONDS  # a ring nobody saw in time is missed anyway
MESSAGE_TTL_SECONDS = 24 * 3600
SEND_TIMEOUT_SECONDS = 10
GONE_STATUSES = (404, 410)
BODY_MAX_CHARS = 180
MESSAGE_TITLES = {"callback_notice": "Family number", "weekly": "This week", "reminder": "Reminder"}

_NOTED = "push_wake_ups"  # session.info key: {(what, member_id, ref): None}, in order
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="push")


# ---------------------------------------------------------------- the network call


def send(subscription: dict[str, Any], payload: dict[str, Any], ttl: int, urgency: str) -> int:
    """POST one push with pywebpush; returns the push service's status code.
    Raises on a network error. The only network call here: tests replace it."""
    settings = get_settings()
    try:
        response = webpush(
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            # a new dict every time: webpush writes this endpoint's aud into it
            vapid_claims={"sub": settings.vapid_subject or DEFAULT_VAPID_SUBJECT},
            ttl=ttl,
            headers={"Urgency": urgency},
            timeout=SEND_TIMEOUT_SECONDS,
        )
    except WebPushException as error:
        if error.status_code is None:
            raise
        return error.status_code
    return response.status_code


# ---------------------------------------------------------------- payloads


def short(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= BODY_MAX_CHARS else text[:BODY_MAX_CHARS - 1].rstrip() + "…"


def call_payload(member_id: str, incoming: schemas.IncomingCall) -> dict[str, Any]:
    """The ringing screen's caller, nothing more (no kind, no scenario)."""
    return {
        "type": "incoming_call",
        "call_id": incoming.call_id,
        "title": incoming.caller.label,
        "body": f"Incoming call · {incoming.caller.number}",
        "url": phone_link(member_id),
        "tag": incoming.call_id,
    }


def message_payload(member_id: str, message: Message) -> dict[str, Any]:
    return {
        "type": "message",
        "message_id": message.id,
        "kind": message.kind,
        "title": MESSAGE_TITLES.get(message.kind, "Callback"),
        "body": short(message.text),
        "url": phone_link(member_id),
        "tag": f"message_{message.id}",
    }


def build_payload(db: Session, what: str, member_id: str, ref: Any) -> dict[str, Any] | None:
    """What phone-state shows for this wake-up now, or None if it is gone
    (the call stopped ringing, the message was read or rolled back)."""
    if what == "call":
        incoming = incoming_call(db, member_id)
        return call_payload(member_id, incoming) if incoming and incoming.call_id == ref else None
    message = db.get(Message, ref)
    if message is None or message.member_id != member_id or message.read_at is not None:
        return None
    return message_payload(member_id, message)


# ---------------------------------------------------------------- delivery


def subscription_info(row: PushSubscription) -> dict[str, Any]:
    return {"endpoint": row.endpoint, "keys": {"p256dh": row.p256dh, "auth": row.auth}}


def is_success(status: int | None) -> bool:
    return status is not None and 200 <= status < 300


def record(statuses: dict[int, int | None]) -> None:
    """Write what each push service answered, in one commit."""
    now = now_iso()
    with new_session() as db:
        for subscription_id, status in statuses.items():
            row = db.get(PushSubscription, subscription_id)
            if row is None:
                continue
            if status in GONE_STATUSES:
                db.delete(row)
            elif is_success(status):
                row.last_success_at = now
                row.failure_count = 0
            else:
                row.failure_count += 1
        db.commit()


def deliver(what: str, member_id: str, ref: Any) -> int:
    """Send one wake-up ("call" with a call id, or "message" with a message
    id) to every subscription of the member. Returns how many the push
    services took. Blocking: run it with start_in_background()."""
    with new_session() as db:  # reads only, closed before any network call
        member = db.get(Member, member_id)
        if member is None or member.opted_out_at is not None:
            return 0
        payload = build_payload(db, what, member_id, ref)
        if payload is None:
            return 0
        targets = [(row.id, subscription_info(row)) for row in db.scalars(
            select(PushSubscription).where(PushSubscription.member_id == member_id).order_by(PushSubscription.id))]
    if not targets:
        return 0
    ttl, urgency = (CALL_TTL_SECONDS, "high") if what == "call" else (MESSAGE_TTL_SECONDS, "normal")
    statuses: dict[int, int | None] = {}
    for subscription_id, info in targets:
        try:
            statuses[subscription_id] = send(info, payload, ttl, urgency)
        except Exception as error:  # the endpoint is a secret of sorts: log the row id only
            log.warning("push to subscription %s failed: %s", subscription_id, type(error).__name__)
            statuses[subscription_id] = None
        if not is_success(statuses[subscription_id]):
            log.info("push to subscription %s answered %s", subscription_id, statuses[subscription_id])
    record(statuses)
    return sum(1 for status in statuses.values() if is_success(status))


def _run_logged(job: Callable[..., Any], *args: Any) -> None:
    try:
        job(*args)
    except Exception:
        log.exception("push job failed")


def start_in_background(job: Callable[..., Any], *args: Any) -> None:
    """Run job(*args) on the push threads; the caller never waits for it.
    Tests replace this to run jobs at once."""
    _pool.submit(_run_logged, job, *args)


# ---------------------------------------------------------------- the hooks


def became_ringing(call: Call, is_new: bool) -> bool:
    if call.kind not in RINGING_KINDS or call.status != "ringing":
        return False
    return is_new or attributes.get_history(call, "status").has_changes()


@event.listens_for(Session, "after_flush")
def note_wake_ups(session: Session, _flush_context: Any) -> None:
    """Note the ringing calls and new messages this flush wrote."""
    if not get_settings().push_enabled:
        return
    noted: dict[tuple[str, str, Any], None] = session.info.setdefault(_NOTED, {})
    for obj in session.new:
        if isinstance(obj, Message):
            noted[("message", obj.member_id, obj.id)] = None
        elif isinstance(obj, Call) and became_ringing(obj, is_new=True):
            noted[("call", obj.target_member_id, obj.id)] = None
    for obj in session.dirty:
        if isinstance(obj, Call) and became_ringing(obj, is_new=False):
            noted[("call", obj.target_member_id, obj.id)] = None


@event.listens_for(Session, "after_commit")
def send_wake_ups(session: Session) -> None:
    """The rows are committed: start one delivery per wake-up noted."""
    for what, member_id, ref in session.info.pop(_NOTED, None) or ():
        try:
            start_in_background(deliver, what, member_id, ref)
        except Exception:
            log.exception("could not start a push for %s", member_id)


@event.listens_for(Session, "after_transaction_end")
def forget_wake_ups(session: Session, transaction: Any) -> None:
    """A rollback or a close without commit: what was noted never happened."""
    if transaction.parent is None:
        session.info.pop(_NOTED, None)
