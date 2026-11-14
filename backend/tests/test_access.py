"""The family dashboard is the owner's (services/access.py): a family made
while logged in answers 401 without a session and 404 to another account;
a family without an owner, and the phone's own endpoints, stay open."""

from typing import Any

import pytest
from sqlalchemy import select

from app.db import new_session
from app.models import Member, MemberDrillSettings, ProtectionSettings
from app.services import access

PASSWORD = "correct horse"


def register(client: Any, name: str, email: str) -> str:
    """Register and return the session token (the client is logged in)."""
    response = client.post("/api/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client.cookies.get("cb_session")


def read_as(client: Any, token: str | None) -> None:
    """Make the next requests as this session, or as nobody."""
    client.cookies.clear()
    if token is not None:
        client.cookies.set("cb_session", token)


@pytest.fixture
def owned(client: Any) -> dict[str, str]:
    """Jon's family (Sara and Jon), and a second account, Eve. The client
    ends logged out."""
    jon_token = register(client, "Jon", "jon@example.com")
    body = client.post("/api/families", json={"name": "The Kovacs", "members": [
        {"name": "Sara", "relationship": "mother"},
        {"name": "Jon", "relationship": "son", "is_organiser": True}]}).json()
    client.cookies.clear()
    eve_token = register(client, "Eve", "eve@example.com")
    client.cookies.clear()
    return {"id": body["family_id"], "sara": body["members"][0]["id"], "jon": body["members"][1]["id"],
            "owner": jon_token, "other": eve_token}


def error(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["error"]["code"]


def requests(fam: dict[str, str]) -> dict[str, tuple[str, str, dict[str, Any] | None]]:
    return {
        "get family": ("GET", f"/api/families/{fam['id']}", None),
        "put protection": ("PUT", f"/api/families/{fam['id']}/protection", {"enabled": True}),
        "put drills": ("PUT", f"/api/members/{fam['sara']}/drills", {"paused": True}),
    }


def send(client: Any, method: str, url: str, body: dict[str, Any] | None) -> Any:
    return client.request(method, url, json=body)


def stored() -> tuple[bool, bool]:
    """(random drills on, Sara's drills paused) as stored."""
    with new_session() as db:
        settings = db.scalars(select(ProtectionSettings)).first()
        sara = db.scalars(select(MemberDrillSettings)).first()
        return bool(settings and settings.enabled), bool(sara and sara.paused)


# ---------------------------------------------------------------- the three readers


@pytest.mark.parametrize("what", ["get family", "put protection", "put drills"])
def test_anonymous_is_401_and_changes_nothing(client: Any, owned: dict[str, str], what: str) -> None:
    read_as(client, None)
    response = send(client, *requests(owned)[what])
    assert error(response) == (401, "not_logged_in")
    assert response.json()["error"]["message"] == "Please log in."
    assert stored() == (False, False)
    assert "Sara" not in response.text


@pytest.mark.parametrize("what", ["get family", "put protection", "put drills"])
def test_another_account_is_404_and_changes_nothing(client: Any, owned: dict[str, str], what: str) -> None:
    read_as(client, owned["other"])
    response = send(client, *requests(owned)[what])
    assert error(response) == (404, "not_found")
    assert stored() == (False, False)
    assert "Sara" not in response.text


def test_the_owner_reads_and_changes(client: Any, owned: dict[str, str]) -> None:
    read_as(client, owned["owner"])
    family = client.get(f"/api/families/{owned['id']}")
    assert family.status_code == 200 and family.json()["name"] == "The Kovacs"
    protection = client.put(f"/api/families/{owned['id']}/protection", json={"enabled": True})
    assert protection.status_code == 200 and protection.json()["enabled"] is True
    drills = client.put(f"/api/members/{owned['sara']}/drills", json={"paused": True})
    assert drills.status_code == 200 and drills.json()["paused"] is True
    assert stored() == (True, True)


def test_after_logging_out_the_family_is_closed_again(client: Any, owned: dict[str, str]) -> None:
    read_as(client, owned["owner"])
    assert client.get(f"/api/families/{owned['id']}").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert error(client.get(f"/api/families/{owned['id']}")) == (401, "not_logged_in")
    assert error(client.post(f"/api/families/{owned['id']}/surprise-drill", json={})) == (401, "not_logged_in")


# ---------------------------------------------------------------- every guarded path


def guarded_paths(fam: dict[str, str]) -> list[tuple[str, str, Any]]:
    family, sara = f"/api/families/{fam['id']}", f"/api/members/{fam['sara']}"
    return [
        ("GET", family, None),
        ("GET", f"{family}/protection", None),
        ("PUT", f"{family}/protection", {"enabled": False}),
        ("POST", f"{family}/surprise-drill", {}),
        ("POST", f"{family}/shield-call", {"member_id": fam["sara"]}),
        ("GET", f"{family}/drills", None),
        ("GET", f"{family}/activity", None),
        ("POST", f"{family}/news/refresh", None),
        ("GET", f"{family}/plan", None),
        ("POST", f"{family}/plan", {"plan": "family_yearly"}),
        ("POST", f"{family}/plan/cancel", None),
        ("POST", f"{family}/weekly-run", None),
        ("PUT", f"{sara}/drills", {"paused": True}),
        ("GET", f"{sara}/progress", None),
        ("POST", f"{sara}/consent", {"consent_practice": False}),
        ("POST", f"{sara}/voice", None),
    ]


def test_every_dashboard_path_needs_the_owner(client: Any, owned: dict[str, str]) -> None:
    for token, expected in ((None, (401, "not_logged_in")), (owned["other"], (404, "not_found"))):
        read_as(client, token)
        for method, url, body in guarded_paths(owned):
            assert error(client.request(method, url, json=body)) == expected, (method, url, token)
    with new_session() as db:
        assert db.get(Member, owned["sara"]).consent_practice_at is None


def test_the_phones_own_endpoints_stay_open(client: Any, owned: dict[str, str]) -> None:
    read_as(client, None)  # a phone has only the member id
    sara = owned["sara"]
    assert client.get(f"/api/join/{sara}").status_code == 200
    assert client.post(f"/api/join/{sara}", json={"consent_practice": True,
                                                  "consent_clone_from_call": True}).status_code == 200
    state = client.get(f"/api/members/{sara}/phone-state")
    assert state.status_code == 200
    welcome = state.json()["incoming_call"]  # the welcome call starts by itself
    assert welcome["kind"] == "welcome"
    assert client.get(f"/api/calls/{welcome['call_id']}").status_code == 200
    assert client.post(f"/api/calls/{welcome['call_id']}/decline").status_code == 200
    assert client.get(f"/api/families/{owned['id']}/news").status_code == 200  # the phone's News tab
    assert client.post(f"/api/members/{sara}/messages/read", json={}).status_code == 200
    assert client.get(f"/api/members/{sara}/voice-sample").status_code == 200
    assert client.post(f"/api/members/{sara}/alert", json={}).status_code == 200
    assert client.delete(f"/api/members/{sara}/voice").status_code == 200
    assert client.post(f"/api/members/{sara}/opt-out").status_code == 200


def test_a_family_without_an_owner_stays_open(client: Any, make_family: Any) -> None:
    body = make_family()
    family_id, sara = body["family_id"], body["members"][0]["id"]
    assert client.get(f"/api/families/{family_id}").status_code == 200
    assert client.put(f"/api/families/{family_id}/protection", json={"enabled": True}).status_code == 200
    assert client.put(f"/api/members/{sara}/drills", json={"paused": True}).status_code == 200
    assert client.get(f"/api/members/{sara}/progress").status_code == 200


def test_unknown_ids_get_the_routers_own_404(client: Any) -> None:
    assert client.get("/api/families/fam_nope").json() == {
        "error": {"code": "not_found", "message": "No family with this id."}}
    assert error(client.put("/api/members/mem_nope/drills", json={"paused": True})) == (404, "not_found")


def test_cors_preflight_is_not_checked(client: Any, owned: dict[str, str]) -> None:
    response = client.options(f"/api/families/{owned['id']}/protection", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT"})
    assert response.status_code == 200


@pytest.mark.parametrize("method, path, guarded", [
    ("GET", "/api/families/fam_1", ("family", "fam_1")),
    ("GET", "/api/families/fam_1/news", None),
    ("HEAD", "/api/families/fam_1/news", None),
    ("POST", "/api/families/fam_1/news/refresh", ("family", "fam_1")),
    ("POST", "/api/families/fam_1/news", ("family", "fam_1")),
    ("GET", "/api/families", None),
    ("POST", "/api/families", None),
    ("OPTIONS", "/api/families/fam_1", None),
    ("PUT", "/api/members/mem_1/drills", ("member", "mem_1")),
    ("GET", "/api/members/mem_1/progress", ("member", "mem_1")),
    ("POST", "/api/members/mem_1/consent", ("member", "mem_1")),
    ("POST", "/api/members/mem_1/voice", ("member", "mem_1")),
    ("DELETE", "/api/members/mem_1/voice", None),
    ("GET", "/api/members/mem_1/voice-sample", None),
    ("GET", "/api/members/mem_1/phone-state", None),
    ("POST", "/api/members/mem_1/alert", None),
    ("POST", "/api/members/mem_1/family-line", None),
    ("POST", "/api/members/mem_1/opt-out", None),
    ("POST", "/api/members/mem_1/welcome-call", None),
    ("POST", "/api/calls/call_1/end", None),
    ("GET", "/api/join/mem_1", None),
])
def test_which_paths_are_guarded(method: str, path: str, guarded: tuple[str, str] | None) -> None:
    assert access.guarded(method, path) == guarded
