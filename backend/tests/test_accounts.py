"""Track 1: organiser accounts (register, log-in, log-out, me), the wrong
log-in limit, and families that belong to an account."""

import asyncio
import hashlib
from datetime import timedelta

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db import new_session, to_iso, utcnow
from app.models import Account, AuthSession, FamilyOwner, LoginFailure
from app.services import accounts

PASSWORD = "correct horse"


def family_payload() -> dict:
    return {
        "name": "The Kovacs",
        "safe_word_set": True,
        "members": [
            {"name": "Sara", "relationship": "mother", "consent_practice": True},
            {"name": "Jon", "relationship": "son", "is_organiser": True, "consent_practice": True},
        ],
    }


def register(client, email: str = "Jon@Example.com", password: str = PASSWORD, name: str = "Jon"):
    return client.post("/api/auth/register", json={"name": name, "email": email, "password": password})


def login(client, email: str = "jon@example.com", password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def cookie_header(response) -> str:
    headers = [value for value in response.headers.get_list("set-cookie") if value.startswith("cb_session=")]
    assert len(headers) == 1, response.headers
    return headers[0]


def error_code(response) -> str:
    return response.json()["error"]["code"]


# ---------------------------------------------------------------- passwords


def test_password_hash_carries_its_parameters_and_verifies():
    stored = accounts.hash_password(PASSWORD)
    assert stored.startswith("scrypt$16384$8$1$")
    assert PASSWORD not in stored
    assert accounts.verify_password(PASSWORD, stored)
    assert not accounts.verify_password("wrong horse", stored)
    assert accounts.hash_password(PASSWORD) != stored  # a new random salt each time


def test_a_hash_made_with_other_parameters_still_verifies():
    salt = b"0123456789abcdef"
    key = hashlib.scrypt(PASSWORD.encode(), salt=salt, n=2**10, r=8, p=1, dklen=32)
    stored = f"scrypt$1024$8$1${accounts._b64(salt)}${accounts._b64(key)}"
    assert accounts.verify_password(PASSWORD, stored)
    assert not accounts.verify_password("nope nope", stored)


def test_a_malformed_hash_is_a_mismatch():
    for stored in ("", "plain", "bcrypt$1$2$3$4$5", "scrypt$x$8$1$aa$bb", "scrypt$1000$8$1$aa$bb"):
        assert accounts.verify_password(PASSWORD, stored) is False


# ---------------------------------------------------------------- register, me, logout


def test_register_logs_in(client):
    response = register(client)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["account"]["email"] == "jon@example.com"  # lower-cased
    assert body["account"]["name"] == "Jon"
    assert body["account"]["id"].startswith("acc_")
    assert body["families"] == []

    header = cookie_header(response).lower()
    assert "httponly" in header and "samesite=lax" in header and "path=/" in header
    assert f"max-age={30 * 24 * 3600}" in header
    assert "secure" not in header  # plain http

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == body


def test_only_the_tokens_hash_is_stored(client):
    response = register(client)
    token = client.cookies.get("cb_session")
    assert token and len(token) >= 43  # 32 random bytes, URL-safe base64
    with new_session() as db:
        rows = db.scalars(select(AuthSession)).all()
        assert [row.token_hash for row in rows] == [hashlib.sha256(token.encode()).hexdigest()]
        assert rows[0].account_id == response.json()["account"]["id"]
        account = db.get(Account, rows[0].account_id)
        assert account.password_hash.startswith("scrypt$") and PASSWORD not in account.password_hash


def test_cookie_is_secure_over_https():
    from app.main import app

    with TestClient(app, base_url="https://testserver") as https_client:
        response = register(https_client)
        assert response.status_code == 201
        assert "secure" in cookie_header(response).lower()


def test_register_refuses_a_taken_email_in_any_case(client):
    assert register(client).status_code == 201
    response = register(client, email="  JON@example.COM ")
    assert (response.status_code, error_code(response)) == (409, "email_taken")


def test_register_checks_the_password_and_email(client):
    response = register(client, password="short")
    assert (response.status_code, error_code(response)) == (422, "password_too_short")
    response = register(client, email="not an email")
    assert (response.status_code, error_code(response)) == (422, "invalid_request")
    for name in ("", "   "):
        response = client.post("/api/auth/register", json={"name": name, "email": "a@b.co", "password": PASSWORD})
        assert (response.status_code, error_code(response)) == (422, "invalid_request"), name
    with new_session() as db:
        assert db.scalars(select(Account)).all() == []


def test_register_trims_the_name(client):
    response = register(client, name="  Jon Kovacs ")
    assert response.json()["account"]["name"] == "Jon Kovacs"


def test_me_without_a_session_is_401(client):
    response = client.get("/api/auth/me")
    assert (response.status_code, error_code(response)) == (401, "not_logged_in")
    client.cookies.set("cb_session", "made-up-token")
    response = client.get("/api/auth/me")
    assert (response.status_code, error_code(response)) == (401, "not_logged_in")


def test_logout_ends_the_session(client):
    register(client)
    response = client.post("/api/auth/logout")
    assert response.json() == {"ok": True}
    header = cookie_header(response).lower()
    assert "max-age=0" in header or "expires=" in header
    assert client.get("/api/auth/me").status_code == 401
    with new_session() as db:
        assert db.scalars(select(AuthSession)).all() == []
    assert client.post("/api/auth/logout").json() == {"ok": True}  # nobody logged in: still ok


def test_an_expired_session_is_401_and_deleted(client):
    register(client)
    with new_session() as db:
        row = db.scalars(select(AuthSession)).one()
        row.expires_at = to_iso(utcnow() - timedelta(seconds=1))
        db.commit()
    response = client.get("/api/auth/me")
    assert (response.status_code, error_code(response)) == (401, "not_logged_in")
    with new_session() as db:
        assert db.scalars(select(AuthSession)).all() == []


# ---------------------------------------------------------------- log-in


def test_login_sets_the_cookie(client):
    register(client)
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401
    response = login(client, email=" JON@example.com")
    assert response.status_code == 200, response.text
    assert response.json()["account"]["email"] == "jon@example.com"
    assert "httponly" in cookie_header(response).lower()
    assert client.get("/api/auth/me").json()["account"]["name"] == "Jon"


def test_wrong_password_and_unknown_email_get_the_same_answer(client):
    register(client)
    client.cookies.clear()
    wrong_password = login(client, password="wrong horse")
    unknown_email = login(client, email="nobody@example.com")
    for response in (wrong_password, unknown_email):
        assert (response.status_code, error_code(response)) == (401, "wrong_login")
        assert "set-cookie" not in response.headers
    assert wrong_password.json() == unknown_email.json()


def test_five_wrong_logins_lock_the_email_for_15_minutes(client):
    register(client)
    client.cookies.clear()
    for _ in range(5):
        assert error_code(login(client, password="wrong horse")) == "wrong_login"
    response = login(client)  # even the right password
    assert (response.status_code, error_code(response)) == (429, "too_many_attempts")
    assert client.get("/api/auth/me").status_code == 401
    # another email is not locked
    register(client, email="sara@example.com", name="Sara")
    client.cookies.clear()
    assert login(client, email="sara@example.com").status_code == 200

    # once the failures are older than the window, the right password works
    with new_session() as db:
        for row in db.scalars(select(LoginFailure).where(LoginFailure.email == "jon@example.com")):
            row.created_at = to_iso(utcnow() - timedelta(minutes=16))
        db.commit()
    assert login(client).status_code == 200


def test_a_right_password_resets_the_count(client):
    register(client)
    client.cookies.clear()
    for _ in range(4):
        login(client, password="wrong horse")
    assert login(client).status_code == 200
    with new_session() as db:
        assert db.scalars(select(LoginFailure)).all() == []
    for _ in range(4):
        login(client, password="wrong horse")
    assert login(client).status_code == 200


def test_failures_for_unknown_emails_count_too(client):
    for _ in range(5):
        assert error_code(login(client, email="ghost@example.com")) == "wrong_login"
    assert error_code(login(client, email="ghost@example.com")) == "too_many_attempts"


def test_the_limit_follows_the_settings(client, monkeypatch):
    monkeypatch.setenv("LOGIN_MAX_FAILURES", "2")
    monkeypatch.setenv("LOGIN_WINDOW_MINUTES", "5")
    get_settings.cache_clear()
    register(client)
    client.cookies.clear()
    login(client, password="wrong horse")
    login(client, password="wrong horse")
    response = login(client)
    assert error_code(response) == "too_many_attempts"
    assert "try again in 5 minutes" in response.json()["error"]["message"]


def test_the_429_message_names_the_window(client):
    for _ in range(5):
        login(client, email="ghost@example.com")
    response = login(client, email="ghost@example.com")
    assert response.json()["error"]["message"].endswith("try again in 15 minutes.")


async def test_parallel_wrong_logins_cannot_pass_the_limit_together():
    """Every attempt is counted before its password is checked, so a batch
    sent at once gets 5 wrong_login answers and the rest 429."""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
        created = await http.post("/api/auth/register", json={"name": "Jon", "email": "jon@example.com",
                                                              "password": PASSWORD})
        assert created.status_code == 201
        http.cookies.clear()
        answers = await asyncio.gather(*[
            http.post("/api/auth/login", json={"email": "jon@example.com", "password": "wrong horse"})
            for _ in range(30)
        ])
        codes = [error_code(answer) for answer in answers]
        assert codes.count("wrong_login") == 5
        assert codes.count("too_many_attempts") == 25
        right = await http.post("/api/auth/login", json={"email": "jon@example.com", "password": PASSWORD})
        assert error_code(right) == "too_many_attempts"


async def test_parallel_right_logins_all_work():
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
        await http.post("/api/auth/register", json={"name": "Jon", "email": "jon@example.com", "password": PASSWORD})
        http.cookies.clear()
        answers = await asyncio.gather(*[
            http.post("/api/auth/login", json={"email": "jon@example.com", "password": PASSWORD})
            for _ in range(4)
        ])
        assert [answer.status_code for answer in answers] == [200] * 4
    with new_session() as db:
        assert db.scalars(select(LoginFailure)).all() == []


def test_unknown_emails_never_hash_on_the_event_loop(monkeypatch):
    """The dummy hash for an email with no account is made inside
    check_password, which runs in the scrypt pool."""
    monkeypatch.setattr(accounts, "_dummy_hash", None)
    assert accounts.check_password(PASSWORD, None) is False
    assert accounts._dummy_hash is not None
    stored = accounts.hash_password(PASSWORD)
    assert accounts.check_password(PASSWORD, stored) is True
    assert accounts.check_password("wrong horse", stored) is False


async def test_scrypt_runs_in_its_own_pool():
    import threading

    name = await accounts.run_scrypt(lambda: threading.current_thread().name)
    assert name.startswith("scrypt")


# ---------------------------------------------------------------- families of an account


def test_a_family_made_while_logged_in_belongs_to_the_account(client):
    account_id = register(client).json()["account"]["id"]
    family = client.post("/api/families", json=family_payload()).json()
    with new_session() as db:
        owner = db.get(FamilyOwner, family["family_id"])
        assert owner is not None and owner.account_id == account_id

    me = client.get("/api/auth/me").json()
    assert me["families"] == [{"id": family["family_id"], "name": "The Kovacs"}]

    listed = client.get("/api/families")
    assert listed.status_code == 200
    [summary] = listed.json()["families"]
    assert summary["id"] == family["family_id"] and summary["name"] == "The Kovacs"
    assert summary["safe_word_set"] is True and summary["created_at"]
    assert (summary["member_count"], summary["joined_count"]) == (2, 0)

    sara = family["members"][0]["id"]
    client.post(f"/api/join/{sara}", json={"consent_practice": True, "consent_clone_from_call": False})
    assert client.get("/api/families").json()["families"][0]["joined_count"] == 1


def test_families_are_listed_oldest_first_and_only_the_accounts_own(client):
    register(client)
    first = client.post("/api/families", json=family_payload()).json()["family_id"]
    second = client.post("/api/families", json={**family_payload(), "name": "The Smiths"}).json()["family_id"]
    assert [f["id"] for f in client.get("/api/families").json()["families"]] == [first, second]

    client.cookies.clear()
    register(client, email="sara@example.com", name="Sara")
    assert client.get("/api/families").json() == {"families": []}
    assert client.get("/api/auth/me").json()["families"] == []


def test_families_still_work_without_a_session(client):
    response = client.post("/api/families", json=family_payload())
    assert response.status_code == 201
    with new_session() as db:
        assert db.scalars(select(FamilyOwner)).all() == []
    family_id = response.json()["family_id"]
    assert client.get(f"/api/families/{family_id}").status_code == 200  # readable by id
    listed = client.get("/api/families")
    assert (listed.status_code, error_code(listed)) == (401, "not_logged_in")


def test_an_owned_family_page_is_only_the_owners(client):
    register(client)
    family_id = client.post("/api/families", json=family_payload()).json()["family_id"]
    assert client.get(f"/api/families/{family_id}").json()["name"] == "The Kovacs"
    client.post("/api/auth/logout")
    response = client.get(f"/api/families/{family_id}")
    assert (response.status_code, error_code(response)) == (401, "not_logged_in")
    login(client)
    assert client.get(f"/api/families/{family_id}").json()["name"] == "The Kovacs"  # back after logging in
