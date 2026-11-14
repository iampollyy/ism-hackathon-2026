"""Live calls: a person calls a family member through Callback and the Shield
listens (services/live_call.py has the rules).

- POST /api/families/{id}/live-call {member_id}: ring the member now. Organiser
  only (the family path is guarded by services/access.py).
- POST /api/calls/{id}/live/answer: the member answered.
- POST /api/calls/{id}/live/signal {side, kind, data}: relay a WebRTC offer,
  answer, ICE candidate or bye to the other browser.
- GET  /api/calls/{id}/live/signal?side=&after=: the other side's signals.
- POST /api/calls/{id}/live/scribe-token: a single-use realtime speech-to-text
  token for the caller's browser.
Ending uses POST /api/calls/{id}/end (or /decline while it rings), as any call.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import get_db
from app.services import live_call

router = APIRouter(tags=["live calls"])


@router.post("/families/{family_id}/live-call", status_code=201, response_model=schemas.LiveCallCreated)
async def start(family_id: str, body: schemas.LiveCallRequest,
                db: DbSession = Depends(get_db)) -> schemas.LiveCallCreated:
    call, member = live_call.start_live_call(db, family_id, body.member_id)
    return schemas.LiveCallCreated(call_id=call.id, member=schemas.PersonRef(id=member.id, name=member.name))


@router.post("/calls/{call_id}/live/answer", response_model=schemas.Ok)
async def answer(call_id: str, db: DbSession = Depends(get_db)) -> schemas.Ok:
    live_call.answer(db, call_id)
    return schemas.Ok()


@router.post("/calls/{call_id}/live/signal", response_model=schemas.Ok)
async def send_signal(call_id: str, body: schemas.LiveSignalIn, db: DbSession = Depends(get_db)) -> schemas.Ok:
    live_call.post_signal(db, call_id, body.side, body.kind, body.data)
    return schemas.Ok()


@router.get("/calls/{call_id}/live/signal", response_model=schemas.LiveSignals)
async def read_signals(call_id: str, side: str = Query(pattern="^(caller|callee)$"), after: int = Query(0, ge=0),
                       db: DbSession = Depends(get_db)) -> schemas.LiveSignals:
    return live_call.signals_for(db, call_id, side, after)


@router.post("/calls/{call_id}/live/scribe-token", response_model=schemas.ScribeToken)
async def scribe_token(call_id: str, db: DbSession = Depends(get_db)) -> schemas.ScribeToken:
    return schemas.ScribeToken(token=await live_call.scribe_token(db, call_id))
