"""Protection settings, drills, shield calls and the family alert. Track 3.

The rules live in services/protection.py (settings, random and surprise
drills, starting a shield call) and services/shield.py (the live warning
and the alerts); docs/full-app/protection.md is the contract for the front
end.

- GET  /api/families/{id}/protection: the settings and, per member,
  eligibility, pause, next drill and drills in the last 7 days.
- PUT  /api/families/{id}/protection: change any of enabled,
  drills_per_week, window_start_hour, window_end_hour, timezone,
  shield_enabled.
- PUT  /api/members/{id}/drills: pause or resume a member's drills.
- POST /api/families/{id}/surprise-drill: one drill within the next
  within_seconds (the demo's drill).
- POST /api/families/{id}/shield-call: ring a simulated scam call now,
  watched by the Shield.
- POST /api/members/{id}/alert: the "Something's wrong" button's family
  alert, outside any call.
Errors are schemas.ApiError: 404 not_found, 409 with a plain message, 422
invalid_request.
"""

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import get_db
from app.services import protection, shield

router = APIRouter(tags=["protection"])


@router.get("/families/{family_id}/protection", response_model=schemas.ProtectionView)
async def read_protection(family_id: str, db: DbSession = Depends(get_db)) -> schemas.ProtectionView:
    return protection.protection_view(db, family_id)


@router.put("/families/{family_id}/protection", response_model=schemas.ProtectionView)
async def update_protection(family_id: str, body: schemas.ProtectionUpdate,
                            db: DbSession = Depends(get_db)) -> schemas.ProtectionView:
    return protection.update_settings(db, family_id, body)


@router.put("/members/{member_id}/drills", response_model=schemas.ProtectionMemberView)
async def pause_drills(member_id: str, body: schemas.DrillPause,
                       db: DbSession = Depends(get_db)) -> schemas.ProtectionMemberView:
    return protection.set_paused(db, member_id, body.paused)


@router.post("/families/{family_id}/surprise-drill", status_code=201, response_model=schemas.SurpriseDrillCreated)
async def surprise_drill(family_id: str, body: schemas.SurpriseDrillRequest | None = Body(default=None),
                         db: DbSession = Depends(get_db)) -> schemas.SurpriseDrillCreated:
    body = body or schemas.SurpriseDrillRequest()
    call, member = await protection.surprise_drill(db, family_id, body.member_id, body.within_seconds)
    return schemas.SurpriseDrillCreated(call_id=call.id, member=schemas.PersonRef(id=member.id, name=member.name),
                                        scenario=call.scenario, scheduled_for=call.scheduled_for)


@router.post("/families/{family_id}/shield-call", status_code=201, response_model=schemas.ShieldCallCreated)
async def shield_call(family_id: str, body: schemas.ShieldCallRequest,
                      db: DbSession = Depends(get_db)) -> schemas.ShieldCallCreated:
    call, member = await protection.start_shield_call(db, family_id, body.member_id, body.voice_member_id,
                                                      body.scenario)
    return schemas.ShieldCallCreated(call_id=call.id, member=schemas.PersonRef(id=member.id, name=member.name),
                                     scenario=call.scenario)


@router.post("/members/{member_id}/alert", response_model=schemas.AlertSent)
async def alert_family(member_id: str, body: schemas.AlertRequest | None = Body(default=None),
                       db: DbSession = Depends(get_db)) -> schemas.AlertSent:
    claimed = body.claimed_member_id if body is not None else None
    return schemas.AlertSent(alerted=shield.send_manual_alert(db, member_id, claimed))
