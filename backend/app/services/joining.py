"""Invites, joining, and the welcome call that starts by itself. OWNER: track 1.

Rules (docs/full-app/track1.md):
- A member's invite link is /join/{member_id} (a front-end route). The
  member id is the key, as it is for the phone page.
- Joining (POST /api/join/{id}) records the member's own two ticks as
  `consents` rows with source `invite`:
  - practice ("I agree to receive practice calls without knowing when"):
    true gives practice consent through services/consent.py, so it sets
    members.consent_practice_at like the sign-up tick does; false withdraws
    it (kind practice_withdrawn), since the member's own answer wins over
    the organiser's tick at sign-up.
  - clone_from_call ("my voice may be cloned from my welcome call"): kind
    `clone_from_call`, or `clone_from_call_withdrawn` when a later join
    takes the tick away. The latest of the two wins: clone_from_call_given().
  On the first join a true tick always writes its row (the member's own
  agreement, even when the sign-up tick already set practice consent);
  later joins write a row only when the answer changes. A false tick with
  nothing to withdraw writes nothing.
- member_joins: joined_at is the first join's time; phone_number is the
  latest join's (null clears it).
- An opted-out member cannot join (409 opted_out).
- The welcome call starts by itself (auto_welcome_call, called from
  phone-state): when a joined member's phone page polls and they have never
  had a welcome call (in any status), start one right then with the same
  rules as POST /api/members/{id}/welcome-call (not opted out, not busy,
  the daily call cap); the poll itself proves the phone is online. Only
  once: a declined, missed or failed welcome call is not retried by itself
  (the existing endpoint starts another). Members who never joined (the old
  sign-up flow) are never called by themselves. settings.auto_welcome_call
  switches it off.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.config import get_settings
from app.db import now_iso
from app.models import Call, Consent, Family, Member, MemberJoin
from app.routers import calls
from app.routers.families import phone_link
from app.services import accounts, consent

log = logging.getLogger("app.joining")

SOURCE = "invite"
CLONE_FROM_CALL = "clone_from_call"
CLONE_FROM_CALL_WITHDRAWN = "clone_from_call_withdrawn"
PRACTICE_EVIDENCE = "Ticked on the invite page: practice calls without knowing when."
PRACTICE_WITHDRAWN_EVIDENCE = "Left the practice tick empty on the invite page."
CLONE_EVIDENCE = "Ticked on the invite page: my voice may be cloned from my welcome call."
CLONE_WITHDRAWN_EVIDENCE = "Left the voice tick empty on the invite page."


def get_join(db: DbSession, member_id: str) -> MemberJoin | None:
    return db.get(MemberJoin, member_id)


# ---------------------------------------------------------------- consents


def clone_from_call_given(db: DbSession, member: Member) -> bool:
    """True if the member's latest answer to "my voice may be cloned from my
    welcome call" is yes and they have not opted out. For track 2, before
    cloning from the welcome call (which also needs the spoken yes)."""
    if member.opted_out_at is not None:
        return False
    latest = db.scalars(
        select(Consent.kind)
        .where(Consent.member_id == member.id, Consent.kind.in_((CLONE_FROM_CALL, CLONE_FROM_CALL_WITHDRAWN)))
        .order_by(Consent.created_at.desc(), Consent.id.desc())
        .limit(1)
    ).first()
    return latest == CLONE_FROM_CALL


def consents_view(db: DbSession, member: Member) -> schemas.JoinConsents:
    return schemas.JoinConsents(
        practice=member.consent_practice_at is not None and member.opted_out_at is None,
        clone_from_call=clone_from_call_given(db, member),
    )


def _record_practice(db: DbSession, member: Member, tick: bool, first_join: bool) -> None:
    if tick:
        if first_join or member.consent_practice_at is None:
            consent.give_practice(db, member, SOURCE, PRACTICE_EVIDENCE)
    else:
        consent.withdraw_practice(db, member, SOURCE, PRACTICE_WITHDRAWN_EVIDENCE)


def _record_clone_from_call(db: DbSession, member: Member, tick: bool, first_join: bool) -> None:
    given = clone_from_call_given(db, member)
    if tick and (first_join or not given):
        kind, evidence = CLONE_FROM_CALL, CLONE_EVIDENCE
    elif not tick and given:
        kind, evidence = CLONE_FROM_CALL_WITHDRAWN, CLONE_WITHDRAWN_EVIDENCE
    else:
        return
    db.add(Consent(member_id=member.id, kind=kind, source=SOURCE, evidence=evidence, created_at=now_iso()))


# ---------------------------------------------------------------- the invite page


def organiser_name(db: DbSession, family_id: str) -> str | None:
    """Whom the invite is from: the name on the account that created the
    family, else the family's first organiser member, else None."""
    owner = accounts.family_owner_name(db, family_id)
    if owner:
        return owner
    return db.scalar(
        select(Member.name)
        .where(Member.family_id == family_id, Member.is_organiser.is_(True))
        .order_by(Member.created_at)
        .limit(1)
    )


