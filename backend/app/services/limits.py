"""Daily caps for a public deployment, so an open address cannot spend the
ElevenLabs and model credit. Added after backend.md.

Each cap is a setting; 0 (the default, and in tests) means no cap. Days are
UTC days. Over a cap the answer is 429 `daily_limit`.
- daily_family_limit: families created (POST /api/families).
- daily_clone_limit: voice recordings sent for cloning (POST
  /api/members/{id}/voice), counted by the `clone` consent row each upload
  writes before it clones, so failed attempts count too.
- daily_call_limit: calls of every kind (practice, welcome, family line),
  counted by calls.created_at. The weekly run's practices count too.
"""

from datetime import datetime, time, timezone
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.config import get_settings
from app.db import to_iso, utcnow
from app.models import Call, Consent, Family

Kind = Literal["family", "clone", "call"]

WHAT = {"family": "new families", "clone": "voice clones", "call": "calls"}


def start_of_day() -> str:
    """Today's UTC midnight, in the stored ISO form."""
    today = utcnow().date()
    return to_iso(datetime.combine(today, time.min, tzinfo=timezone.utc))


def used_today(db: DbSession, kind: Kind) -> int:
    since = start_of_day()
    if kind == "family":
        query = select(func.count()).select_from(Family).where(Family.created_at >= since)
    elif kind == "clone":
        query = (select(func.count()).select_from(Consent)
                 .where(Consent.kind == "clone", Consent.created_at >= since))
    else:
        query = select(func.count()).select_from(Call).where(Call.created_at >= since)
    return int(db.scalar(query) or 0)


def check(db: DbSession, kind: Kind) -> None:
    """Raise 429 daily_limit if today's cap for this kind is reached."""
    limit = int(getattr(get_settings(), f"daily_{kind}_limit", 0) or 0)
    if limit > 0 and used_today(db, kind) >= limit:
        raise schemas.ApiError(429, "daily_limit",
                               f"This demo's daily limit for {WHAT[kind]} is reached. Please try again tomorrow.")
