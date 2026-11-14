"""Families: create one, read the family page, the health check, and the
practice switch after sign-up (POST /api/members/{id}/consent).

Consent rules for a family with an owner (made while logged in): only the
person themselves can say yes to practice calls, on their invite page or
on the welcome call. The organiser's sign-up form counts only for the
organiser's own row, and the organiser's switch can only turn practice
calls off for someone else (source `organiser`). A family without an owner
(tests, scripts) keeps the old ticks. Who may call these at all is
services/access.py's job."""

import json
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, not_, select
from sqlalchemy.orm import Session

from app import schemas
from app.config import get_settings
from app.db import get_db, now_iso, parse_time, utcnow
from app.ids import new_family_id, new_member_id
from app.models import Account, Call, Consent, Family, Member, MemberJoin, Message, ReadinessSnapshot
from app.services import accounts, consent, limits

router = APIRouter(tags=["families"])

PHONE_ONLINE_SECONDS = 5
WEEK_ITEMS = 20


@router.get("/health", response_model=schemas.Health)
async def health() -> schemas.Health:
    return schemas.Health(ok=True, fake_elevenlabs=get_settings().fake_elevenlabs)


def phone_link(member_id: str) -> str:
    return f"/phone/{member_id}"


@router.post("/families", status_code=201, response_model=schemas.FamilyCreated)
async def create_family(body: schemas.FamilyCreate, db: Session = Depends(get_db),
                        account: Account | None = Depends(accounts.optional_account)) -> schemas.FamilyCreated:
    """Works without a log-in; with one, the family also belongs to the
    account (family_owners, track 1), and only the organiser's own practice
    tick counts: everyone else agrees on their invite page or the welcome
    call."""
    limits.check(db, "family")
    now = now_iso()
    family = Family(id=new_family_id(), name=body.name.strip(), safe_word_set=body.safe_word_set, created_at=now)
    db.add(family)
    links: list[schemas.MemberLink] = []
    for item in body.members:
        ticked = item.consent_practice and (account is None or item.is_organiser)
        member = Member(
            id=new_member_id(),
            family_id=family.id,
            name=item.name.strip(),
            relationship=item.relationship.strip(),
            is_organiser=item.is_organiser,
            consent_practice_at=now if ticked else None,
            voice_status="none",
            created_at=now,
        )
        db.add(member)
        db.flush()  # the member row must exist before its consent row
        if ticked:
            db.add(Consent(member_id=member.id, kind="practice", source="manual",
                           evidence="sign-up tick", created_at=now))
        links.append(schemas.MemberLink(id=member.id, name=member.name, phone_link=phone_link(member.id)))
    if account is not None:
        accounts.claim_family(db, account, family.id)
    db.commit()
    return schemas.FamilyCreated(family_id=family.id, members=links)


@router.post("/families/{family_id}/members", status_code=201, response_model=schemas.MemberAdded)
async def add_member(family_id: str, body: schemas.MemberAdd,
                     db: Session = Depends(get_db)) -> schemas.MemberAdded:
    """Add a person to an existing family (the organiser only: services/access.py
    guards every path under /api/families/{id}). They start with no consent at
    all; they agree on their own phone through their invite link, and their
    welcome call starts when they join, exactly like the people added at sign-up."""
    family = db.get(Family, family_id)
    if family is None:
        raise schemas.ApiError(404, "not_found", "No family with this id.")
    active = db.scalar(
        select(func.count()).select_from(Member)
        .where(Member.family_id == family.id, Member.opted_out_at.is_(None))
    ) or 0
    if active >= schemas.MAX_FAMILY_MEMBERS:
        raise schemas.ApiError(409, "family_full",
                               f"A family plan has room for {schemas.MAX_FAMILY_MEMBERS} people.")
    member = Member(
        id=new_member_id(),
        family_id=family.id,
        name=body.name.strip(),
        relationship=body.relationship.strip(),
        is_organiser=False,
        consent_practice_at=None,
        voice_status="none",
        created_at=now_iso(),
    )
    db.add(member)
    db.commit()
    return schemas.MemberAdded(id=member.id, name=member.name, relationship=member.relationship,
                               invite_link=f"/join/{member.id}", phone_link=phone_link(member.id))


