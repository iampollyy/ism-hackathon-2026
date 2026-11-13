"""Track C tests: the readiness scale and the planner's allowed choices (ai.md). OWNER: track C."""

import pytest

from app.services import readiness

MID = {"verify_first": 1, "safe_word": 1, "trusted_contact": 1, "payment_caution": 1, "under_pressure": 1}

SCENARIOS = [
    {"key": "bank_security", "voice": "ELEVENLABS_BANK_VOICE_ID", "allowed_tactics": ["authority", "small_ask_first", "urgency"]},
    {"key": "hospital", "voice": "ELEVENLABS_NURSE_VOICE_ID", "allowed_tactics": ["emotional_appeal", "urgency"]},
    {"key": "police", "voice": "ELEVENLABS_POLICE_VOICE_ID", "allowed_tactics": ["authority", "secrecy", "isolation"]},
    {"key": "relative_new_number", "voice": "clone", "allowed_tactics": ["new_number", "urgency", "secrecy"]},
]


@pytest.mark.parametrize("seconds, under_pressure", [(10.0, 2), (30.0, 2), (30.1, 1), (None, 1)])
def test_asked_safe_word(seconds, under_pressure):
    new = readiness.apply_result(MID, "asked_safe_word", seconds, None)
    assert new == {**MID, "verify_first": 2, "under_pressure": under_pressure, "safe_word": 2}


@pytest.mark.parametrize("seconds, under_pressure", [(5.0, 2), (45.0, 1)])
def test_hung_up(seconds, under_pressure):
    new = readiness.apply_result(MID, "hung_up", seconds, None)
    assert new == {**MID, "verify_first": 2, "under_pressure": under_pressure}


def test_asked_personal_question_keeps_a_two():
    assert readiness.apply_result(MID, "asked_personal_question", 5, None)["verify_first"] == 1
    high = {**MID, "verify_first": 2, "under_pressure": 2}
    new = readiness.apply_result(high, "asked_personal_question", 5, None)
    assert new["verify_first"] == 2
    assert new["under_pressure"] == 1


def test_hesitated():
    high = {key: 2 for key in MID}
    new = readiness.apply_result(high, "hesitated", None, None)
    assert new == {**high, "verify_first": 1, "under_pressure": 1}


def test_agreed():
    high = {key: 2 for key in MID}
    new = readiness.apply_result(high, "agreed", None, None)
    assert new == {**high, "verify_first": 0, "under_pressure": 0, "payment_caution": 0}


@pytest.mark.parametrize("callback, trusted", [(12.0, 2), (60.0, 2), (61.0, 1), (None, 1), (-3.0, 1)])
def test_family_number_within_a_minute(callback, trusted):
    assert readiness.apply_result(MID, "hesitated", None, callback)["trusted_contact"] == trusted
    assert readiness.apply_callback(MID, callback)["trusted_contact"] == trusted


def test_scores_are_clamped_and_completed():
    messy = {"verify_first": 7, "safe_word": -2, "payment_caution": "x", "unknown_key": 2}
    new = readiness.apply_result(messy, "unknown_outcome", None, None)
    assert new == {"verify_first": 2, "safe_word": 0, "trusted_contact": 0, "payment_caution": 0, "under_pressure": 0}


def test_inputs_are_not_changed():
    scores = dict(MID)
    readiness.apply_result(scores, "agreed", None, 10)
    readiness.apply_callback(scores, 10)
    assert scores == MID


def test_items_round_trip():
    items = readiness.items_from_scores({"verify_first": 2, "safe_word": 5}, {"verify_first": "hung up at once"})
    assert [item["key"] for item in items] == list(readiness.READINESS_KEYS)
    assert items[0] == {"key": "verify_first", "score": 2, "evidence": "hung up at once"}
    assert items[1] == {"key": "safe_word", "score": 2}
    assert readiness.scores_from_items(items)["safe_word"] == 2
    assert readiness.total({"verify_first": 2, "safe_word": 5}) == 4
    assert readiness.scores_from_items("not a list") == {key: 0 for key in readiness.READINESS_KEYS}


# ---------------------------------------------------------------- the planner's choices


@pytest.mark.parametrize("trusts, scenario", [
    ("bank", "bank_security"), ("police", "police"), ("hospital", "hospital"),
    ("family", "relative_new_number"), ("unknown", "relative_new_number"), (None, "relative_new_number"),
])
def test_first_practice_matches_who_they_trust(trusts, scenario):
    choice = readiness.next_practice(trusts, [], SCENARIOS)
    assert choice.scenarios == [scenario]
    assert choice.difficulty == 1
    assert choice.reason == "first"


def test_first_practice_falls_back_when_the_scenario_is_missing():
    only_relative = [SCENARIOS[3]]
    assert readiness.next_practice("hospital", [], only_relative).scenarios == ["relative_new_number"]
    assert readiness.next_practice("bank", [], []).scenarios == ["relative_new_number"]


@pytest.mark.parametrize("outcome", ["agreed", "hesitated"])
def test_after_going_along_same_tactic_different_story_same_difficulty(outcome):
    history = [{"scenario": "bank_security", "difficulty": 2, "outcome": outcome, "leading_tactic": "authority"}]
    choice = readiness.next_practice("bank", history, SCENARIOS)
    assert choice.scenarios[0] == "police"  # the other scenario that allows authority
    assert "bank_security" not in choice.scenarios
    assert choice.difficulty == 2
    assert choice.leading_tactic == "authority"
    assert choice.reason == "repeat_tactic"


def test_after_a_safe_result_a_new_story():
    history = [{"scenario": "relative_new_number", "difficulty": 1, "outcome": "hung_up", "leading_tactic": "new_number"},
               {"scenario": "bank_security", "difficulty": 1, "outcome": "agreed", "leading_tactic": "authority"},
               {"scenario": "police", "difficulty": 1, "outcome": "asked_safe_word", "leading_tactic": "authority"}]
    choice = readiness.next_practice("family", history, SCENARIOS)
    assert choice.scenarios == ["hospital"]
    assert choice.reason == "new_story"
    assert choice.difficulty == 1


def test_two_safe_results_in_a_row_raise_the_difficulty_up_to_three():
    def safe(scenario: str, difficulty: int) -> dict:
        return {"scenario": scenario, "difficulty": difficulty, "outcome": "hung_up", "leading_tactic": None}

    assert readiness.next_practice("family", [safe("police", 1), safe("bank_security", 1)], SCENARIOS).difficulty == 2
    # One safe result at the new level is not yet two in a row at it.
    raised = [safe("police", 1), safe("bank_security", 1), safe("hospital", 2)]
    assert readiness.next_practice("family", raised, SCENARIOS).difficulty == 2
    top = [safe("police", 3), safe("bank_security", 3)]
    assert readiness.next_practice("family", top, SCENARIOS).difficulty == 3
