"""Organiser accounts, the account's families, and joining by invite.
OWNER: track 1. The contract for the front end is docs/full-app/track1.md.

- POST /api/auth/register {name, email, password}: a new account, logged in
  at once (201, the same body as /me). 409 email_taken; a password under 8
  characters is 422 password_too_short.
- POST /api/auth/login {email, password}: sets the cb_session cookie and
  answers like /me. A wrong email or password is 401 wrong_login with one
  generic message; once an email has 5 wrong log-ins in 15 minutes it is
  429 too_many_attempts, checked before the password. Every attempt is
  written (and committed) before its password is checked, and a right one
  deletes the email's rows, so parallel attempts count as they arrive
  (services/accounts.py).
- POST /api/auth/logout: forgets the session and clears the cookie;
  {ok: true} also when nobody was logged in.
- GET /api/auth/me: {account, families} or 401 not_logged_in.
- GET /api/families: the logged-in account's families (401 not_logged_in).
  POST /api/families still works without a session (families.py); with one
  it also writes family_owners.
- GET /api/join/{member_id}: what the invite page shows. 404 not_found.
  It never shows the family id: that id opens the family page, which lists
  every member's id, and a member id is the only key to that member's
  invite, phone and consent pages.
- POST /api/join/{member_id} {consent_practice, consent_clone_from_call,
  phone_number}: records the join (services/joining.py) and answers
  {phone_link}. 404 not_found, 409 opted_out, 422 invalid_request for a
  phone number that is not 6 to 20 digits and spaces (an optional leading +).

scrypt runs in the scrypt pool (accounts.run_scrypt), so a log-in never stalls
the event loop the live calls share. No write is pending across that await
(db.py, "Hard rule"): register only reads before it, and login commits its
attempt row first. Neither holds a pooled connection while it answers an
error: a flood of parallel log-ins would otherwise check out every
connection in the pool and stall the event loop in the next checkout.
"""

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import get_db, now_iso
from app.models import Account, Member, MemberJoin
from app.routers.calls import get_member
from app.routers.families import phone_link
from app.services import accounts, joining

router = APIRouter(tags=["accounts"])

WRONG_LOGIN = "Wrong email or password."


# ---------------------------------------------------------------- auth


@router.post("/auth/register", status_code=201, response_model=schemas.Me)
async def register(body: schemas.RegisterIn, request: Request, response: Response,
                   db: DbSession = Depends(get_db)) -> schemas.Me:
    if len(body.password) < accounts.PASSWORD_MIN_CHARS:
        raise schemas.ApiError(422, "password_too_short",
                               f"The password needs at least {accounts.PASSWORD_MIN_CHARS} characters.")
    taken = accounts.find_account(db, body.email) is not None
    db.rollback()  # end the read: before the await, and before an early answer
    if taken:
        raise schemas.ApiError(409, "email_taken", "There is already an account with this email. Please log in.")
    password_hash = await accounts.run_scrypt(accounts.hash_password, body.password)
    if accounts.find_account(db, body.email) is not None:  # registered while the hash was made
        db.rollback()
        raise schemas.ApiError(409, "email_taken", "There is already an account with this email. Please log in.")
    account = Account(id=accounts.new_account_id(), email=body.email, name=body.name,
                      password_hash=password_hash, created_at=now_iso())
    db.add(account)
    db.flush()  # the account row before its session row
    token = accounts.create_session(db, account)
    db.commit()
    accounts.set_session_cookie(response, request, token)
    return accounts.me(db, account)


@router.post("/auth/login", response_model=schemas.Me)
async def login(body: schemas.LoginIn, request: Request, response: Response,
                db: DbSession = Depends(get_db)) -> schemas.Me:
    email = body.email.strip().lower()
    # No await between the check and the commit: parallel attempts each see
    # the ones before them.
    if accounts.too_many_failures(db, email):
        db.rollback()  # hand the connection back now: a flood of 429s must not drain the pool
        raise schemas.ApiError(429, "too_many_attempts", accounts.too_many_attempts_message())
    account = accounts.find_account(db, email)
    stored = account.password_hash if account else None
    accounts.record_attempt(db, email)
    db.commit()  # the attempt counts from now; nothing pending across the await
    matches = await accounts.run_scrypt(accounts.check_password, body.password, stored)
    if account is None or not matches:
        raise schemas.ApiError(401, "wrong_login", WRONG_LOGIN)
    accounts.clear_failures(db, email)
    token = accounts.create_session(db, account)
    db.commit()
    accounts.set_session_cookie(response, request, token)
    return accounts.me(db, account)


@router.post("/auth/logout", response_model=schemas.Ok)
async def logout(request: Request, response: Response, db: DbSession = Depends(get_db)) -> schemas.Ok:
    accounts.end_session(db, request.cookies.get(accounts.COOKIE_NAME))
    db.commit()
    accounts.clear_session_cookie(response, request)
    return schemas.Ok()


@router.get("/auth/me", response_model=schemas.Me)
async def read_me(account: Account = Depends(accounts.require_account),
                  db: DbSession = Depends(get_db)) -> schemas.Me:
    return accounts.me(db, account)


# ---------------------------------------------------------------- the account's families


@router.get("/families", response_model=schemas.FamilyList)
async def list_families(account: Account = Depends(accounts.require_account),
                        db: DbSession = Depends(get_db)) -> schemas.FamilyList:
    summaries: list[schemas.FamilySummary] = []
    for family in accounts.account_families(db, account.id):
        member_count = db.scalar(select(func.count()).select_from(Member).where(Member.family_id == family.id))
        joined_count = db.scalar(
            select(func.count()).select_from(MemberJoin)
            .join(Member, Member.id == MemberJoin.member_id)
            .where(Member.family_id == family.id)
        )
        summaries.append(schemas.FamilySummary(
            id=family.id, name=family.name, safe_word_set=family.safe_word_set, created_at=family.created_at,
            member_count=int(member_count or 0), joined_count=int(joined_count or 0),
        ))
    return schemas.FamilyList(families=summaries)


# ---------------------------------------------------------------- joining by invite


@router.get("/join/{member_id}", response_model=schemas.JoinView)
async def read_invite(member_id: str, db: DbSession = Depends(get_db)) -> schemas.JoinView:
    return joining.join_view(db, get_member(db, member_id))


@router.post("/join/{member_id}", response_model=schemas.Joined)
async def join(member_id: str, body: schemas.JoinIn, db: DbSession = Depends(get_db)) -> schemas.Joined:
    member = get_member(db, member_id)
    joining.join(db, member, body)
    db.commit()
    return schemas.Joined(phone_link=phone_link(member.id))
