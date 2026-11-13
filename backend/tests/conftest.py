"""Shared test fixtures.

- `client`: a TestClient on a fresh temporary SQLite database, with
  FAKE_ELEVENLABS on, the scheduler loop off, the live risk check off (its
  background `risk` events would race tests that list a call's events), and
  every outside API key blanked, so no test reaches the network by accident.
- `db`: a session on that same database, for setting up or checking rows.
- `make_family`: creates a family through the API and returns the response.
"""

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import db as app_db
from app.config import get_settings

TEST_ENV = {
    "FAKE_ELEVENLABS": "true",
    "SCHEDULER_ENABLED": "false",
    "RISK_CHECK_ENABLED": "false",  # tests/test_risk.py switches it on
    "ELEVENLABS_API_KEY": "",
    "OPENAI_API_KEY": "",
    "ANTHROPIC_API_KEY": "",
    "FIRECRAWL_API_KEY": "",
    "ELEVENLABS_WELCOME_AGENT_ID": "agent_welcome_test",
    "ELEVENLABS_PRACTICE_AGENT_ID": "agent_practice_test",
    "ELEVENLABS_FAMILY_LINE_AGENT_ID": "agent_family_line_test",
    "ELEVENLABS_POLICE_VOICE_ID": "voice_police_test",
    "ELEVENLABS_BANK_VOICE_ID": "voice_bank_test",
    "ELEVENLABS_NURSE_VOICE_ID": "voice_nurse_test",
}


@pytest.fixture(autouse=True)
def test_settings(tmp_path, monkeypatch) -> Iterator[None]:
    """Every test gets its own database and media folder."""
    for name, value in TEST_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("MEDIA_DIR", str(tmp_path / "media"))
    get_settings.cache_clear()
    app_db.reset_engine()
    app_db.init_db()
    yield
    app_db.reset_engine()
    get_settings.cache_clear()


@pytest.fixture
def client() -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db() -> Iterator[Session]:
    with app_db.new_session() as session:
        yield session


def family_payload(members: int = 2, consent: bool = True, safe_word_set: bool = True) -> dict[str, Any]:
    people = [("Sara", "mother", False), ("Jon", "son", True), ("Ana", "daughter", False), ("Ben", "father", False)]
    return {
        "name": "The Kovacs",
        "safe_word_set": safe_word_set,
        "members": [
            {"name": name, "relationship": relationship, "is_organiser": organiser, "consent_practice": consent}
            for name, relationship, organiser in people[:members]
        ],
    }


@pytest.fixture
def make_family(client: TestClient) -> Callable[..., dict[str, Any]]:
    """make_family(members=2, consent=True, safe_word_set=True) -> the 201 body:
    {"family_id": ..., "members": [{"id", "name", "phone_link"}, ...]}.
    Member 1 is Sara (mother), member 2 is Jon (son, organiser)."""

    def _make(members: int = 2, consent: bool = True, safe_word_set: bool = True) -> dict[str, Any]:
        response = client.post("/api/families", json=family_payload(members, consent, safe_word_set))
        assert response.status_code == 201, response.text
        return response.json()

    return _make
