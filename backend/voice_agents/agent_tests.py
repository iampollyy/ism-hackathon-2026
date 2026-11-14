"""Run scripted conversations against the real ElevenLabs agents and check them.
OWNER: track A. Costs ElevenLabs credits (about 200 per scenario).

Usage (from backend/):
    .venv/bin/python voice_agents/agent_tests.py              # every scenario
    .venv/bin/python voice_agents/agent_tests.py safe_word    # scenarios whose key contains "safe_word"
    .venv/bin/python voice_agents/agent_tests.py -v           # also print each transcript

Each scenario is an ElevenLabs simulation test ("Callback test: <key>"): a
simulated person with a script talks to the agent, with every tool mocked.
The test is created, or updated if it exists, so the dashboard always has the
current suite and you can re-run it there.

Two kinds of check:
- ElevenLabs' judge reads the conversation against the success conditions.
- This script checks the tool calls itself: the result reported exactly once
  with the expected value, the tactics marked, the reveal line spoken, and
  end_call at the end.
A scenario passes only if both pass. Exit code 1 if any scenario fails.
"""

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from app.config import get_settings  # noqa: E402

sys.path.insert(0, str(HERE))
from sync import AGENTS, BASE_URL  # noqa: E402

PREFIX = "Callback test: "
PRACTICE_VARS = AGENTS["practice"]["placeholders"]
WELCOME_VARS = AGENTS["welcome"]["placeholders"]
REVEAL = PRACTICE_VARS["reveal_line"]


@dataclass
class Scenario:
    key: str
    agent: str  # welcome | practice | family_line
    persona: str
    conditions: list[str]
    tool: str  # the result tool to check
    expect: dict[str, Any]  # its expected parameters
    min_tactics: int = 0
    reveal: bool = False
    variables: dict[str, Any] = field(default_factory=dict)
    max_turns: int = 12


SARA = "You are Sara, 72, answering your phone at home. Keep every reply to one short sentence. "

SCENARIOS = [
    Scenario(
        key="practice_safe_word",
        agent="practice",
        persona=SARA + "First ask who is calling. Then believe it is your son Jon and go along with his story, "
                       "until he asks you for money. Then ask him for the family word. Never send money.",
        conditions=[
            "The caller answers the question about who is calling in role, as Jon, and does not reveal at that point.",
            "The caller asks for money before any reveal.",
            "The caller does not say or invent a family word.",
            "After Sara asks for the family word, the caller says it was a practice call and the voice was artificial.",
        ],
        tool="practice_result", expect={"outcome": "asked_safe_word"}, min_tactics=1, reveal=True,
        variables=PRACTICE_VARS,
    ),
    Scenario(
        key="practice_hang_up",
        agent="practice",
        persona=SARA + "Believe it is your son Jon. When he asks for money, say you will hang up and call "
                       "him back on his usual number. Do not send money.",
        conditions=[
            "The caller asks for money before any reveal.",
            "After Sara says she will hang up and call back, the caller reveals it was a practice call.",
        ],
        tool="practice_result", expect={"outcome": "hung_up"}, min_tactics=1, reveal=True,
        variables=PRACTICE_VARS,
    ),
    Scenario(
        key="practice_agrees",
        agent="practice",
        persona=SARA + "Believe it is your son Jon and want to help him. When he asks for money, agree at once "
                       "and ask where to send it.",
        conditions=[
            "The caller asks for money before any reveal.",
            "Once Sara agrees to pay, the caller stops at once and reveals it was a practice call, without blaming her.",
            "The caller never asks for or repeats a card number, account number, password or code.",
        ],
        tool="practice_result", expect={"outcome": "agreed"}, min_tactics=1, reveal=True,
        variables=PRACTICE_VARS,
    ),
    Scenario(
        key="welcome_yes",
        agent="welcome",
        persona="You are Sara, 72. Your son Jon set up this service. Answer the caller's questions briefly and "
                "honestly: you would trust a call from the bank. When asked whether you agree to receive "
                "practice calls without knowing when, say yes clearly.",
        conditions=["The agent asks Sara whether she agrees to receive practice calls.",
                    "The agent never asks Sara to say her family word, safe word or password. Asking only "
                    "whether the family has one is allowed."],
        tool="consent_result", expect={"given": True}, variables=WELCOME_VARS,
    ),
    Scenario(
        key="welcome_no",
        agent="welcome",
        persona="You are Sara, 72. Your son Jon set up this service. Answer the caller's questions briefly. "
                "When asked whether you agree to receive practice calls, say clearly: no, I don't want that.",
        conditions=["The agent accepts the no without pressing Sara to change her mind.",
                    "The agent tells Sara that no practice calls will be sent to her."],
        tool="consent_result", expect={"given": False}, variables=WELCOME_VARS,
    ),
]


