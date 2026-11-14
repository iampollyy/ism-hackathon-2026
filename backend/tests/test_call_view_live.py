"""The call view's family_id and the live answers before scoring (calls.call_view)."""

from app.routers import calls


def test_live_answers_take_the_first_outcome_and_the_last_consent() -> None:
    stored = [
        {"type": "turn", "data": {"speaker": "agent", "text": "Mum?"}},
        {"type": "outcome", "data": {"outcome": "not_a_real_outcome"}},
        {"type": "outcome", "data": {"outcome": "asked_safe_word", "seconds_to_challenge": 23.5}},
        {"type": "outcome", "data": {"outcome": "agreed", "seconds_to_challenge": 40.0}},
        {"type": "consent", "data": {"given": True}},
        {"type": "consent", "data": {"given": False}},
    ]
    assert calls.live_answers(stored) == {"outcome": "asked_safe_word", "seconds_to_challenge": 23.5, "consent": False}
    assert calls.live_answers([]) == {}


def test_call_view_has_family_id_and_live_outcome(client, make_family) -> None:
    family = make_family()
    sara = family["members"][0]["id"]
    voice_owner = family["members"][1]["id"]
    client.get(f"/api/members/{sara}/phone-state")
    import io
    client.post(f"/api/members/{voice_owner}/voice", files={"audio": ("v.webm", io.BytesIO(b"x" * 4096), "audio/webm")})
    started = client.post("/api/practice-calls", json={"target_member_id": sara, "voice_member_id": None,
                                                        "scenario": "bank_security", "difficulty": 1, "delay_seconds": 0})
    assert started.status_code == 201, started.text
    call_id = started.json()["call_id"]
    assert client.post(f"/api/calls/{call_id}/answer").status_code == 200
    client.post(f"/api/calls/{call_id}/events", json={"events": [{"type": "outcome", "outcome": "hung_up"}]})
    view = client.get(f"/api/calls/{call_id}").json()
    assert view["family_id"] == family["family_id"]
    assert view["live_outcome"] == "hung_up" and view["live_seconds_to_challenge"] is not None
    assert view["consent_given"] is None
