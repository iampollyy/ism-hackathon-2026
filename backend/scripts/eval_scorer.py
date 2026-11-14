"""Run the scorer over the written practice transcripts in tests/fixtures/ and
print how many it labels correctly (ai.md, "Checking quality"). OWNER: track C.

The scorer gets only the transcript and the tactics the caller marked, not
the recorded outcome, so this measures the model on its own. Each attempt is
also stored in model_runs.

Usage (from backend/):
  .venv/bin/python scripts/eval_scorer.py             # the scorer, ten practice calls
  .venv/bin/python scripts/eval_scorer.py --profiler  # also the profiler, three welcome calls

Needs OPENAI_API_KEY or ANTHROPIC_API_KEY in backend/.env. Without either,
every answer is the fallback and the script says so.
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.agents import profiler, scorer  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import init_db  # noqa: E402
from app.services.pipeline import transcript_text, turns_as_events  # noqa: E402

FIXTURES = BACKEND_DIR / "tests" / "fixtures"


def load(name: str) -> list[dict[str, Any]]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


async def eval_scorer() -> tuple[int, int, int]:
    """(correct, total, fallbacks) over the practice transcripts."""
    cases = load("practice_transcripts.json")
    correct = fallbacks = 0
    for case in cases:
        events = turns_as_events(case["turns"])
        transcript = transcript_text(events, "Caller", case["target_name"])
        context = {"rule_outcome": None, "tactics_marked": case.get("tactics_marked") or [],
                   "scenario": case.get("scenario")}
        score = await scorer.score_call(transcript, context)
        fell_back = score.get("scorer_version") == scorer.FALLBACK_VERSION
        fallbacks += fell_back
        ok = score["outcome"] == case["expected_outcome"]
        correct += ok
        mark = "ok  " if ok else "MISS"
        print(f"{mark} {case['id']:<32} expected {case['expected_outcome']:<24} got {score['outcome']:<24}"
              f"{' (fallback)' if fell_back else ''}")
        if not fell_back:
            print(f"     lesson: {score['lesson']}")
    return correct, len(cases), fallbacks


async def eval_profiler() -> None:
    """Item-by-item agreement with the hand-scored welcome transcripts."""
    for case in load("welcome_transcripts.json"):
        transcript = transcript_text(turns_as_events(case["turns"]), "Callback", case["member_name"])
        profile = await profiler.build_profile(transcript, case.get("consent_event"))
        expected = case["expected"]
        got = {item["key"]: item["score"] for item in profile["items"]}
        same = sum(got.get(key) == score for key, score in expected["items"].items())
        print(f"{case['id']:<24} items {same}/{len(expected['items'])}  "
              f"consent {profile['consent_practice']} (expected {expected['consent_practice']})  "
              f"trusts {profile['trusts_most']} (expected {expected['trusts_most']})  "
              f"source {profile.get('source')}")
        print(f"     said: {profile.get('said')!r}  weak spot: {profile.get('weak_spot')!r}")


async def main_async(with_profiler: bool) -> None:
    settings = get_settings()
    if not settings.openai_api_key and not settings.anthropic_api_key:
        print("No OPENAI_API_KEY or ANTHROPIC_API_KEY: every answer below is the fallback.\n")
    print(f"Scorer models, in order: {', '.join(settings.job_models('scorer'))}\n")
    correct, total, fallbacks = await eval_scorer()
    print(f"\nScorer: {correct}/{total} correct ({100 * correct / total:.0f}%), {fallbacks} fallbacks.")
    if with_profiler:
        print(f"\nProfiler models, in order: {', '.join(settings.job_models('profiler'))}\n")
        await eval_profiler()


def main() -> None:
    init_db()
    asyncio.run(main_async("--profiler" in sys.argv[1:]))


if __name__ == "__main__":
    main()
