"""Track C tests: the model layer and every job's checks and fallbacks.
No network: llm._call or llm.run_job is replaced. OWNER: track C."""

from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import respx
from pydantic import BaseModel
from sqlalchemy import select

from app.agents import digest, director, llm, planner, profiler, scorer, shapes
from app.config import get_settings
from app.db import new_session
from app.models import ModelRun
from app.schemas import OUTCOMES, READINESS_KEYS
from app.services import firecrawl


class FakeRunJob:
    """Replaces llm.run_job: returns the queued output for a job, or None."""

    def __init__(self, outputs: dict[str, Any] | None = None) -> None:
        self.outputs = outputs or {}
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, job: str, *, system: str, user: str, schema: type[BaseModel],
                       prompt_version: str, max_tokens: int = 8000) -> BaseModel | None:
        self.calls.append({"job": job, "user": user, "system": system, "prompt_version": prompt_version})
        output = self.outputs.get(job)
        if isinstance(output, Exception):
            raise output
        return schema.model_validate(output) if isinstance(output, dict) else output


@pytest.fixture
def fake_jobs(monkeypatch: pytest.MonkeyPatch) -> FakeRunJob:
    fake = FakeRunJob()
    monkeypatch.setattr(llm, "run_job", fake)
    return fake


def set_keys(monkeypatch: pytest.MonkeyPatch, anthropic: str = "", openai: str = "") -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", anthropic)
    monkeypatch.setenv("OPENAI_API_KEY", openai)
    get_settings.cache_clear()


def rows() -> list[ModelRun]:
    with new_session() as db:
        return list(db.scalars(select(ModelRun).order_by(ModelRun.id)))


# ---------------------------------------------------------------- llm.run_job


