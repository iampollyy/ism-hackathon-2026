"""Pricing and the family's plan, demo mode (app/routers/billing.py)."""


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
    assert chosen["plan"] == "family_monthly" and chosen["status"] == "active" and chosen["price"] == "€4.99 a month"
    assert client.get(f"/api/families/{fid}/plan").json()["plan"] == "family_monthly"
    canceled = client.post(f"/api/families/{fid}/plan/cancel").json()
    assert canceled["status"] == "canceled"


def test_bank_plan_needs_a_code(client) -> None:
    fid = client.post("/api/families", json=family_body()).json()["family_id"]
    bad = client.post(f"/api/families/{fid}/plan", json={"plan": "bank"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_bank_code"
    ok = client.post(f"/api/families/{fid}/plan", json={"plan": "bank", "bank_code": "demo-2026"}).json()
    assert ok["plan"] == "bank" and ok["bank_code"] == "DEMO-2026" and ok["price"] == "Free"


def test_unknown_family_and_cancel_without_plan(client) -> None:
    assert client.get("/api/families/fam_nope/plan").status_code == 404
    fid = client.post("/api/families", json=family_body()).json()["family_id"]
    assert client.post(f"/api/families/{fid}/plan/cancel").status_code == 409
    assert client.post(f"/api/families/{fid}/plan", json={"plan": "partner"}).status_code == 422
