"""Who may read and change a family's dashboard: the organiser's session.

A pure ASGI middleware (registered in main.py), so the routers of the
other tracks stay as they are. It guards the organiser's endpoints:

- /api/families/{id} and every path under it, except GET (and HEAD)
  .../news, which the phone's News tab reads with only the member id.
- /api/members/{id}/drills, /api/members/{id}/progress,
  /api/members/{id}/consent, and POST /api/members/{id}/voice (the
  organiser's recorder). The member's family is the one checked.

For a family with an owner (family_owners, made while logged in) the
request needs the cb_session of that owner's account: no session answers
401 not_logged_in, another account 404 not_found (the family is not
theirs, and its id says nothing more). A family with no owner (made
without a log-in: tests, scripts/dev_call.py, fake_phone.py) stays open,
and an unknown id falls through to the router's own 404.

The phone's own endpoints stay open, because a phone only has its member
id: /api/join/*, phone-state, messages/read, family-line, alert,
voice-sample, opt-out, push-subscription, DELETE voice, welcome-call and
/api/calls/*. CORS preflights (OPTIONS) are never checked.

The database session is closed before the request goes on (db.py: no open
session across an await).
"""

import re
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse

from app.db import new_session
from app.models import Member
from app.services import accounts

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

FAMILY_PATH = re.compile(r"^/api/families/(?P<id>[^/]+)(?P<rest>/.*)?$")
MEMBER_PATH = re.compile(r"^/api/members/(?P<id>[^/]+)/(?P<what>drills|progress|consent|voice)/?$")
OPEN_FAMILY_READS = {"/news", "/news/"}  # the phone's News tab
READ_METHODS = {"GET", "HEAD"}

NOT_LOGGED_IN = ("not_logged_in", "Please log in.")
NOT_YOURS_FAMILY = ("not_found", "No family with this id.")
NOT_YOURS_MEMBER = ("not_found", "No member with this id.")


def guarded(method: str, path: str) -> tuple[str, str] | None:
    """("family" | "member", id) when this request needs the owner's
    session, else None."""
    if method == "OPTIONS":
        return None
    found = FAMILY_PATH.match(path)
    if found:
        if method in READ_METHODS and (found["rest"] or "") in OPEN_FAMILY_READS:
            return None
        return "family", found["id"]
    found = MEMBER_PATH.match(path)
    if found:
        if found["what"] == "voice" and method != "POST":
            return None  # DELETE voice is the member's own, from the phone
        return "member", found["id"]
    return None


def refusal(kind: str, key: str, token: str | None) -> tuple[int, str, str] | None:
    """(status, code, message) when the reader may not use this family,
    or None when the request may go on."""
    with new_session() as db:
        if kind == "member":
            member = db.get(Member, key)
            if member is None:
                return None  # the router's own 404
            family_id = member.family_id
        else:
            family_id = key
        owner = accounts.family_owner(db, family_id)
        if owner is None:
            return None  # no owner (or no such family): open
        account = accounts.account_for_token(db, token)
        if account is None:
            return (401, *NOT_LOGGED_IN)
        if account.id != owner.account_id:
            return (404, *(NOT_YOURS_MEMBER if kind == "member" else NOT_YOURS_FAMILY))
        return None


class OwnerOnly:
    """ASGI middleware: the family dashboard is for the family's owner."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        target = guarded(scope.get("method", "GET"), scope.get("path", ""))
        if target is not None:
            token = HTTPConnection(scope).cookies.get(accounts.COOKIE_NAME)
            refused = refusal(*target, token)
            if refused is not None:
                status, code, message = refused
                response = JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
