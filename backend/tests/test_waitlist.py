"""The landing page's waitlist (app/routers/waitlist.py)."""


def test_join_and_count(client) -> None:
    assert client.post("/api/waitlist", json={"email": "Ana@Example.com"}).json() == {"ok": True}
    assert client.post("/api/waitlist", json={"email": "ana@example.com", "source": "hero"}).json() == {"ok": True}
    assert client.post("/api/waitlist", json={"email": "fraud@bank.test", "kind": "bank", "organisation": "A bank"}).status_code == 200
    assert client.get("/api/waitlist/count").json() == {"families": 1, "banks": 1}


def test_bad_email_is_refused(client) -> None:
    response = client.post("/api/waitlist", json={"email": "not-an-email"})
    assert response.status_code == 422 and response.json()["error"]["code"] == "invalid_request"


def test_daily_cap(client, monkeypatch) -> None:
    from app.routers import waitlist
    monkeypatch.setattr(waitlist, "DAILY_NEW_ROWS", 1)
    assert client.post("/api/waitlist", json={"email": "a@example.com"}).status_code == 200
    over = client.post("/api/waitlist", json={"email": "b@example.com"})
    assert over.status_code == 429 and over.json()["error"]["code"] == "daily_limit"
    assert client.post("/api/waitlist", json={"email": "a@example.com"}).status_code == 200  # an update, not a new row