@router.post("/members/{member_id}/consent", response_model=schemas.Ok)
async def set_practice_consent(member_id: str, body: schemas.ConsentUpdate,
                               db: Session = Depends(get_db)) -> schemas.Ok:
    """The practice switch after sign-up. True gives consent (again, for
    example after a no on the welcome call); false withdraws it. A change
    writes a consents row; the same answer twice writes nothing more.

    In a family with an owner the switch is the organiser's, so for anyone
    but the organiser's own row it only switches off (source `organiser`,
    the evidence names the organiser); a yes is 403 member_must_agree,
    because only the person can agree, from their own link. Without an
    owner it works both ways with source manual."""
    member = db.get(Member, member_id)
    if member is None:
        raise schemas.ApiError(404, "not_found", "No member with this id.")
    by_organiser = not member.is_organiser and accounts.family_owner(db, member.family_id) is not None
    if body.consent_practice:
        if by_organiser:
            raise schemas.ApiError(403, "member_must_agree",
                                   f"Only {member.name} can say yes, from their own link.")
        if member.opted_out_at is not None:
            raise schemas.ApiError(409, "consent_missing", f"{member.name} has left Callback.")
        if member.consent_practice_at is None:
            consent.give_practice(db, member, "manual", "consent tick")
    elif by_organiser:
        owner = accounts.family_owner_name(db, member.family_id) or "the organiser"
        consent.withdraw_practice(db, member, "organiser", f"switched off by {owner}")
    else:
        consent.withdraw_practice(db, member, "manual", "consent tick removed")
    db.commit()
    return schemas.Ok()


@router.get("/families/{family_id}", response_model=schemas.FamilyView)
async def get_family(family_id: str, db: Session = Depends(get_db),
                     account: Account | None = Depends(accounts.optional_account)) -> schemas.FamilyView:
    """A family with an owner is only the owner's to read
    (services/access.py answers anyone else before this runs); one without
    an owner is readable by id. can_see_invites still keeps invite links
    and phone numbers to the owner's session."""
    family = db.get(Family, family_id)
    if family is None:
        raise schemas.ApiError(404, "not_found", "No family with this id.")
    members = list(db.scalars(select(Member).where(Member.family_id == family_id).order_by(Member.created_at)))
    invites = accounts.can_see_invites(db, family_id, account)
    views = [member_view(db, member, invites=invites) for member in members]
    return schemas.FamilyView(
        id=family.id,
        name=family.name,
        safe_word_set=family.safe_word_set,
        family_number=schemas.FamilyNumber(enabled=True),
        members=views,
        readiness=family_readiness(db, members, views),
        week=week_items(db, family_id, {member.id: member.name for member in members}),
    )


# ---------------------------------------------------------------- helpers


