"""The family's news screen: this week's scam patterns and each member's
latest weekly note. Track 4 (docs/full-app/review.md).

news(): the latest digest (the `digests` table: one row per ISO week, shared
by all families, written by the weekly run or by a refresh) and each
member's latest `weekly` message. With no digest: patterns [] and
updated_at null.
- `fallback` is true when the digest is not this week's news: the weekly
  run's fallback row (the built-in examples, or an older digest carried
  forward) or a digest from an earlier week.
- Sources are listed only for real web addresses, never for the built-in
  ones (builtin:...). Their `date` is the day the digest was built, which is
  the day Callback read the pages; null on a fallback row, which was saved
  again later and does not know when its pages were read.
- `next_refresh_at`: when a refresh may build again (the rules below), or
  null if it may now.

refresh(): fetches the warning pages and runs the digest job again, with the
weekly run's own code (routers/weekly.py: WARNING_URLS and its digest
helpers; services/firecrawl.fetch_warnings; agents/digest.build_digest), and
stores the result as this week's digest. It creates no calls and no
messages; only the weekly run does that.
- The digest is shared by all families, so building it is shared too: at
  most one build per settings.news_refresh_seconds (10 minutes) for all
  families together. Without a build the current news is returned:
  - too_soon: this family, or another family, started a refresh within that
    time (it may still be running: its news_refreshes row has no outcome
    yet). So two clicks at once, from one family or two, build once.
  - fresh: a model built the digest within that time (any family's refresh,
    or the weekly run); building it again would only cost.
  This family's own recent refresh is checked first (too_soon), then the
  fresh digest (fresh), then another family's refresh (too_soon).
- When no new digest can be built (no model key, every model failed), the
  stored news stays: reason no_new_digest. With no digest at all, the
  built-in patterns are stored as this week's fallback, as the weekly run
  does, so the screen has something to show. Whether there is a digest is
  checked again after the awaits, with no await between the check and the
  write, so a digest stored meanwhile (the weekly run, another build) is
  never overwritten with the examples.
- The attempt (a news_refreshes row) is committed before any await (db.py,
  "Hard rule"). Never raises: any error after the family is found is logged
  and answered with the current news, reason failed.
"""

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.agents import digest as digest_job
from app.config import get_settings
from app.db import new_session, now_iso, parse_time, to_iso, utcnow
from app.models import Digest, Family, Member, Message, NewsRefresh
from app.routers import weekly
from app.services import firecrawl

log = logging.getLogger("app.news")


# ---------------------------------------------------------------- reading


def latest_digest(db: DbSession) -> Digest | None:
    return db.scalars(select(Digest).order_by(Digest.created_at.desc(), Digest.id.desc()).limit(1)).first()


def last_refresh(db: DbSession, family_id: str | None = None) -> NewsRefresh | None:
    """The newest refresh this family started (any family's with None)."""
    query = select(NewsRefresh)
    if family_id is not None:
        query = query.where(NewsRefresh.family_id == family_id)
    return db.scalars(query.order_by(NewsRefresh.created_at.desc(), NewsRefresh.id.desc()).limit(1)).first()


def _time(value: str | None) -> datetime | None:
    try:
        return parse_time(value)
    except (TypeError, ValueError):
        return None


def within(value: str | None, seconds: float) -> bool:
    """The stored time is less than `seconds` ago."""
    when = _time(value)
    return when is not None and (utcnow() - when).total_seconds() < seconds


def is_real(row: Digest | None) -> bool:
    """A digest a model built (not the weekly run's fallback row)."""
    return row is not None and not weekly._is_fallback(row) and bool(weekly._stored_patterns(row))


def next_refresh_at(db: DbSession) -> str | None:
    """When a refresh may build again: the wait after the newest refresh any
    family started, and after the newest digest a model built. None if now."""
    wait = timedelta(seconds=get_settings().news_refresh_seconds)
    last = last_refresh(db)
    digest = latest_digest(db)
    times = [_time(last.created_at) if last is not None else None,
             _time(digest.created_at) if digest is not None and is_real(digest) else None]
    ready = max((when + wait for when in times if when is not None), default=None)
    return to_iso(ready) if ready is not None and ready > utcnow() else None


def pattern_view(pattern: dict[str, Any], day: str | None) -> schemas.NewsPattern | None:
    title = " ".join(str(pattern.get("title") or "").split())
    summary = " ".join(str(pattern.get("summary") or "").split())
    if not title or not summary:
        return None
    tactics: list[str] = []
    for key in pattern.get("tactics") or []:
        if key in schemas.TACTIC_LABELS and key not in tactics:
            tactics.append(key)
    url = str(pattern.get("source_url") or "").strip()
    scenario = pattern.get("closest_scenario")
    return schemas.NewsPattern(
        title=title,
        summary=summary,
        tactics=[schemas.TacticRef(key=key, label=schemas.TACTIC_LABELS[key]) for key in tactics],
        closest_scenario=scenario if scenario in schemas.SCENARIOS else None,
        sources=[schemas.NewsSource(url=url, date=day)] if url.startswith(("https://", "http://")) else [],
    )


