"""Web Push subscriptions for the phone pages. Sending is services/push.py.

- GET /api/push/public-key: {enabled, public_key}. While push is off (a
  VAPID key is empty) enabled is false and public_key null; the page then
  does not subscribe and simply polls.
- POST /api/members/{id}/push-subscription: the browser's
  PushSubscription.toJSON(). Upsert by endpoint: a browser that subscribes
  again, even for another member, updates its one row (new keys, failure
  count back to 0, now this member's). Answers {ok}.
- DELETE /api/members/{id}/push-subscription: {endpoint} (toJSON() is fine)
  removes that subscription of this member; no body removes all of the
  member's. Answers {ok}, also when there was nothing to remove.
Unknown member: 404 not_found. A bad subscription: 422 invalid_request.
"""

from fastapi import APIRouter, Body, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.config import get_settings
from app.db import get_db, now_iso
from app.models import PushSubscription
from app.routers.calls import get_member
from app.services import push  # noqa: F401  (registers the hooks that send)

router = APIRouter(tags=["push"])


@router.get("/push/public-key", response_model=schemas.PushPublicKey)
async def public_key() -> schemas.PushPublicKey:
    settings = get_settings()
    if not settings.push_enabled:
        return schemas.PushPublicKey(enabled=False, public_key=None)
    return schemas.PushPublicKey(enabled=True, public_key=settings.vapid_public_key)


@router.post("/members/{member_id}/push-subscription", response_model=schemas.Ok)
async def subscribe(member_id: str, body: schemas.PushSubscriptionIn,
                    db: DbSession = Depends(get_db)) -> schemas.Ok:
    member = get_member(db, member_id)
    row = db.scalars(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)).first()
    if row is None:
        db.add(PushSubscription(member_id=member.id, endpoint=body.endpoint, p256dh=body.keys.p256dh,
                                auth=body.keys.auth, created_at=now_iso(), failure_count=0))
    else:
        row.member_id, row.p256dh, row.auth, row.failure_count = member.id, body.keys.p256dh, body.keys.auth, 0
    db.commit()
    return schemas.Ok()


@router.delete("/members/{member_id}/push-subscription", response_model=schemas.Ok)
async def unsubscribe(member_id: str, body: schemas.PushSubscriptionRemove | None = Body(default=None),
                      db: DbSession = Depends(get_db)) -> schemas.Ok:
    member = get_member(db, member_id)
    query = delete(PushSubscription).where(PushSubscription.member_id == member.id)
    if body is not None:
        query = query.where(PushSubscription.endpoint == body.endpoint)
    db.execute(query)
    db.commit()
    return schemas.Ok()