def _load_json(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _scores(items_json: str) -> dict[str, int]:
    items = _load_json(items_json) or []
    scores: dict[str, int] = {}
    for item in items:
        if not isinstance(item, dict) or item.get("key") not in schemas.READINESS_LABELS:
            continue
        try:
            score = int(item.get("score", 0))
        except (TypeError, ValueError):
            score = 0
        scores[item["key"]] = max(0, min(schemas.READINESS_ITEM_MAX, score))
    return scores


def readiness_view(db: Session, member_id: str) -> schemas.ReadinessView:
    """Before = the first snapshot, now = the latest; zeros if there is none."""
    snapshots = list(db.scalars(
        select(ReadinessSnapshot)
        .where(ReadinessSnapshot.member_id == member_id)
        .order_by(ReadinessSnapshot.created_at, ReadinessSnapshot.id)
    ))
    before = _scores(snapshots[0].items_json) if snapshots else {}
    now = _scores(snapshots[-1].items_json) if snapshots else {}
    items = [
        schemas.ReadinessItemView(key=key, label=label, before=before.get(key, 0), now=now.get(key, 0))
        for key, label in schemas.READINESS_LABELS.items()
    ]
    return schemas.ReadinessView(
        before=sum(item.before for item in items),
        now=sum(item.now for item in items),
        items=items,
    )


def has_snapshot(db: Session, member_id: str) -> bool:
    found = db.scalar(select(ReadinessSnapshot.id).where(ReadinessSnapshot.member_id == member_id).limit(1))
    return found is not None


def family_readiness(db: Session, members: list[Member],
                     views: list[schemas.MemberView]) -> schemas.FamilyReadinessView:
    """The family's readiness on the same 0 to 10 scale as one person's: the
    mean of the members who have a readiness score yet (rounded), so a
    member without a welcome call does not pull it down. 0 if nobody has one."""
    scored = [view.readiness for member, view in zip(members, views) if has_snapshot(db, member.id)]
    if not scored:
        return schemas.FamilyReadinessView(before=0, now=0, max=schemas.READINESS_MAX)
    return schemas.FamilyReadinessView(
        before=round(sum(item.before for item in scored) / len(scored)),
        now=round(sum(item.now for item in scored) / len(scored)),
        max=schemas.READINESS_MAX,
    )


def plan_view(plan: dict[str, Any]) -> schemas.PlanView:
    steps: list[schemas.PlanStepView] = []
    for step in plan.get("steps") or []:
        try:
            steps.append(schemas.PlanStepView.model_validate(step))
        except ValueError:
            continue
    return schemas.PlanView(this_week=str(plan.get("this_week") or ""), steps=steps)


def is_phone_online(last_seen_at: str | None) -> bool:
    seen = parse_time(last_seen_at)
    return seen is not None and (utcnow() - seen).total_seconds() <= PHONE_ONLINE_SECONDS


def voice_copy_allowed(db: Session, member: Member) -> bool:
    """consent.clone: whether the person allowed a copy of their voice,
    by their own current tick ("my voice may be cloned from my welcome
    call", joining.clone_from_call_given). The organiser counts as yes:
    they are the one at the laptop. Never for someone who left."""
    if member.opted_out_at is not None:
        return False
    if member.is_organiser:
        return True
    from app.services import joining  # joining imports this module

    return joining.clone_from_call_given(db, member)


def member_view(db: Session, member: Member, invites: bool = False) -> schemas.MemberView:
    """invites: fill invite_link and phone_number (the reader may see them:
    accounts.can_see_invites). An opted-out member's phone number is never
    shown. consent.clone is the person's own voice tick (voice_copy_allowed),
    not whether a voice exists yet: voice_ready says that."""
    profile = _as_dict(_load_json(member.profile_json))
    plan = _as_dict(_load_json(member.plan_json))
    opted_out = member.opted_out_at is not None
    voice_ready = member.voice_status == "ready" and member.voice_id is not None and not opted_out
    joined = db.get(MemberJoin, member.id)
    return schemas.MemberView(
        id=member.id,
        name=member.name,
        relationship=member.relationship,
        is_organiser=member.is_organiser,
        phone_link=phone_link(member.id),
        consent=schemas.ConsentView(
            clone=voice_copy_allowed(db, member),
            practice=member.consent_practice_at is not None and not opted_out,
        ),
        voice_ready=voice_ready,
        voice_status=member.voice_status,
        phone_online=is_phone_online(member.last_seen_at),
        readiness=readiness_view(db, member.id),
        weak_spot=plan.get("weak_spot") or profile.get("weak_spot"),
        said=profile.get("said"),
        plan=plan_view(plan) if plan else None,
        invite_link=f"/join/{member.id}" if invites else "",
        joined=joined is not None,
        joined_at=joined.joined_at if joined else None,
        phone_number=joined.phone_number if joined and invites and not opted_out else None,
    )


def _call_text(call: Call, names: dict[str, str]) -> str:
    target = names.get(call.target_member_id, "")
    if call.kind == "welcome":
        return f"Welcome call for {target}"
    if call.kind == "family_line":
        return f"{target} called the family number"
    voice = names.get(call.voice_member_id or "")
    scenario = (call.scenario or "practice").replace("_", " ")
    return f"Practice for {target}: {scenario}" + (f", in {voice}'s voice" if voice else "")


def organisers_surprise(family_id: str):
    """A SQL condition true for a call that is still a surprise for the
    organiser: scheduled for an is_organiser member. The dashboard's reader
    is the organiser, so their own drill's time and story stay hidden
    until it rings."""
    organisers = select(Member.id).where(Member.family_id == family_id, Member.is_organiser.is_(True))
    return and_(Call.status == "scheduled", Call.target_member_id.in_(organisers))


def week_items(db: Session, family_id: str, names: dict[str, str]) -> list[schemas.WeekItem]:
    """The family page's This week: the latest calls and messages, newest
    first. The organiser's own scheduled drill is left out (organisers_surprise)."""
    items: list[schemas.WeekItem] = []
    calls = db.scalars(
        select(Call).where(Call.family_id == family_id, not_(organisers_surprise(family_id)))
        .order_by(Call.created_at.desc()).limit(WEEK_ITEMS)
    )
    for call in calls:
        items.append(schemas.WeekItem(
            kind=call.kind,
            member_id=call.target_member_id,
            member_name=names.get(call.target_member_id, ""),
            status=call.status,
            when=call.scheduled_for or call.ended_at or call.created_at,
            text=_call_text(call, names),
            call_id=call.id,
        ))
    if names:
        messages = db.scalars(
            select(Message).where(Message.member_id.in_(names.keys()))
            .order_by(Message.created_at.desc()).limit(WEEK_ITEMS)
        )
        for message in messages:
            items.append(schemas.WeekItem(
                kind="message" if message.kind == "callback_notice" else message.kind,
                member_id=message.member_id,
                member_name=names.get(message.member_id, ""),
                status="read" if message.read_at else "sent",
                when=message.created_at,
                text=message.text,
            ))
    items.sort(key=lambda item: item.when, reverse=True)
    return items[:WEEK_ITEMS]
