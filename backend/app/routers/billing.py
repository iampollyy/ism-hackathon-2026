"""Pricing and the family's plan, in demo mode. Added on Saturday; not in
backend.md (see docs/full-app/billing.md).

Rules:
- No payment is ever taken and no card details exist anywhere: choosing a
  plan only records it, and every answer says demo: true. Real payments
  would go through a payment provider's own hosted checkout later.
- A family with no plan row is on a 30-day trial counted from its
  created_at; after that the trial shows as ended but nothing is blocked
  this weekend.
- "Through your bank" needs a partner code; any code of 4 to 40 letters,
  digits or dashes is accepted in the demo. Never a real bank's name in
  copy.
"""

import re
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app import schemas
from app.db import get_db, now_iso, parse_time, to_iso
from app.models import Family, FamilyPlan

router = APIRouter(tags=["billing"])

DEMO_NOTE = "This is a demo: choosing a plan takes no payment and asks for no card details."
BANK_CODE = re.compile(r"^[A-Za-z0-9-]{4,40}$")

PLANS = [
    schemas.PricePlan(
        key="family_monthly", name="Family", price="€4.99 a month", price_eur=4.99, period="month",
        note="After a 30-day free trial. Cancel any time.",
        features=["Up to 6 family members", "Practice drills in your family's own voices",
                  "Callback Shield on calls", "Weekly scam news and lessons"],
        cta="Choose monthly", choosable=True,
    ),
    schemas.PricePlan(
        key="family_yearly", name="Family, yearly", price="€49 a year", price_eur=49.0, period="year",
        note="Two months free compared with monthly.",
        features=["Everything in Family", "Best value for a whole year of practice"],
        cta="Choose yearly", choosable=True,
    ),
    schemas.PricePlan(
        key="bank", name="Through your bank", price="Free", price_eur=None, period=None,
        note="Free for customers of partner banks. Enter the code from your bank.",
        features=["Everything in Family", "Paid for by your bank"],
        cta="Enter bank code", choosable=True,
    ),
    schemas.PricePlan(
        key="partner", name="For banks", price="Per enrolled family", price_eur=None, period=None,
        note="Banks are being made liable for scam losses. Give your customers' families the practice.",
        features=["Your customers enrol for free", "Habit reports per enrolled family", "Your brand on the welcome call"],
        cta="Talk to us", choosable=False,
    ),
]
PLAN_NAMES = {"trial": "Free trial", "family_monthly": "Family", "family_yearly": "Family, yearly", "bank": "Through your bank"}
PLAN_PRICES = {"trial": None, "family_monthly": "€4.99 a month", "family_yearly": "€49 a year", "bank": "Free"}


def _family(db: DbSession, family_id: str) -> Family:
    family = db.get(Family, family_id)
    if family is None:
        raise schemas.ApiError(404, "not_found", "No such family.")
    return family


def plan_view(db: DbSession, family: Family) -> schemas.FamilyPlanView:
    row = db.get(FamilyPlan, family.id)
    if row is None:
        created = parse_time(family.created_at)
        ends = to_iso(created + timedelta(days=schemas.TRIAL_DAYS)) if created else None
        return schemas.FamilyPlanView(plan="trial", plan_name=PLAN_NAMES["trial"], status="trialing", price=None,
                                      trial_ends_at=ends, started_at=family.created_at, bank_code=None)
    return schemas.FamilyPlanView(plan=row.plan, plan_name=PLAN_NAMES.get(row.plan, row.plan), status=row.status,
                                  price=PLAN_PRICES.get(row.plan), trial_ends_at=None, started_at=row.started_at,
                                  bank_code=row.bank_code)


@router.get("/pricing", response_model=schemas.Pricing)
async def pricing() -> schemas.Pricing:
    return schemas.Pricing(trial_days=schemas.TRIAL_DAYS, currency="EUR", plans=PLANS, demo_note=DEMO_NOTE)


@router.get("/families/{family_id}/plan", response_model=schemas.FamilyPlanView)
async def get_plan(family_id: str, db: DbSession = Depends(get_db)) -> schemas.FamilyPlanView:
    return plan_view(db, _family(db, family_id))


@router.post("/families/{family_id}/plan", response_model=schemas.FamilyPlanView)
async def choose_plan(family_id: str, body: schemas.PlanChoice, db: DbSession = Depends(get_db)) -> schemas.FamilyPlanView:
    family = _family(db, family_id)
    code = (body.bank_code or "").strip() or None
    if body.plan == "bank" and (code is None or not BANK_CODE.match(code)):
        raise schemas.ApiError(422, "invalid_bank_code", "Enter the code from your bank (4 to 40 letters, digits or dashes).")
    now = now_iso()
    row = db.get(FamilyPlan, family.id)
    if row is None:
        row = FamilyPlan(family_id=family.id, plan=body.plan, status="active", started_at=now, updated_at=now)
        db.add(row)
    row.plan, row.status, row.updated_at = body.plan, "active", now
    row.bank_code = code.upper() if body.plan == "bank" and code else None
    db.commit()
    return plan_view(db, family)


@router.post("/families/{family_id}/plan/cancel", response_model=schemas.FamilyPlanView)
async def cancel_plan(family_id: str, db: DbSession = Depends(get_db)) -> schemas.FamilyPlanView:
    family = _family(db, family_id)
    row = db.get(FamilyPlan, family.id)
    if row is None:
        raise schemas.ApiError(409, "no_plan", "This family is on the free trial; there is nothing to cancel.")
    row.status, row.updated_at = "canceled", now_iso()
    db.commit()
    return plan_view(db, family)
