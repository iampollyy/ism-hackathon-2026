"""The landing page's sign-ups (Saturday): families who want early access
and banks who want to talk. Not in backend.md; see docs/full-app/waitlist.md.

- One row per email and kind; signing up again updates it and answers the
  same, so the page never reveals whether an email is already listed.
- At most 500 new rows a day, so an open form cannot flood the database.
- The count is public (for "N families on the list"); the emails are not
  readable through the API.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import get_db, now_iso
from app.models import WaitlistEntry
from app.services.limits import start_of_day

router = APIRouter(tags=["waitlist"])

DAILY_NEW_ROWS = 500


@router.post("/waitlist", response_model=schemas.Ok)
async def join_waitlist(body: schemas.WaitlistIn, db: DbSession = Depends(get_db)) -> schemas.Ok:
    email = body.email.strip().lower()
    row = db.scalar(select(WaitlistEntry).where(WaitlistEntry.email == email, WaitlistEntry.kind == body.kind))
    if row is None:
        today = db.scalar(select(func.count()).select_from(WaitlistEntry).where(WaitlistEntry.created_at >= start_of_day()))
        if (today or 0) >= DAILY_NEW_ROWS:
            raise schemas.ApiError(429, "daily_limit", "The list is full for today. Please try again tomorrow.")
        row = WaitlistEntry(email=email, kind=body.kind, created_at=now_iso())
        db.add(row)
    row.organisation = (body.organisation or "").strip() or row.organisation
    row.message = (body.message or "").strip() or row.message
    row.source = (body.source or "").strip() or row.source
    db.commit()
    return schemas.Ok()


@router.get("/waitlist/count", response_model=schemas.WaitlistCount)
async def waitlist_count(db: DbSession = Depends(get_db)) -> schemas.WaitlistCount:
    def count(kind: str) -> int:
        return int(db.scalar(select(func.count()).select_from(WaitlistEntry).where(WaitlistEntry.kind == kind)) or 0)
    return schemas.WaitlistCount(families=count("family"), banks=count("bank"))