class Api:
    def __init__(self, api_key: str) -> None:
        self.client = httpx.Client(base_url=BASE_URL, headers={"xi-api-key": api_key}, timeout=60)

    def call(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.client.request(method, path, **kwargs)
        if not response.is_success:
            raise SystemExit(f"{method} {path}: HTTP {response.status_code}\n{response.text[:800]}")
        return response.json() if response.content else None

    def existing_tests(self) -> dict[str, str]:
        found: dict[str, str] = {}
        cursor = None
        while True:
            params: dict[str, Any] = {"page_size": 100, "search": PREFIX}
            if cursor:
                params["cursor"] = cursor
            page = self.call("GET", "/v1/convai/agent-testing", params=params)
            for test in page.get("tests", []):
                found[test["name"]] = test["id"]
            cursor = page.get("next_cursor")
            if not page.get("has_more") or not cursor:
                return found

    def upsert_test(self, scenario: Scenario, existing: dict[str, str]) -> str:
        body = {
            "name": PREFIX + scenario.key,
            "type": "simulation",
            "simulation_scenario": scenario.persona,
            "success_conditions": scenario.conditions,
            "dynamic_variables": scenario.variables,
            "simulation_max_turns": scenario.max_turns,
            "tool_mock_config": {"mocking_strategy": "all", "fallback_strategy": "raise_error"},
        }
        test_id = existing.get(body["name"])
        if test_id:
            response = self.client.put(f"/v1/convai/agent-testing/{test_id}", json=body)
            if response.is_success:
                return test_id
            self.call("DELETE", f"/v1/convai/agent-testing/{test_id}")
        return self.call("POST", "/v1/convai/agent-testing/create", json=body)["id"]


def tool_calls(responses: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    calls = []
    for turn in responses:
        for call in turn.get("tool_calls") or []:
            try:
                params = json.loads(call.get("params_as_json") or "{}")
            except json.JSONDecodeError:
                params = {}
            calls.append((call.get("tool_name"), params))
    return calls


def own_checks(scenario: Scenario, responses: list[dict[str, Any]]) -> list[str]:
    """What this script checks itself; returns the problems found."""
    calls = tool_calls(responses)
    problems = []
    results = [params for name, params in calls if name == scenario.tool]
    if not results:
        problems.append(f"{scenario.tool} never called")
    else:
        if len(results) > 1:
            problems.append(f"{scenario.tool} called {len(results)} times")
        for key, value in scenario.expect.items():
            if results[0].get(key) != value:
                problems.append(f"{scenario.tool} {key}={results[0].get(key)!r}, expected {value!r}")
    tactics = [params.get("key") for name, params in calls if name == "mark_tactic"]
    if len(tactics) < scenario.min_tactics:
        problems.append(f"{len(tactics)} tactics marked, expected at least {scenario.min_tactics}")
    if scenario.reveal and not any(REVEAL in (turn.get("message") or "") for turn in responses):
        problems.append("reveal line not spoken word for word")
    if not any(name == "end_call" for name, _ in calls):
        problems.append("end_call never called")
    return problems


def print_transcript(responses: list[dict[str, Any]]) -> None:
    for turn in responses:
        message = (turn.get("message") or "").replace("\n", " ")
        calls = [f"{c.get('tool_name')}{c.get('params_as_json') or ''}" for c in turn.get("tool_calls") or []]
        line = f"    {turn.get('role', '?'):5} {message[:200]}"
        if calls:
            line += "   [" + "; ".join(calls) + "]"
        print(line)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("filter", nargs="?", default="", help="run only scenarios whose key contains this")
    parser.add_argument("-v", "--verbose", action="store_true", help="print each transcript")
    args = parser.parse_args()
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        print("ELEVENLABS_API_KEY is not set")
        return 1
    scenarios = [s for s in SCENARIOS if args.filter in s.key]
    api = Api(settings.elevenlabs_api_key)
    existing = api.existing_tests()

    by_agent: dict[str, list[tuple[Scenario, str]]] = {}
    for scenario in scenarios:
        by_agent.setdefault(scenario.agent, []).append((scenario, api.upsert_test(scenario, existing)))

    invocations = {}
    for agent, items in by_agent.items():
        agent_id = getattr(settings, AGENTS[agent]["agent_id_setting"])
        if not agent_id:
            print(f"{agent}: agent id not set, skipped")
            continue
        run = api.call("POST", f"/v1/convai/agents/{agent_id}/run-tests",
                       json={"tests": [{"test_id": test_id} for _, test_id in items]})
        invocations[run["id"]] = {test_id: scenario for scenario, test_id in items}
    print(f"Running {len(scenarios)} scenarios on ElevenLabs...")

    deadline = time.monotonic() + 600
    finished: dict[str, dict[str, Any]] = {}
    while len(finished) < len(invocations) and time.monotonic() < deadline:
        for invocation_id in invocations:
            if invocation_id in finished:
                continue
            data = api.call("GET", f"/v1/convai/test-invocations/{invocation_id}")
            if all(run["status"] not in ("pending", "running") for run in data["test_runs"]):
                finished[invocation_id] = data
        if len(finished) < len(invocations):
            time.sleep(5)

    failures = 0
    for invocation_id, tests in invocations.items():
        data = finished.get(invocation_id)
        if data is None:
            print(f"timed out waiting for {invocation_id}")
            failures += len(tests)
            continue
        for run in data["test_runs"]:
            scenario = tests.get(run["test_id"])
            if scenario is None:
                continue
            responses = run.get("agent_responses") or []
            judge_ok = run["status"] == "passed"
            problems = own_checks(scenario, responses)
            ok = judge_ok and not problems
            failures += not ok
            tactics = [p.get("key") for n, p in tool_calls(responses) if n == "mark_tactic"]
            print(f"\n{'PASS' if ok else 'FAIL'}  {scenario.key}  (judge: {run['status']}, "
                  f"turns: {len(responses)}, tactics: {tactics}, credits: {run.get('credits_used')})")
            for problem in problems:
                print(f"    - {problem}")
            if not judge_ok:
                rationale = (run.get("condition_result") or {}).get("rationale") or {}
                for message in rationale.get("messages", [])[:4]:
                    print(f"    - judge: {message[:300]}")
            if args.verbose or not ok:
                print_transcript(responses)
    print(f"\n{len(scenarios) - failures}/{len(scenarios)} scenarios passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
