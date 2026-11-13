"""A bare test phone page, for trying real calls before the real front end
has its phone page. Not part of backend.md's contract and not the product UI.

GET /api/dev/phone/{member_id} serves app/static/dev_phone.html. The page
uses only the public phone endpoints (phone-state, answer, events, end,
family-line), exactly as the real phone page will, so it gives a member's
link no extra power. It loads the ElevenLabs browser client from a CDN.
"""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter()

PAGE = Path(__file__).resolve().parent.parent / "static" / "dev_phone.html"


@router.get("/dev/phone/{member_id}", include_in_schema=False)
def dev_phone(member_id: str) -> FileResponse:
    return FileResponse(PAGE, media_type="text/html", headers={"Cache-Control": "no-store"})
