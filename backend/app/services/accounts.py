"""Organiser accounts: passwords, log-in sessions, the wrong-log-in limit
and which families an account owns. OWNER: track 1.

Rules (docs/full-app/track1.md):
- Passwords: stdlib hashlib.scrypt (n=2**14, r=8, p=1, a 16-byte random
  salt, a 64-byte key), stored with its parameters as
  "scrypt$n$r$p$salt$key" (salt and key in URL-safe base64), so old hashes
  still verify if the parameters change. Compared with hmac.compare_digest.
  At least 8 characters (the router checks it).
- Sessions: a random 32-byte URL-safe token in the HttpOnly cookie
  `cb_session` (SameSite=Lax, Secure when the request came over https,
  settings.session_days long). Only the token's sha256 is stored, in
  `sessions`. An expired session counts as none, and is deleted when seen.
- Wrong log-ins: each one writes a `login_failures` row for the email, also
  for an email with no account (so the answer never tells which emails
  exist, and a missing account costs the same scrypt time). Once an email
  has settings.login_max_failures rows inside settings.login_window_minutes,
  log-in answers 429 too_many_attempts before the password is checked,
  even a right one. A right password (under the limit) clears the rows.
- Families: POST /api/families with a valid session writes `family_owners`
  (claim_family). The family page stays readable by id without a session.

Nothing here commits; the routers do.
"""

import base64
import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import Depends, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.config import get_settings
from app.db import get_db, now_iso, parse_time, to_iso, utcnow
from app.models import Account, AuthSession, Family, FamilyOwner, LoginFailure

COOKIE_NAME = "cb_session"
PASSWORD_MIN_CHARS = 8
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1
SCRYPT_KEY_BYTES = 64
SALT_BYTES = 16
TOKEN_BYTES = 32
SCRYPT_MAXMEM = 64 * 1024 * 1024  # n=2**14, r=8 needs 16 MB; leave room for stored hashes with bigger n

_dummy_hash: str | None = None


# ---------------------------------------------------------------- passwords


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    """The stored form of a password: "scrypt$n$r$p$salt$key"."""
    salt = secrets.token_bytes(SALT_BYTES)
    key = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                         maxmem=SCRYPT_MAXMEM, dklen=SCRYPT_KEY_BYTES)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, stored: str) -> bool:
    """True if the password matches the stored hash. Never raises: a
    malformed hash is a mismatch."""
    try:
        scheme, n, r, p, salt, key = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = _unb64(key)
        actual = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p),
                                maxmem=SCRYPT_MAXMEM, dklen=len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def dummy_hash() -> str:
    """A hash to check against when the email has no account, so a missing
    account takes as long as a wrong password."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password(secrets.token_urlsafe(16))
    return _dummy_hash


# ---------------------------------------------------------------- accounts


def new_account_id() -> str:
    return "acc_" + secrets.token_urlsafe(8)


def find_account(db: DbSession, email: str) -> Account | None:
    return db.scalars(select(Account).where(Account.email == email.strip().lower())).first()


def account_view(account: Account) -> schemas.AccountView:
    return schemas.AccountView(id=account.id, name=account.name, email=account.email)


def account_families(db: DbSession, account_id: str) -> list[Family]:
    """The account's families, oldest first."""
    return list(db.scalars(
        select(Family)
        .join(FamilyOwner, FamilyOwner.family_id == Family.id)
        .where(FamilyOwner.account_id == account_id)
        .order_by(Family.created_at, Family.id)
    ))


def me(db: DbSession, account: Account) -> schemas.Me:
    families = [schemas.FamilyRef(id=family.id, name=family.name) for family in account_families(db, account.id)]
    return schemas.Me(account=account_view(account), families=families)


def claim_family(db: DbSession, account: Account, family_id: str) -> None:
    """Record that this account created the family. Not committed here."""
    if db.get(FamilyOwner, family_id) is None:
        db.add(FamilyOwner(family_id=family_id, account_id=account.id))


def family_owner_name(db: DbSession, family_id: str) -> str | None:
    """The name on the account that created the family, if any."""
    return db.scalar(
        select(Account.name)
        .join(FamilyOwner, FamilyOwner.account_id == Account.id)
        .where(FamilyOwner.family_id == family_id)
    )


# ---------------------------------------------------------------- sessions


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: DbSession, account: Account) -> str:
    """A new log-in for the account. Returns the token for the cookie; only
    its hash is stored. Not committed here."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    now = utcnow()
    db.add(AuthSession(
        token_hash=token_hash(token),
        account_id=account.id,
        created_at=to_iso(now),
        expires_at=to_iso(now + timedelta(days=get_settings().session_days)),
    ))
    return token


def end_session(db: DbSession, token: str | None) -> None:
    """Forget this log-in (logout). Not committed here."""
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(token)))


def account_for_token(db: DbSession, token: str | None) -> Account | None:
    """The account a cookie's token logs in, or None (no token, unknown or
    expired; an expired session is deleted and committed)."""
    if not token:
        return None
    row = db.get(AuthSession, token_hash(token))
    if row is None:
        return None
    expires = parse_time(row.expires_at)
    if expires is None or expires <= utcnow():
        db.delete(row)
        db.commit()
        return None
    return db.get(Account, row.account_id)


async def optional_account(request: Request, db: DbSession = Depends(get_db)) -> Account | None:
    """FastAPI dependency: the logged-in account, or None."""
    return account_for_token(db, request.cookies.get(COOKIE_NAME))


async def require_account(account: Account | None = Depends(optional_account)) -> Account:
    """FastAPI dependency: the logged-in account, or 401 not_logged_in."""
    if account is None:
        raise schemas.ApiError(401, "not_logged_in", "Please log in.")
    return account


def _cookie_secure(request: Request) -> bool:
    # uvicorn runs with --proxy-headers behind the server's nginx, so the
    # scheme is the browser's.
    return request.url.scheme == "https"


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, token,
        max_age=get_settings().session_days * 24 * 3600,
        path="/",
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(request),
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=_cookie_secure(request))


# ---------------------------------------------------------------- wrong log-ins


def _window_start() -> str:
    return to_iso(utcnow() - timedelta(minutes=get_settings().login_window_minutes))


def recent_failures(db: DbSession, email: str) -> int:
    """Wrong log-ins for this email inside the window."""
    return int(db.scalar(
        select(func.count()).select_from(LoginFailure)
        .where(LoginFailure.email == email, LoginFailure.created_at >= _window_start())
    ) or 0)


def too_many_failures(db: DbSession, email: str) -> bool:
    return recent_failures(db, email) >= get_settings().login_max_failures


def record_failure(db: DbSession, email: str) -> None:
    """One more wrong log-in; rows older than the window are dropped. Not
    committed here."""
    db.execute(delete(LoginFailure).where(LoginFailure.created_at < _window_start()))
    db.add(LoginFailure(email=email, created_at=now_iso()))


def clear_failures(db: DbSession, email: str) -> None:
    """A right password: start counting again. Not committed here."""
    db.execute(delete(LoginFailure).where(LoginFailure.email == email))
