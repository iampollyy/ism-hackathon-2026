"""Track 4: the learning content (services/learn.py, app/content/)."""

import json
import re
from pathlib import Path
from typing import Any

import pytest

from app import schemas
from app.agents import risk
from app.services import briefs, learn

CONTENT = Path(learn.CONTENT_DIR)


def test_tactics_endpoint(client: Any) -> None:
    items = client.get("/api/learn/tactics").json()["tactics"]
    assert [item["key"] for item in items] == list(schemas.RISK_SIGNALS)  # eight tactics, then three signals
    assert [item["kind"] for item in items] == ["tactic"] * 8 + ["signal"] * 3
    for item in items:
        assert item["label"] == schemas.RISK_SIGNAL_LABELS[item["key"]]
        assert item["level"] == risk.level_for([item["key"]])
        assert len(item["what_it_sounds_like"]) == 2
        assert all(line.strip() for line in item["what_it_sounds_like"])
        assert item["why_it_works"].strip() and item["what_to_do"].strip()
    levels = {item["key"]: item["level"] for item in items}
    assert levels["urgency"] == "yellow" and levels["asks_for_code"] == "red"


def test_tactics_file_matches_the_code() -> None:
    entries = json.loads((CONTENT / "tactics.json").read_text(encoding="utf-8"))
    assert sorted(entry["key"] for entry in entries) == sorted(schemas.RISK_SIGNALS)
    for entry in entries:
        assert entry["label"] == schemas.RISK_SIGNAL_LABELS[entry["key"]], entry["key"]
        assert len(entry["what_it_sounds_like"]) == 2, entry["key"]
        assert all(len(line.split()) <= 15 for line in entry["what_it_sounds_like"]), entry["key"]


@pytest.mark.parametrize("name", ["tactics.json", "habits.json"])
def test_content_is_plain_and_safe(name: str) -> None:
    text = (CONTENT / name).read_text(encoding="utf-8")
    assert not briefs.INSTITUTION_PATTERN.search(text)  # no real bank, police force or company
    assert not briefs.FORBIDDEN_TOPIC.search(text)  # nothing frightening
    assert not briefs.DIGIT_RUN.search(text) and not briefs.LINK.search(text)
    assert not re.search(r"\bstupid|\bfool|\bgullible|\bnaive", text, re.IGNORECASE)


def test_habits_endpoint(client: Any) -> None:
    habits = client.get("/api/learn/habits").json()["habits"]
    assert [habit["key"] for habit in habits] == [
        "hang_up_and_call_back", "ask_for_the_family_word", "never_share_codes", "take_your_time"]
    assert [habit["title"] for habit in habits] == [
        "Hang up and call back", "Ask for the family word", "Never share codes", "Take your time"]
    assert all(habit["line"].strip() and len(habit["line"].split()) <= 25 for habit in habits)


def test_missing_or_broken_content_is_a_clean_error(client: Any, tmp_path: Path,
                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(learn, "CONTENT_DIR", tmp_path)

    def code(path: str) -> tuple[int, str]:
        response = client.get(path)
        return response.status_code, response.json()["error"]["code"]

    assert code("/api/learn/tactics") == (503, "content_unavailable")  # no file
    (tmp_path / "habits.json").write_text("{not json", encoding="utf-8")
    assert code("/api/learn/habits") == (503, "content_unavailable")
    (tmp_path / "habits.json").write_text(json.dumps([{"key": "x", "title": "", "line": "y"}]), encoding="utf-8")
    assert code("/api/learn/habits") == (503, "content_unavailable")

    entries = json.loads((CONTENT / "tactics.json").read_text(encoding="utf-8"))
    (tmp_path / "tactics.json").write_text(json.dumps(entries[:-1]), encoding="utf-8")  # a key missing
    assert code("/api/learn/tactics") == (503, "content_unavailable")
    entries[0]["what_it_sounds_like"] = "one line, not a list"
    (tmp_path / "tactics.json").write_text(json.dumps(entries), encoding="utf-8")
    assert code("/api/learn/tactics") == (503, "content_unavailable")
    entries[0]["what_it_sounds_like"] = ["One.", "Two.", "Three."]
    (tmp_path / "tactics.json").write_text(json.dumps(entries), encoding="utf-8")
    assert len(client.get("/api/learn/tactics").json()["tactics"][0]["what_it_sounds_like"]) == 2
