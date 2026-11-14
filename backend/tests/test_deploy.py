"""Daily caps (services/limits.py) and serving the built front end (main.mount_frontend)."""

import io

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings


def family_body(name: str = "The Kovacs") -> dict:
    return {"name": name, "safe_word_set": True, "members": [
        {"name": "Sara", "relationship": "mother", "consent_practice": True},
        {"name": "Jon", "relationship": "son", "is_organiser": True, "consent_practice": True},
    ]}


def test_no_caps_by_default(client) -> None:
    for i in range(3):
        assert client.post("/api/families", json=family_body(f"F{i}")).status_code == 201


def test_family_cap(client, monkeypatch) -> None:
    monkeypatch.setenv("DAILY_FAMILY_LIMIT", "2")
    get_settings.cache_clear()
    assert client.post("/api/families", json=family_body("A")).status_code == 201
    assert client.post("/api/families", json=family_body("B")).status_code == 201
    over = client.post("/api/families", json=family_body("C"))
    assert over.status_code == 429
    assert over.json()["error"]["code"] == "daily_limit"


def test_clone_cap_stops_before_cloning(client, monkeypatch) -> None:
    family = client.post("/api/families", json=family_body()).json()
    jon = family["members"][1]["id"]
    monkeypatch.setenv("DAILY_CLONE_LIMIT", "1")
    get_settings.cache_clear()
    from app.routers import voice

    calls = []

    async def fake_clone(name, path):
        calls.append(name)
        return "voice_fake"

    async def fake_clean(original, target):
        return original

    monkeypatch.setattr(voice.elevenlabs, "clone_voice", fake_clone)
    monkeypatch.setattr(voice.audio_service, "clean_recording", fake_clean)
    upload = {"audio": ("me.webm", io.BytesIO(b"x" * 2048), "audio/webm")}
    assert client.post(f"/api/members/{jon}/voice", files=upload).status_code == 200
    upload = {"audio": ("me.webm", io.BytesIO(b"x" * 2048), "audio/webm")}
    over = client.post(f"/api/members/{jon}/voice", files=upload)
    assert over.status_code == 429 and over.json()["error"]["code"] == "daily_limit"
    assert len(calls) == 1


def test_call_cap_on_welcome_calls(client, monkeypatch) -> None:
    family = client.post("/api/families", json=family_body()).json()
    sara, jon = family["members"][0]["id"], family["members"][1]["id"]
    client.get(f"/api/members/{sara}/phone-state")
    client.get(f"/api/members/{jon}/phone-state")
    monkeypatch.setenv("DAILY_CALL_LIMIT", "1")
    get_settings.cache_clear()
    assert client.post(f"/api/members/{sara}/welcome-call").status_code == 201
    over = client.post(f"/api/members/{jon}/welcome-call")
    assert over.status_code == 429 and over.json()["error"]["code"] == "daily_limit"


@pytest.fixture
def dist(tmp_path):
    folder = tmp_path / "dist"
    (folder / "assets").mkdir(parents=True)
    (folder / "index.html").write_text("<html>app</html>")
    (folder / "assets" / "app-123.js").write_text("console.log(1)")
    (folder / "sw.js").write_text("self.addEventListener('push', () => {})")
    (tmp_path / "secret.txt").write_text("nope")
    return folder


def test_frontend_is_served_with_spa_fallback(client, monkeypatch, dist) -> None:
    monkeypatch.setenv("FRONTEND_DIST", str(dist))
    get_settings.cache_clear()
    from app.main import create_app

    with TestClient(create_app()) as app_client:
        index = app_client.get("/")
        assert index.status_code == 200 and "app" in index.text
        assert index.headers["cache-control"] == "no-cache"
        assert app_client.get("/phone/mem_abc").text == "<html>app</html>"
        asset = app_client.get("/assets/app-123.js")
        assert asset.status_code == 200 and "immutable" in asset.headers["cache-control"]
        assert app_client.get("/sw.js").headers["cache-control"] == "no-cache"
        assert "nope" not in app_client.get("/../secret.txt").text
        assert "nope" not in app_client.get("/%2e%2e/secret.txt").text
        missing = app_client.get("/api/nothing-here")
        assert missing.status_code == 404 and missing.json()["error"]["code"] == "not_found"
        assert app_client.get("/api/health").json()["ok"] is True


def test_no_frontend_route_without_the_setting(client) -> None:
    assert client.get("/phone/mem_abc").status_code == 404