def join_view(db: DbSession, member: Member) -> schemas.JoinView:
    family = db.get(Family, member.family_id)
    joined = get_join(db, member.id)
    organiser = organiser_name(db, member.family_id)
    return schemas.JoinView(
        family=schemas.JoinFamily(id=member.family_id, name=family.name if family else "",
                                  safe_word_set=bool(family and family.safe_word_set)),
        organiser=schemas.JoinOrganiser(name=organiser) if organiser else None,
        member=schemas.JoinMember(id=member.id, name=member.name, relationship=member.relationship),
        joined=joined is not None,
        joined_at=joined.joined_at if joined else None,
        phone_number=joined.phone_number if joined else None,
        opted_out=member.opted_out_at is not None,
        consents=consents_view(db, member),
        phone_link=phone_link(member.id),
    )


def join(db: DbSession, member: Member, body: schemas.JoinIn) -> MemberJoin:
    """Record a join (or a second one): the ticks, joined_at and the phone
    number. Raises 409 opted_out. Not committed here."""
    if member.opted_out_at is not None:
        raise schemas.ApiError(409, "opted_out", f"{member.name} has left Callback.")
    row = get_join(db, member.id)
    first_join = row is None
    _record_practice(db, member, body.consent_practice, first_join)
    _record_clone_from_call(db, member, body.consent_clone_from_call, first_join)
    if row is None:
        row = MemberJoin(member_id=member.id, joined_at=now_iso())
        db.add(row)
    row.phone_number = body.phone_number
    return row


# ---------------------------------------------------------------- the welcome call by itself


def had_welcome_call(db: DbSession, member_id: str) -> bool:
    found = db.scalar(
        select(Call.id).where(Call.target_member_id == member_id, Call.kind == "welcome").limit(1)
    )
    return found is not None


def auto_welcome_call(db: DbSession, member: Member) -> Call | None:
    """Start the welcome call for a joined member who never had one, from
    their phone page's poll. Returns the new call, or None when none is due
    or one cannot start now (busy, or the daily cap: a later poll tries
    again, since no welcome call exists yet). Commits what it creates.
    Never raises."""
    try:
        if not get_settings().auto_welcome_call or member.opted_out_at is not None:
            return None
        if get_join(db, member.id) is None or had_welcome_call(db, member.id):
            return None
        if calls.is_busy(db, member.id):
            return None
        call = calls.start_welcome_call(db, member, check_phone_online=False)
        log.info("started the welcome call %s for %s, who joined", call.id, member.id)
        return call
    except schemas.ApiError as error:
        log.debug("no welcome call for %s yet: %s", member.id, error.code)
    except Exception:
        log.exception("could not start the welcome call for %s", member.id)
    try:
        db.rollback()
    except Exception:
        log.exception("could not roll back after the welcome call for %s", member.id)
    return None
