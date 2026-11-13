"""Live: each model job once, on a realistic input, with the models and keys
in backend/.env.

All six jobs run at the same time (one module fixture), so the group stays
short; each job then has its own test. A job passes when a model answered
(not the fallback in code) and every attempt it made succeeded within the
job's time limit (llm.JOB_SECONDS). A timeout, or a first choice that
failed, fails the test with each attempt's model, latency and error.
"""

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from app.agents import digest, llm, planner, profiler, scorer
from app.db import new_session, now_iso
from app.ids import new_family_id, new_member_id
from app.models import Family, Member, ModelRun
from app.routers import weekly
from app.schemas import READINESS_KEYS
from app.services import briefs, firecrawl, pipeline
from tests.live.support import REPORT, need_job, storage

pytestmark = pytest.mark.live

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
JOBS = ("profiler", "planner", "director", "scorer", "digest", "weekly_note")
CLOSE = 0.8  # an answer slower than this share of the limit is flagged in the report


@dataclass
class JobRun:
    from_model: bool  # the answer came from a model, not the fallback in code
    detail: str = ""  # why not, when it did not
    rows: list[dict[str, Any]] = field(default_factory=list)  # its model_runs rows, in order


def fixture(name: str, item_id: str) -> dict[str, Any]:
    items = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return next(item for item in items if item["id"] == item_id)


def welcome_profile() -> dict[str, Any]:
    """Sara's profile as the profiler would write it for w01_sara_trusts_bank."""
    expected = fixture("welcome_transcripts.json", "w01_sara_trusts_bank")["expected"]
    return {
        "consent_practice": True, "consent_quote": "Yes, that's fine, I'm happy with that.",
        "items": [{"key": key, "score": expected["items"][key], "evidence": "from the welcome call"}
                  for key in READINESS_KEYS],
        "trusts_most": expected["trusts_most"],
        "said": "If the bank rings, I do what they say, they know what they're doing.",
        "weak_spot": "She would send money to her son straight away, without checking.",
        "source": profiler.PROMPT_VERSION,
    }


def add_family() -> tuple[str, str, str]:
    """The Kovacs: Sara (with her welcome profile) and Jon (organiser, ready clone)."""
    now = now_iso()
    family_id, sara, jon = new_family_id(), new_member_id(), new_member_id()
    with new_session() as db:
        db.add(Family(id=family_id, name="The Kovacs", safe_word_set=True, created_at=now))
        db.add(Member(id=sara, family_id=family_id, name="Sara", relationship="mother", consent_practice_at=now,
                      voice_status="none", profile_json=json.dumps(welcome_profile()), created_at=now))
        db.add(Member(id=jon, family_id=family_id, name="Jon", relationship="son", is_organiser=True,
                      consent_practice_at=now, consent_clone_at=now, voice_id="voice_live_jon",
                      voice_status="ready", created_at=now))
        db.commit()
    return family_id, sara, jon


# ---------------------------------------------------------------- one run per job


async def run_profiler(_: tuple[str, str, str]) -> JobRun:
    item = fixture("welcome_transcripts.json", "w01_sara_trusts_bank")
    transcript = pipeline.transcript_text(pipeline.turns_as_events(item["turns"]), "Callback", item["member_name"])
    profile = await profiler.build_profile(transcript, item["consent_event"])
    return JobRun(profile.get("source") == profiler.PROMPT_VERSION, "the fallback profile was used")


async def run_planner(ids: tuple[str, str, str]) -> JobRun:
    family_id = ids[0]
    with new_session() as db:
        family = db.get(Family, family_id)
        members = list(db.scalars(select(Member).where(Member.family_id == family_id)))
        family_input = pipeline.planner_input(db, family, members, members)
    plan = await planner.plan_family(family_input)
    fallback = [item["member_id"] for item in plan["members"] if item.get("source") != planner.PROMPT_VERSION]
    return JobRun(bool(plan["members"]) and not fallback, f"fallback plan for {len(fallback)} member(s)")


async def run_director(ids: tuple[str, str, str]) -> JobRun:
    """Through briefs.build_brief (the app's path, with its 4 s cap and the
    code checks). It counts only if the director's brief passed the checks."""
    checked: list[list[str]] = []
    real_checks = briefs.brief_problems

    def checks(brief: Any, allowed: list[str]) -> list[str]:
        problems = real_checks(brief, allowed)
        checked.append(problems)
        return problems

    with pytest.MonkeyPatch.context() as patch, new_session() as db:
        patch.setattr(briefs, "brief_problems", checks)
        sara, jon = db.get(Member, ids[1]), db.get(Member, ids[2])
        await briefs.build_brief(db, sara, jon, "relative_new_number", 2)
    if not checked:
        return JobRun(False, "the director gave no brief; the template was used")
    if checked[0]:
        return JobRun(False, f"the director's brief failed the code checks: {'; '.join(checked[0])}")
    return JobRun(True)


