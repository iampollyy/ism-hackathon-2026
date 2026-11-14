"""Review, activity, progress, learning and news: the read-only screens of
the full app. Track 4. The contract for the front end is
docs/full-app/review.md; the rules are in services/review.py,
services/learn.py and services/news.py.

- GET  /api/families/{id}/drills?member_id=&limit=  practice calls, newest first
- GET  /api/families/{id}/activity?limit=           who did what, newest first
- GET  /api/members/{id}/progress                   one member's progress
- GET  /api/learn/tactics, GET /api/learn/habits    static learning content
- GET  /api/families/{id}/news                      the latest digest and weekly notes
- POST /api/families/{id}/news/refresh              a fresh digest (at most every 10 minutes)

All of them read only, except the refresh, which writes only the digest
and its own news_refreshes row: never a call and never a message.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import get_db
from app.models import Family, Member
from app.services import learn, news, review

router = APIRouter(tags=["review"])

DEFAULT_DRILLS = 20
MAX_DRILLS = 100
DEFAULT_ACTIVITY = 30
MAX_ACTIVITY = 200


def family_or_404(db: DbSession, family_id: str) -> Family:
    family = db.get(Family, family_id)
    if family is None:
        raise schemas.ApiError(404, "not_found", "No family with this id.")
    return family


def member_or_404(db: DbSession, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None:
        raise schemas.ApiError(404, "not_found", "No member with this id.")
    return member


@router.get("/families/{family_id}/drills", response_model=schemas.DrillList)
async def family_drills(family_id: str, member_id: str | None = None,
                        limit: int = Query(DEFAULT_DRILLS, ge=1, le=MAX_DRILLS),
                        db: DbSession = Depends(get_db)) -> schemas.DrillList:
    family_or_404(db, family_id)
    if member_id is not None and member_or_404(db, member_id).family_id != family_id:
        raise schemas.ApiError(404, "not_found", "No member with this id in this family.")
    return schemas.DrillList(drills=review.drills(db, family_id, member_id, limit))


@router.get("/families/{family_id}/activity", response_model=schemas.ActivityView)
async def family_activity(family_id: str, limit: int = Query(DEFAULT_ACTIVITY, ge=1, le=MAX_ACTIVITY),
                          db: DbSession = Depends(get_db)) -> schemas.ActivityView:
    family_or_404(db, family_id)
    return schemas.ActivityView(items=review.activity(db, family_id, limit))


@router.get("/members/{member_id}/progress", response_model=schemas.ProgressView)
async def member_progress(member_id: str, db: DbSession = Depends(get_db)) -> schemas.ProgressView:
    return review.progress(db, member_or_404(db, member_id))


@router.get("/learn/tactics", response_model=schemas.LearnTactics)
async def learn_tactics() -> schemas.LearnTactics:
    return schemas.LearnTactics(tactics=learn.tactics())


@router.get("/learn/habits", response_model=schemas.Habits)
async def learn_habits() -> schemas.Habits:
    return schemas.Habits(habits=learn.habits())


@router.get("/families/{family_id}/news", response_model=schemas.NewsView)
async def family_news(family_id: str, db: DbSession = Depends(get_db)) -> schemas.NewsView:
    family_or_404(db, family_id)
    return news.news(db, family_id)


@router.post("/families/{family_id}/news/refresh", response_model=schemas.NewsRefreshed)
async def refresh_news(family_id: str, db: DbSession = Depends(get_db)) -> schemas.NewsRefreshed:
    family = family_or_404(db, family_id)
    return await news.refresh(db, family)
