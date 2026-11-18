"""Security headers on every HTTP response (API and the built front end).

Set in the app rather than in the server's nginx vhost, so they travel with
the code on every deploy and a hosting panel rewriting the vhost can't drop
them. A header a route already set is left as it is.

- Strict-Transport-Security: browsers keep to HTTPS for a year.
- X-Content-Type-Options: nosniff, so files are never run as another type.
- Referrer-Policy: other sites see only our origin, never a member's link.
- X-Frame-Options and CSP frame-ancestors: no other site can frame the app.
- Permissions-Policy: the microphone for this site only (calls and voice
  recordings need it); camera, location, payment and USB off.
"""

from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

HEADERS: list[tuple[bytes, bytes]] = [
    (b"strict-transport-security", b"max-age=31536000"),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"x-frame-options", b"DENY"),
    (b"content-security-policy", b"frame-ancestors 'none'"),
    (b"permissions-policy", b"microphone=(self), camera=(), geolocation=(), payment=(), usb=()"),
]


class SecurityHeaders:
    """Pure ASGI middleware: adds HEADERS to each http.response.start."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                headers.extend((name, value) for name, value in HEADERS if name not in present)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