async def run_scorer(_: tuple[str, str, str]) -> JobRun:
    item = fixture("practice_transcripts.json", "p02_safe_word_after_pressure")
    transcript = pipeline.transcript_text(pipeline.turns_as_events(item["turns"]), "Caller", item["target_name"],
                                          show_tactics=True)
    context = {"rule_outcome": item["expected_outcome"], "tactics_marked": item["tactics_marked"],
               "scenario": item["scenario"], "difficulty": item["difficulty"], "target_name": item["target_name"]}
    score = await scorer.score_call(transcript, context)
    return JobRun(score.get("scorer_version") == scorer.PROMPT_VERSION, "the fixed lesson was used")


async def run_digest(_: tuple[str, str, str]) -> JobRun:
    built = await digest.build_digest(firecrawl.builtin_pages())
    return JobRun(bool(built and built["patterns"]), "no digest (last week's or the built-in patterns are used)")


async def run_weekly_note(_: tuple[str, str, str]) -> JobRun:
    pattern = weekly.FALLBACK_PATTERNS[1]
    text = await digest.write_note(pattern, "Sara", welcome_profile()["weak_spot"])
    return JobRun(text != digest.fallback_note(pattern), "the fixed note was used")


RUNS = {"profiler": run_profiler, "planner": run_planner, "director": run_director, "scorer": run_scorer,
        "digest": run_digest, "weekly_note": run_weekly_note}


def model_runs() -> dict[str, list[dict[str, Any]]]:
    rows: dict[str, list[dict[str, Any]]] = {job: [] for job in JOBS}
    with new_session() as db:
        for row in db.scalars(select(ModelRun).order_by(ModelRun.id)):
            rows.setdefault(row.job, []).append({
                "model": row.model, "ok": row.ok, "error": row.error, "latency_ms": row.latency_ms,
                "input_tokens": row.input_tokens, "output_tokens": row.output_tokens, "output": row.output_json,
            })
    return rows


def explain_note(run: JobRun) -> None:
    """Why write_note kept the fixed text although a model answered."""
    answered = [row for row in run.rows if row["ok"] and row["output"]]
    if run.from_model or not answered:
        return
    text = " ".join(str(json.loads(answered[-1]["output"]).get("text") or "").split())
    run.detail = (f"the model's note failed the code check (digest._note_ok): {len(text.split())} words, "
                  f"at most {digest.NOTE_WORDS} + 5 allowed, no link, no run of six digits")


@pytest.fixture(scope="module")
def job_runs(tmp_path_factory) -> dict[str, JobRun]:
    """Run the six jobs at once, in a database of their own; collect each
    job's result and model_runs rows."""
    async def run_all(ids: tuple[str, str, str]) -> list[JobRun]:
        return await asyncio.gather(*(RUNS[job](ids) for job in JOBS))

    with storage(tmp_path_factory.mktemp("jobs")):
        started = time.monotonic()
        results = asyncio.run(run_all(add_family()))
        REPORT.append(f"model jobs: all six at once in {time.monotonic() - started:.1f} s")
        rows = model_runs()
    for job, result in zip(JOBS, results):
        result.rows = rows.get(job, [])
    runs = dict(zip(JOBS, results))
    explain_note(runs["weekly_note"])
    return runs


# ---------------------------------------------------------------- the tests


def describe(row: dict[str, Any]) -> str:
    seconds = (row["latency_ms"] or 0) / 1000
    return f"{row['model']} {'ok' if row['ok'] else 'FAILED (' + str(row['error']) + ')'} in {seconds:.1f} s"


@pytest.mark.parametrize("job", JOBS)
def test_model_job_answers_in_time(job, job_runs, report):
    need_job(job)
    run = job_runs[job]
    limit = llm.JOB_SECONDS[job]
    attempts = "; ".join(describe(row) for row in run.rows) or "no attempt"
    answered = next((row for row in run.rows if row["ok"]), None)
    if answered:
        close = " CLOSE TO THE LIMIT" if answered["latency_ms"] > CLOSE * limit * 1000 else ""
        report(f"{job}: {answered['model']} answered in {answered['latency_ms'] / 1000:.1f} s "
               f"(limit {limit:g} s{close}), {answered['input_tokens']} in / {answered['output_tokens']} out tokens"
               + ("" if len(run.rows) == 1 else f" [attempts: {attempts}]"))
    else:
        report(f"{job}: no model answered [attempts: {attempts}]")

    assert run.rows, f"{job}: no model was tried (check the {job.upper()}_MODELS setting and the keys)"
    slow = [row for row in run.rows if row["error"] and ("timed out" in row["error"] or row["error"] == "cancelled")]
    assert not slow, f"{job} is slower than its {limit:g} s limit: {attempts}"
    assert answered is not None, f"{job}: every model failed: {attempts}"
    assert answered["latency_ms"] <= limit * 1000, f"{job} took {answered['latency_ms']} ms, limit {limit:g} s"
    assert all(row["ok"] for row in run.rows), f"{job}: the first choice failed: {attempts}"
    assert run.from_model, f"{job}: {run.detail} [attempts: {attempts}]"