async def test_no_keys_means_no_attempt_and_none(monkeypatch: pytest.MonkeyPatch) -> None:
    async def never(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("no model should be called without keys")

    monkeypatch.setattr(llm, "_call", never)
    assert await llm.run_job("scorer", system="s", user="u", schema=shapes.WeeklyNote, prompt_version="x.v1") is None
    assert rows() == []


async def test_first_model_fails_second_answers_and_both_are_logged(monkeypatch: pytest.MonkeyPatch) -> None:
    set_keys(monkeypatch, anthropic="sk-ant-test", openai="sk-test")
    tried: list[str] = []

    async def call(job: str, model: str, *args: Any) -> llm.Answer:
        tried.append(model)
        if model.startswith("claude"):
            raise RuntimeError("overloaded")
        return llm.Answer(shapes.WeeklyNote(text="hello"), 10, 3)

    monkeypatch.setattr(llm, "_call", call)
    result = await llm.run_job("scorer", system="s", user="the input", schema=shapes.WeeklyNote,
                               prompt_version="scorer.v1")
    assert result == shapes.WeeklyNote(text="hello")
    assert tried == ["claude-haiku-5-5", "gpt-6-luna"]
    logged = rows()
    assert [(row.model, row.ok) for row in logged] == [("claude-haiku-5-5", False), ("gpt-6-luna", True)]
    assert "overloaded" in logged[0].error
    assert "the input" in logged[1].input_json and "hello" in logged[1].output_json
    assert logged[1].input_tokens == 10 and logged[1].output_tokens == 3


async def test_a_missing_key_skips_that_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    set_keys(monkeypatch, anthropic="sk-ant-test")
    tried: list[str] = []

    async def call(job: str, model: str, *args: Any) -> llm.Answer:
        tried.append(model)
        raise RuntimeError("down")

    monkeypatch.setattr(llm, "_call", call)
    assert await llm.run_job("scorer", system="s", user="u", schema=shapes.WeeklyNote, prompt_version="v") is None
    assert tried == ["claude-haiku-5-5"]
    assert len(rows()) == 1


async def test_time_limit_and_wrong_type_count_as_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    set_keys(monkeypatch, anthropic="sk-ant-test", openai="sk-test")
    monkeypatch.setitem(llm.JOB_SECONDS, "scorer", 0.05)

    async def call(job: str, model: str, *args: Any) -> llm.Answer:
        if model.startswith("claude"):
            import asyncio
            await asyncio.sleep(1)
        return llm.Answer(shapes.Brief(caller_claim="x", address_as="x", opening_line="x", scenario_brief="x",
                                       ask="x", tactic_order=[]))

    monkeypatch.setattr(llm, "_call", call)
    assert await llm.run_job("scorer", system="s", user="u", schema=shapes.WeeklyNote, prompt_version="v") is None
    errors = [row.error for row in rows()]
    assert "timed out" in errors[0] and "not WeeklyNote" in errors[1]


async def test_a_cancelled_attempt_is_logged_and_cancellation_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    set_keys(monkeypatch, anthropic="sk-ant-test", openai="sk-test")

    async def call(job: str, model: str, *args: Any) -> llm.Answer:
        await asyncio.sleep(5)
        raise AssertionError("should have been cancelled")

    monkeypatch.setattr(llm, "_call", call)
    with pytest.raises(TimeoutError):  # the caller's own, shorter limit
        await asyncio.wait_for(llm.run_job("director", system="s", user="u", schema=shapes.WeeklyNote,
                                           prompt_version="v"), 0.05)
    logged = rows()
    assert [(row.model, row.ok, row.error) for row in logged] == [("claude-haiku-5-5", False, "cancelled")]


async def test_claude_refusal_is_no_answer() -> None:
    async def parse(**kwargs: Any) -> Any:
        assert kwargs["output_format"] is shapes.WeeklyNote
        assert kwargs["output_config"] == {"effort": "low"}  # a fast job
        return SimpleNamespace(stop_reason="refusal", parsed_output=shapes.WeeklyNote(text="x"), usage=None)

    client = SimpleNamespace(messages=SimpleNamespace(parse=parse))
    answer = await llm._call_claude(client, "scorer", "claude-haiku-5-5", "s", "u", shapes.WeeklyNote, 100)
    assert answer.parsed is None and answer.note == "refusal"


async def test_careful_jobs_send_no_effort_setting() -> None:
    async def parse(**kwargs: Any) -> Any:
        assert "output_config" not in kwargs
        return SimpleNamespace(stop_reason="end_turn", parsed_output=shapes.WeeklyNote(text="x"),
                               usage=SimpleNamespace(input_tokens=1, output_tokens=2))

    client = SimpleNamespace(messages=SimpleNamespace(parse=parse))
    answer = await llm._call_claude(client, "planner", "claude-opus-5-5", "s", "u", shapes.WeeklyNote, 100)
    assert answer.parsed == shapes.WeeklyNote(text="x") and answer.output_tokens == 2


def test_prompts_models_and_providers() -> None:
    for job in ("profiler", "planner", "director", "scorer", "digest", "weekly_note"):
        assert len(llm.load_prompt(job)) > 200
    assert llm.job_models("weekly_note") == get_settings().job_models("scorer")
    assert llm.job_models("no_such_job") == []
    assert llm.provider_of("gpt-6-astra") == "openai"
    assert llm.provider_of("claude-opus-5-5") == "anthropic"


# ---------------------------------------------------------------- profiler


async def test_profiler_fallback(fake_jobs: FakeRunJob) -> None:
    profile = await profiler.build_profile("Callback: hi\nSara: yes", True)
    assert profile["consent_practice"] is True and profile["source"] == "fallback"
    assert [item["score"] for item in profile["items"]] == [0] * 5
    assert (await profiler.build_profile("Callback: hi", None))["consent_practice"] is False
    assert (await profiler.build_profile("   ", True))["consent_practice"] is True
    assert len(fake_jobs.calls) == 2, "a blank transcript asks no model"


async def test_profiler_checks_the_model_output(fake_jobs: FakeRunJob) -> None:
    fake_jobs.outputs["profiler"] = {
        "consent_practice": True, "consent_quote": "Yes.", "trusts_most": "police",
        "said": " ".join(["word"] * 40), "weak_spot": "",
        "items": [{"key": "verify_first", "score": 4, "evidence": " ".join(["e"] * 30)},
                  {"key": "verify_first", "score": 0, "evidence": "duplicate"},
                  {"key": "safe_word", "score": -1, "evidence": ""}],
    }
    profile = await profiler.build_profile("Callback: hi\nSara: yes", None)
    scores = {item["key"]: item["score"] for item in profile["items"]}
    assert scores == {"verify_first": 2, "safe_word": 0, "trusted_contact": 0, "payment_caution": 0, "under_pressure": 0}
    assert [item["key"] for item in profile["items"]] == list(READINESS_KEYS)
    assert len(profile["items"][0]["evidence"].split()) == 15
    assert profile["items"][1]["evidence"] == "not answered"
    assert len(profile["said"].split()) == 20
    assert profile["weak_spot"] == profiler.FALLBACK_WEAK_SPOT
    assert profile["consent_practice"] is True
    # An explicit no in the consent event wins over the model's yes.
    assert (await profiler.build_profile("Callback: hi\nSara: no", False))["consent_practice"] is False


# ---------------------------------------------------------------- scorer


@pytest.mark.parametrize("outcome", OUTCOMES)
async def test_scorer_fallback_has_a_fixed_lesson_per_outcome(fake_jobs: FakeRunJob, outcome: str) -> None:
    score = await scorer.score_call("Caller: hi", {"rule_outcome": outcome, "tactics_marked": ["urgency", "bogus"]})
    assert score["outcome"] == outcome
    assert score["lesson"] == scorer.LESSONS[outcome]
    assert len(score["lesson"].split()) <= 20 and "family" in score["lesson"]
    assert score["debrief"].count(".") >= 3
    assert score["tactics_used"] == ["urgency"] and score["tactics_worked"] == []
    assert score["scorer_version"] == "fallback"


async def test_scorer_without_rule_or_model_says_hesitated(fake_jobs: FakeRunJob) -> None:
    assert (await scorer.score_call("Caller: hi", {}))["outcome"] == "hesitated"
    assert (await scorer.score_call("", {"rule_outcome": "agreed"}))["outcome"] == "agreed"
    fake_jobs.outputs["scorer"] = RuntimeError("boom")
    assert (await scorer.score_call("Caller: hi", {"rule_outcome": "hung_up"}))["lesson"] == scorer.LESSONS["hung_up"]


async def test_scorer_keeps_the_model_words_and_checks_them(fake_jobs: FakeRunJob) -> None:
    fake_jobs.outputs["scorer"] = {"outcome": "agreed", "tactics_used": ["urgency", "urgency"],
                                   "tactics_worked": ["urgency"], "lesson": "Hang up and ring the family number.",
                                   "debrief": "One. Two. Three."}
    score = await scorer.score_call("Caller: pay now\nSara: okay", {"rule_outcome": "agreed"})
    assert score == {"outcome": "agreed", "tactics_used": ["urgency"], "tactics_worked": ["urgency"],
                     "lesson": "Hang up and ring the family number.", "debrief": "One. Two. Three.",
                     "scorer_version": "scorer.v1"}
    assert "<recorded_outcome>agreed</recorded_outcome>" in fake_jobs.calls[0]["user"]
    fake_jobs.outputs["scorer"]["lesson"] = " ".join(["long"] * 40)
    assert (await scorer.score_call("Caller: x", {"rule_outcome": "agreed"}))["lesson"] == scorer.LESSONS["agreed"]


# ---------------------------------------------------------------- planner


def member_input(member_id: str = "mem_a", voices: list[str] | None = None) -> dict[str, Any]:
    return {
        "member_id": member_id, "name": "Sara", "relationship": "mother",
        "profile": {"weak_spot": "Trusts the bank.", "trusts_most": "bank"}, "results": [],
        "allowed": {"scenarios": ["bank_security"], "later_scenarios": ["bank_security", "police", "relative_new_number"],
                    "clone_scenarios": ["relative_new_number"], "max_difficulty": 1, "voices": voices or []},
        "rule": {"scenario": "bank_security", "difficulty": 1, "voice_of": None, "reason": "first"},
    }


async def test_planner_fallback_is_the_rule(fake_jobs: FakeRunJob) -> None:
    plan = await planner.plan_family({"safe_word_set": False, "members": [member_input()]})
    member = plan["members"][0]
    assert member["steps"] == [{"when": "today", "scenario": "bank_security", "difficulty": 1, "voice_of": None,
                                "why": planner.readiness.REASONS["first"], "status": "planned"}]
    assert member["weak_spot"] == "Trusts the bank."
    assert member["this_week"] == planner.FALLBACK_THIS_WEEK
    assert plan["family_tasks"] == planner.FAMILY_TASKS_NO_WORD
    assert (await planner.plan_family({"members": []}))["members"] == []


async def test_planner_output_is_kept_within_the_limits(fake_jobs: FakeRunJob) -> None:
    fake_jobs.outputs["planner"] = {"family_tasks": ["Only one task."], "members": [{
        "member_id": "mem_a", "weak_spot": "Official callers.", "this_week": "Save the number.",
        "steps": [
            {"when": "today", "scenario": "hospital", "difficulty": 3, "voice_of": "Jon", "why": "Because."},
            {"when": "in two days", "scenario": "hospital", "difficulty": 1, "voice_of": None, "why": "Dropped."},
            {"when": "in four days", "scenario": "relative_new_number", "difficulty": 0, "voice_of": "Eve", "why": "Ok."},
        ]}]}
    plan = await planner.plan_family({"safe_word_set": True, "members": [member_input(voices=["Jon"]),
                                                                         member_input("mem_b")]})
    first, second = plan["members"]
    assert [step["scenario"] for step in first["steps"]] == ["bank_security", "relative_new_number"]
    assert first["steps"][0]["difficulty"] == 1 and first["steps"][0]["voice_of"] is None
    assert first["steps"][1]["difficulty"] == 1 and first["steps"][1]["voice_of"] == "Jon"
    assert first["this_week"] == "Save the number." and first["source"] == "planner.v1"
    assert second["source"] == "fallback", "a member the model left out gets the rule's plan"
    assert plan["family_tasks"] == planner.FAMILY_TASKS_WITH_WORD


# ---------------------------------------------------------------- director


TEMPLATE = {"caller_claim": "her son Jon", "address_as": "Mum", "opening_line": "Mum? It's me.",
            "scenario_brief": "You broke your phone.", "ask": "a transfer today", "tactic_order": ["new_number"]}


async def test_director_none_on_failure_and_checked_brief_on_success(fake_jobs: FakeRunJob) -> None:
    context = {"target_name": "Sara", "allowed_tactics": ["new_number", "urgency", "secrecy", "small_ask_first"]}
    assert await director.improve_brief(TEMPLATE, context) is None
    fake_jobs.outputs["director"] = {"caller_claim": "her son Jon", "address_as": "  ", "opening_line": "Mum, new phone.",
                                     "scenario_brief": "You lost your phone.", "ask": "200 euros today",
                                     "tactic_order": ["authority", "urgency", "urgency", "secrecy", "new_number",
                                                      "small_ask_first"]}
    brief = await director.improve_brief(TEMPLATE, context)
    assert brief["address_as"] == "Mum"
    assert brief["tactic_order"] == ["urgency", "secrecy", "new_number"]
    assert "<scenario_template>" in fake_jobs.calls[-1]["user"]
    fake_jobs.outputs["director"] = RuntimeError("slow")
    assert await director.improve_brief(TEMPLATE, context) is None


# ---------------------------------------------------------------- digest and weekly note


async def test_digest_needs_pages_and_cleans_patterns(fake_jobs: FakeRunJob) -> None:
    assert await digest.build_digest([]) is None
    assert await digest.build_digest([{"url": "https://a.example", "text": "  "}]) is None
    assert fake_jobs.calls == []
    pattern = {"title": "Fake bank", "summary": "A caller poses as a bank.", "tactics": ["authority", "authority"],
               "closest_scenario": "bank_security", "source_url": "https://a.example/"}
    fake_jobs.outputs["digest"] = {"patterns": [pattern] * 4 + [{**pattern, "title": " "}]}
    built = await digest.build_digest([{"url": "https://a.example", "title": "A", "text": "warning text"}])
    assert len(built["patterns"]) == 3
    assert built["patterns"][0]["tactics"] == ["authority"]
    assert built["patterns"][0]["source_url"] == "https://a.example"


async def test_weekly_note_fallback_and_checks(fake_jobs: FakeRunJob) -> None:
    pattern = {"title": "Callers posing as a bank's security team", "summary": "...", "tactics": ["authority"]}
    fixed = await digest.write_note(pattern, "Sara", None)
    assert fixed.startswith("This week: callers posing as a bank's security team.")
    fake_jobs.outputs["weekly_note"] = {"text": "This week, fake bank calls. Hang up and ring the family number."}
    assert await digest.write_note(pattern, "Sara", "Trusts banks.") == fake_jobs.outputs["weekly_note"]["text"]
    for bad in ("Call 0123456789 now.", "See https://example.org", " ".join(["word"] * 60)):
        fake_jobs.outputs["weekly_note"] = {"text": bad}
        assert await digest.write_note(pattern, "Sara", None) == fixed


# ---------------------------------------------------------------- firecrawl


async def test_firecrawl_without_a_key_gives_the_builtin_pages() -> None:
    pages = await firecrawl.fetch_warnings(["https://example.org/a"])
    assert pages == firecrawl.BUILTIN_PAGES
    assert all(page["url"].startswith("builtin:") and page["text"] for page in pages)


async def test_firecrawl_keeps_the_pages_it_could_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test")
    get_settings.cache_clear()

    def answer(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer fc-test"
        if b"good" in request.content:
            return httpx.Response(200, json={"success": True, "data": {"markdown": "Scam warning text",
                                                                        "metadata": {"title": "Alerts"}}})
        return httpx.Response(500)

    with respx.mock(assert_all_called=False) as router:
        router.post(firecrawl.SCRAPE_URL).mock(side_effect=answer)
        pages = await firecrawl.fetch_warnings(["https://example.org/good", "https://example.org/bad"])
    assert pages == [{"url": "https://example.org/good", "title": "Alerts", "text": "Scam warning text"}]


def test_provider_errors_never_quote_their_message() -> None:
    import openai

    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    response = httpx.Response(401, request=request)
    error = openai.AuthenticationError("Incorrect API key provided: sk-proj-****abcd", response=response, body=None)
    assert llm.describe_error(error) == "AuthenticationError (status 401)"
    assert llm.describe_error(ValueError("bad shape")) == "ValueError: bad shape"
