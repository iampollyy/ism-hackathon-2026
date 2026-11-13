"""Track C tests: deciding the outcome by rule (backend.md). OWNER: track C."""

from datetime import datetime, timedelta, timezone

from app.services.outcome import decide_outcome, seconds_for

ANSWERED = datetime(2026, 11, 14, 10, 0, 0, tzinfo=timezone.utc)
ENDED = ANSWERED + timedelta(seconds=40)


def at(seconds: float) -> str:
    return (ANSWERED + timedelta(seconds=seconds)).isoformat()


def turn(seconds: float, speaker: str = "user", text: str = "hello") -> dict:
    return {"type": "turn", "t": seconds, "created_at": at(seconds), "data": {"speaker": speaker, "text": text}}


def outcome_event(seconds: float, outcome: str) -> dict:
    return {"type": "outcome", "t": seconds, "created_at": at(seconds), "data": {"outcome": outcome}}


def test_user_ended_before_any_outcome_is_hung_up_timed_to_the_end():
    events = [turn(2, "agent"), turn(5)]
    decision = decide_outcome(events, "user", ANSWERED, ENDED)
    assert decision.outcome == "hung_up"
    assert decision.seconds_to_challenge == 40.0


def test_agent_outcome_wins_and_is_timed_by_its_server_time():
    events = [turn(2, "agent"), outcome_event(12.5, "asked_safe_word"), outcome_event(20, "agreed")]
    decision = decide_outcome(events, "agent", ANSWERED, ENDED)
    assert decision.outcome == "asked_safe_word"
    assert decision.seconds_to_challenge == 12.5


def test_user_ending_after_the_outcome_keeps_the_agents_outcome():
    events = [outcome_event(8, "asked_personal_question")]
    decision = decide_outcome(events, "user", ANSWERED, ENDED)
    assert decision.outcome == "asked_personal_question"
    assert decision.seconds_to_challenge == 8.0


def test_no_outcome_and_not_ended_by_user_leaves_it_to_the_scorer():
    for ended_by in ("agent", "timeout", "error", None):
        decision = decide_outcome([turn(3)], ended_by, ANSWERED, ENDED)
        assert decision.outcome is None
        assert decision.seconds_to_challenge is None


def test_hesitated_and_agreed_have_no_seconds():
    for outcome in ("hesitated", "agreed"):
        decision = decide_outcome([outcome_event(30, outcome)], "agent", ANSWERED, ENDED)
        assert decision.outcome == outcome
        assert decision.seconds_to_challenge is None


def test_unknown_outcome_values_are_ignored():
    events = [{"type": "outcome", "t": 3, "created_at": at(3), "data": {"outcome": "panicked"}},
              outcome_event(9, "hung_up")]
    decision = decide_outcome(events, "agent", ANSWERED, ENDED)
    assert decision.outcome == "hung_up"
    assert decision.seconds_to_challenge == 9.0


def test_missing_answered_at_gives_no_seconds():
    decision = decide_outcome([outcome_event(5, "asked_safe_word")], "agent", None, ENDED)
    assert decision.outcome == "asked_safe_word"
    assert decision.seconds_to_challenge is None
    assert decide_outcome([], "user", None, ENDED).seconds_to_challenge is None


def test_event_without_created_at_falls_back_to_t():
    event = {"type": "outcome", "t": 7.25, "data": {"outcome": "hung_up"}}
    assert decide_outcome([event], "agent", ANSWERED, ENDED).seconds_to_challenge == 7.25


def test_seconds_for_a_scorer_outcome():
    assert seconds_for("hung_up", ANSWERED, ENDED) == 40.0
    assert seconds_for("asked_safe_word", ANSWERED, ENDED) is None
    assert seconds_for("agreed", ANSWERED, ENDED) is None


def test_the_stored_seconds_come_first():
    event = outcome_event(30, "asked_safe_word")
    event["data"]["seconds_to_challenge"] = 21.04
    assert decide_outcome([event], "agent", ANSWERED, ENDED).seconds_to_challenge == 21.0


def test_an_outcome_stored_after_the_end_is_capped_at_the_end():
    late = outcome_event(55, "hung_up")  # arrived in a batch 15 s after the 40 s call ended
    assert decide_outcome([late], "agent", ANSWERED, ENDED).seconds_to_challenge == 40.0
    late["data"]["seconds_to_challenge"] = 70.0
    assert decide_outcome([late], "agent", ANSWERED, ENDED).seconds_to_challenge == 40.0
