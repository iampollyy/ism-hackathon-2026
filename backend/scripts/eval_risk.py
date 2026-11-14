"""Run the live risk check turn by turn over the written practice transcripts
in tests/fixtures/ and report how often its signals agree with the tactics
the practice agent marked (ai.md, "Checking quality"). OWNER: track C.

The check sees only the turn texts, never the marks, so this measures it on
its own. As in a live call, it runs after each caller line, builds on the
previous check, and stops at the reveal (the fixed reveal line, which in a
call comes after the practice_result `outcome` event). Each model attempt is
also stored in model_runs.

Agreement is per call: the signals found by the end, against the tactics
marked. Precision and recall are per tactic; the three signals that are not
tactics (money_request, asks_for_code, refuses_callback) have no marks to
compare with, so they are only counted. The marks are what the agent chose to
label, not a full answer key: a sign it used but did not mark counts against
precision here.

Usage (from backend/):
  .venv/bin/python scripts/eval_risk.py              # the model (the fallback without keys)
  .venv/bin/python scripts/eval_risk.py --fallback   # the keyword fallback only, no API calls

Needs OPENAI_API_KEY or ANTHROPIC_API_KEY in backend/.env for the model.
"""

import asyncio
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.agents import risk  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import init_db  # noqa: E402
from app.schemas import RISK_SIGNALS, TACTICS  # noqa: E402

FIXTURES = BACKEND_DIR / "tests" / "fixtures"
# The fixed reveal line's words (ai.md, "Variables"); the check stops there.
REVEAL_MARK = "this was a callback practice call"
EXTRA_SIGNALS = [key for key in RISK_SIGNALS if key not in TACTICS]


def load(name: str) -> list[dict[str, Any]]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def before_reveal(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for index, turn in enumerate(turns):
        if REVEAL_MARK in str(turn.get("text") or "").lower():
            return turns[:index]
    return turns


async def run_case(case: dict[str, Any], fallback_only: bool) -> dict[str, Any]:
    """The check after each caller line: the levels, the final result, and
    each check's latency and source."""
    turns = before_reveal(case["turns"])
    previous: dict[str, Any] | None = None
    levels: list[str] = []
    latencies: list[float] = []
    sources: list[str] = []
    for index, turn in enumerate(turns):
        if turn.get("speaker") != risk.CALLER:
            continue
        so_far = turns[:index + 1]
        started = time.monotonic()
        if fallback_only:
            previous = risk.fallback_check(so_far, previous)
        else:
            previous = await risk.check_risk(so_far, previous)
        latencies.append((time.monotonic() - started) * 1000)
        levels.append(previous["level"])
        sources.append(previous["source"])
    return {"final": previous or risk.fallback_check([], None), "levels": levels,
            "latencies": latencies, "sources": sources}


def ratio(part: int, whole: int) -> str:
    return f"{part / whole:.2f}" if whole else " n/a"


async def main_async(fallback_only: bool) -> None:
    settings = get_settings()
    if fallback_only:
        print("Keyword fallback only: no API calls.\n")
    else:
        if not settings.openai_api_key and not settings.anthropic_api_key:
            print("No OPENAI_API_KEY or ANTHROPIC_API_KEY: every answer below is the fallback.\n")
        print(f"Risk models, in order: {', '.join(settings.job_models('risk'))}\n")

    counts = {key: {"tp": 0, "fp": 0, "fn": 0} for key in TACTICS}
    extra_counts = {key: 0 for key in EXTRA_SIGNALS}
    latencies: list[float] = []
    checks = fallbacks = all_found = 0
    final_levels: dict[str, int] = {"green": 0, "yellow": 0, "red": 0}
    cases = load("practice_transcripts.json")
    for case in cases:
        run = await run_case(case, fallback_only)
        final = run["final"]
        found = set(final["signals"])
        marked = set(case.get("tactics_marked") or [])
        for key in TACTICS:
            counts[key]["tp"] += key in found and key in marked
            counts[key]["fp"] += key in found and key not in marked
            counts[key]["fn"] += key not in found and key in marked
        for key in EXTRA_SIGNALS:
            extra_counts[key] += key in found
        all_found += marked <= found
        latencies.extend(run["latencies"])
        checks += len(run["sources"])
        fallbacks += sum(source == risk.FALLBACK_VERSION for source in run["sources"])
        final_levels[final["level"]] = final_levels.get(final["level"], 0) + 1

        path = " ".join(level[0].upper() for level in run["levels"])
        missed = sorted(marked - found)
        extra = sorted((found - marked) & set(TACTICS))
        print(f"{case['id']:<32} {path:<12} {final['level']:<6} reason: {final['reason']!r}")
        print(f"     signals: {', '.join(final['signals']) or '-'}")
        print(f"     marked:  {', '.join(case.get('tactics_marked') or []) or '-'}"
              f"{'  missed: ' + ', '.join(missed) if missed else ''}"
              f"{'  not marked: ' + ', '.join(extra) if extra else ''}")

    print("\nPer tactic (the call's signals by the end, against the tactics marked):")
    print(f"  {'tactic':<18} {'tp':>3} {'fp':>3} {'fn':>3}  precision  recall")
    total = {"tp": 0, "fp": 0, "fn": 0}
    for key in TACTICS:
        c = counts[key]
        for name in total:
            total[name] += c[name]
        print(f"  {key:<18} {c['tp']:>3} {c['fp']:>3} {c['fn']:>3}  {ratio(c['tp'], c['tp'] + c['fp']):>9}"
              f"  {ratio(c['tp'], c['tp'] + c['fn']):>6}")
    print(f"  {'all tactics':<18} {total['tp']:>3} {total['fp']:>3} {total['fn']:>3}"
          f"  {ratio(total['tp'], total['tp'] + total['fp']):>9}  {ratio(total['tp'], total['tp'] + total['fn']):>6}")
    print("\nSignals with no marks to compare (calls where found): "
          + ", ".join(f"{key} {count}" for key, count in extra_counts.items()))
    print(f"Calls where every marked tactic was found: {all_found}/{len(cases)}")
    print("Light at the reveal: " + ", ".join(f"{level} {count}" for level, count in final_levels.items()))
    print(f"Checks: {checks}, fallbacks: {fallbacks}")
    if latencies:
        ordered = sorted(latencies)
        p95 = ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))]
        print(f"Latency per check (ms): mean {statistics.mean(ordered):.0f}, median {statistics.median(ordered):.0f}, "
              f"p95 {p95:.0f}, max {ordered[-1]:.0f}")


def main() -> None:
    init_db()
    asyncio.run(main_async("--fallback" in sys.argv[1:]))


if __name__ == "__main__":
    main()
