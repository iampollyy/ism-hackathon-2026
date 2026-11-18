"""Closing public sign-up, the security headers and the API docs switch
(services/limits.py check_signups_open, app/security_headers.py, main.py)."""

from fastapi.testclient import TestClient

from app.config import get_settings
from tests.conftest import family_payload

PASSWORD = "correct horse battery"


def close_signups(monkeypatch) -> None:
    monkeypatch.setenv("SIGNUPS_OPEN", "false")
    get_settings.cache_clear()


def test_signups_closed_refuses_new_accounts_and_anonymous_families(client, monkeypatch):
    close_signups(monkeypatch)
    response = client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": PASSWORD})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "signups_closed"

    response = client.post("/api/families", json=family_payload())
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "signups_closed"


def test_existing_accounts_still_log_in_create_families_and_invites_work(client, monkeypatch):
    # The account was made while sign-up was open (the hackathon).
    assert client.post("/api/auth/register",
                       json={"name": "Jon", "email": "jon@example.com", "password": PASSWORD}).status_code == 201
    client.post("/api/auth/logout")
    close_signups(monkeypatch)

    assert client.post("/api/auth/login", json={"email": "jon@example.com", "password": PASSWORD}).status_code == 200
    created = client.post("/api/families", json=family_payload())
    assert created.status_code == 201, created.text
    member_id = created.json()["members"][0]["id"]
    assert client.get(f"/api/join/{member_id}").status_code == 200


def test_signups_open_when_switched_on(client):
    # conftest sets SIGNUPS_OPEN=true, as a developer's local .env does.
    response = client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": PASSWORD})
    assert response.status_code == 201


def test_security_headers_on_every_response(client):
    for path in ("/api/health", "/api/auth/me", "/api/no-such-thing"):
        headers = client.get(path).headers
        assert headers["strict-transport-security"] == "max-age=31536000"
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["referrer-policy"] == "strict-origin-when-cross-origin"
        assert headers["x-frame-options"] == "DENY"
        assert headers["content-security-policy"] == "frame-ancestors 'none'"
        assert "microphone=(self)" in headers["permissions-policy"]
        assert "camera=()" in headers["permissions-policy"]


def test_api_docs_off_by_default_and_on_when_asked(monkeypatch):
    from app.main import create_app

    with TestClient(create_app()) as off:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert off.get(path).status_code == 404, path

    monkeypatch.setenv("API_DOCS", "true")
    get_settings.cache_clear()
    with TestClient(create_app()) as on:
        assert on.get("/openapi.json").status_code == 200
        assert on.get("/docs").status_code == 200
