"""Pricing and the family's plan, demo mode (app/routers/billing.py)."""

from datetime import timedelta

from app.db import new_session, to_iso, utcnow
from app.models import Family, FamilyPlan


def family_body() -> dict:
    return {"name": "The Kovacs", "safe_word_set": True, "members": [
        {"name": "Sara", "relationship": "mother", "consent_practice": True},
        {"name": "Jon", "relationship": "son", "is_organiser": True, "consent_practice": True},
    ]}


def test_pricing_lists_plans_and_says_demo(client) -> None:
    body = client.get("/api/pricing").json()
    keys = [p["key"] for p in body["plans"]]
    assert keys == ["family_monthly", "family_yearly", "bank", "partner"]
    assert body["trial_days"] == 30 and "no payment" in body["demo_note"].lower()
    assert [p["choosable"] for p in body["plans"]] == [True, True, True, False]


def test_new_family_is_on_a_trial(client) -> None:
    family = client.post("/api/families", json=family_body()).json()
    plan = client.get(f"/api/families/{family['family_id']}/plan").json()
    assert plan["plan"] == "trial" and plan["status"] == "trialing" and plan["trial_ends_at"]
    assert plan["demo"] is True


def test_choose_monthly_then_cancel(client) -> None:
    fid = client.post("/api/families", json=family_body()).json()["family_id"]
    chosen = client.post(f"/api/families/{fid}/plan", json={"plan": "family_monthly"}).json()
    assert chosen["plan"] == "family_monthly" and chosen["price"] == "€4.99 a month"
    assert client.get(f"/api/families/{fid}/plan").json()["plan"] == "family_monthly"
    canceled = client.post(f"/api/families/{fid}/plan/cancel").json()
    assert canceled["status"] == "canceled"


def test_choosing_a_paid_plan_keeps_the_trial_running(client) -> None:
    fid = client.post("/api/families", json=family_body()).json()["family_id"]
    trial = client.get(f"/api/families/{fid}/plan").json()
    for choice, name, price in (("family_yearly", "Family, yearly", "€49 a year"),
                                ("family_monthly", "Family", "€4.99 a month")):
        chosen = client.post(f"/api/families/{fid}/plan", json={"plan": choice}).json()
        assert chosen == {**trial, "plan": choice, "plan_name": name, "price": price}, \
            "still trialing to the same day, with the chosen plan after it"
        assert client.get(f"/api/families/{fid}/plan").json() == chosen


def test_a_paid_plan_starts_when_the_trial_ends(client) -> None:
    fid = client.post("/api/families", json=family_body()).json()["family_id"]
    client.post(f"/api/families/{fid}/plan", json={"plan": "family_yearly"})
    with new_session() as db:
        family = db.get(Family, fid)
        trial_end = utcnow() - timedelta(days=1)
        family.created_at = to_iso(trial_end - timedelta(days=30))
        db.get(FamilyPlan, fid).started_at = to_iso(trial_end - timedelta(days=20))
        db.commit()
    plan = client.get(f"/api/families/{fid}/plan").json()
    assert (plan["plan"], plan["status"], plan["trial_ends_at"]) == ("family_yearly", "active", None)
    assert plan["started_at"] == to_iso(trial_end)


def test_bank_plan_needs_the_partner_banks_code(client) -> None:
    fid = client.post("/api/families", json=family_body()).json()["family_id"]
    for code in (None, "", "  ", "WRONG1", "NOTACODE", "demo-2026", "DEMO-BANKX"):
        body = {"plan": "bank"} if code is None else {"plan": "bank", "bank_code": code}
        bad = client.post(f"/api/families/{fid}/plan", json=body)
        assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_bank_code", code
        assert "DEMO-BANK" in bad.json()["error"]["message"]
    assert "isn't from a partner bank" in client.post(
        f"/api/families/{fid}/plan", json={"plan": "bank", "bank_code": "WRONG1"}).json()["error"]["message"]
    assert client.get(f"/api/families/{fid}/plan").json()["plan"] == "trial", "a wrong code changes nothing"
    ok = client.post(f"/api/families/{fid}/plan", json={"plan": "bank", "bank_code": " demo-bank "}).json()
    assert ok["plan"] == "bank" and ok["status"] == "active" and ok["bank_code"] == "DEMO-BANK"
    assert ok["price"] == "Free" and ok["trial_ends_at"] is None


def test_unknown_family_and_cancel_without_plan(client) -> None:
    assert client.get("/api/families/fam_nope/plan").status_code == 404
    fid = client.post("/api/families", json=family_body()).json()["family_id"]
    assert client.post(f"/api/families/{fid}/plan/cancel").status_code == 409
    assert client.post(f"/api/families/{fid}/plan", json={"plan": "partner"}).status_code == 422