def notes(db: DbSession, family_id: str) -> list[schemas.NewsNote]:
    """Each member's latest weekly note (members who left are not shown)."""
    members = list(db.scalars(select(Member).where(Member.family_id == family_id, Member.opted_out_at.is_(None))
                              .order_by(Member.created_at)))
    if not members:
        return []
    latest: dict[str, Message] = {}
    rows = db.scalars(
        select(Message).where(Message.member_id.in_([member.id for member in members]), Message.kind == "weekly")
        .order_by(Message.created_at.desc(), Message.id.desc())
    )
    for row in rows:
        latest.setdefault(row.member_id, row)
    return [
        schemas.NewsNote(member=schemas.PersonRef(id=member.id, name=member.name),
                         text=latest[member.id].text, when=latest[member.id].created_at)
        for member in members if member.id in latest
    ]


def news(db: DbSession, family_id: str) -> schemas.NewsView:
    row = latest_digest(db)
    patterns: list[schemas.NewsPattern] = []
    if row is not None:
        when = _time(row.created_at)
        day = when.date().isoformat() if when and not weekly._is_fallback(row) else None
        patterns = [view for pattern in weekly._stored_patterns(row)
                    if (view := pattern_view(pattern, day)) is not None]
    found = row is not None and bool(patterns)
    return schemas.NewsView(
        patterns=patterns,
        updated_at=row.created_at if found else None,
        week=row.week if found else None,
        fallback=found and (weekly._is_fallback(row) or row.week != weekly.iso_week()),
        notes=notes(db, family_id),
        next_refresh_at=next_refresh_at(db),
    )


# ---------------------------------------------------------------- refreshing


def _answer(db: DbSession, family_id: str, refreshed: bool, reason: str | None) -> schemas.NewsRefreshed:
    return schemas.NewsRefreshed(**news(db, family_id).model_dump(), refreshed=refreshed, reason=reason)


def store_examples_if_empty(week: str) -> bool:
    """With no digest at all, the built-in patterns become this week's
    fallback row. Checked now, in a new session, and written with no await
    in between, so a digest stored while the refresh awaited is kept.
    Returns whether the examples were stored."""
    with new_session() as db:
        if db.scalars(select(Digest.id).limit(1)).first() is not None:
            return False
    weekly._save_digest(week, [weekly.FALLBACK_SOURCE], [dict(pattern) for pattern in weekly.FALLBACK_PATTERNS])
    return True


async def build_and_store() -> str:
    """Firecrawl and the digest job, as the weekly run calls them; the new
    patterns become this week's digest. Returns refreshed or no_new_digest.
    Raises only if storing fails (refresh() catches it)."""
    week = weekly.iso_week()
    pages = await firecrawl.fetch_warnings(weekly.WARNING_URLS)
    built = await digest_job.build_digest(pages) if pages else None
    if built and weekly.pattern_views(built.get("patterns") or []):
        weekly._save_digest(week, [str(page.get("url")) for page in pages], built["patterns"])
        return "refreshed"
    store_examples_if_empty(week)
    return "no_new_digest"


async def refresh(db: DbSession, family: Family) -> schemas.NewsRefreshed:
    """Build a fresh digest for the family's news screen (the rules above).
    Never raises. Everything from the checks to the attempt's commit runs
    with no await, so a second click (any family) always sees the first."""
    family_id = family.id
    try:
        wait = get_settings().news_refresh_seconds
        own = last_refresh(db, family_id)
        if own is not None and within(own.created_at, wait):
            return _answer(db, family_id, False, "too_soon")
        latest = latest_digest(db)
        if is_real(latest) and within(latest.created_at, wait):
            return _answer(db, family_id, False, "fresh")
        anyone = last_refresh(db)
        if anyone is not None and within(anyone.created_at, wait):
            return _answer(db, family_id, False, "too_soon")  # another family's, maybe still running
        attempt = NewsRefresh(family_id=family_id, created_at=now_iso())
        db.add(attempt)
        db.commit()  # nothing pending while Firecrawl and the model run
    except Exception:
        db.rollback()
        log.exception("news refresh for %s could not start", family_id)
        return _safe_answer(db, family_id, "failed")

    try:
        outcome = await build_and_store()
    except Exception:
        log.exception("news refresh for %s failed", family_id)
        outcome = "failed"
    try:
        attempt.outcome = outcome
        db.commit()
    except Exception:
        db.rollback()
        log.exception("could not record the news refresh for %s", family_id)
    db.expire_all()  # the digest was written in another session
    if outcome == "refreshed":
        return _safe_answer(db, family_id, None)
    return _safe_answer(db, family_id, outcome)


def _safe_answer(db: DbSession, family_id: str, reason: str | None) -> schemas.NewsRefreshed:
    """The current news with the refresh's reason; empty news if even
    reading fails."""
    try:
        return _answer(db, family_id, reason is None, reason)
    except Exception:
        log.exception("could not read the news for %s", family_id)
        return schemas.NewsRefreshed(patterns=[], updated_at=None, week=None, fallback=False, notes=[],
                                     next_refresh_at=None, refreshed=False, reason="failed")
