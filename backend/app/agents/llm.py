"""One function for every model job (docs/ai.md "One function"). OWNER: track C.

run_job() tries the job's models in order (first choice, then the second at
the other provider), each within the job's time limit, and returns the first
parsed result. It returns None when every attempt fails, is refused or is too
slow, so the caller uses its fallback in code. It never raises.

- Claude: client.messages.parse(..., output_format=Schema) -> parsed_output;
  a "refusal" stop reason counts as no answer.
- OpenAI: client.responses.parse(..., text_format=Schema) -> output_parsed.
- A provider whose API key is not set is skipped (no attempt, no row).
- Every attempt writes one model_runs row: model, prompt version, input,
  output or error, latency and tokens.
- Callers must hold no uncommitted database writes when they await run_job,
  because it writes model_runs rows in its own session (db.py, "Hard rule").
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anthropic
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import MODEL_JOBS, get_settings
from app.db import new_session, now_iso
from app.models import ModelRun

log = logging.getLogger("app.agents.llm")

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"

# Time limit for each attempt, in seconds (ai.md, the job table).
JOB_SECONDS: dict[str, float] = {
    "profiler": 30,
    "planner": 30,
    "digest": 60,
    "director": 4,
    "scorer": 8,
    "weekly_note": 15,
}

# Jobs without their own model setting borrow another job's models.
MODELS_FROM: dict[str, str] = {}

# The fast jobs sit where someone waits, so Claude thinks less on them.
CLAUDE_EFFORT: dict[str, str] = {"director": "low", "scorer": "low", "weekly_note": "low"}

ERROR_CHARS = 500

_clients: dict[tuple[str, str], Any] = {}


@dataclass
class Answer:
    parsed: BaseModel | None  # None: refused, or nothing usable
    input_tokens: int | None = None
    output_tokens: int | None = None
    note: str | None = None  # why there is no parsed result


def load_prompt(job: str, version: str = "v1") -> str:
    """The system prompt for one job and version: agents/prompts/{job}.{version}.md."""
    return (PROMPTS_DIR / f"{job}.{version}.md").read_text(encoding="utf-8").strip()


def job_models(job: str) -> list[str]:
    """The models for a job, first choice first."""
    source = MODELS_FROM.get(job, job)
    if source not in MODEL_JOBS:
        return []
    return get_settings().job_models(source)


def provider_of(model: str) -> str:
    """'openai' for GPT and o-series models, otherwise 'anthropic'."""
    name = model.lower()
    if name.startswith(("gpt-", "o1", "o3", "o4", "chatgpt")):
        return "openai"
    return "anthropic"


def _api_key(provider: str) -> str:
    settings = get_settings()
    return settings.openai_api_key if provider == "openai" else settings.anthropic_api_key


def _client(provider: str, api_key: str) -> Any:
    key = (provider, api_key)
    if key not in _clients:
        if provider == "openai":
            _clients[key] = AsyncOpenAI(api_key=api_key, max_retries=1)
        else:
            _clients[key] = anthropic.AsyncAnthropic(api_key=api_key, max_retries=1)
    return _clients[key]


def _usage(usage: Any) -> tuple[int | None, int | None]:
    if usage is None:
        return None, None
    return getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None)


async def _call_openai(client: Any, model: str, system: str, user: str,
                       schema: type[BaseModel]) -> Answer:
    response = await client.responses.parse(
        model=model,
        input=[{"role": "system", "content": system},
               {"role": "user", "content": user}],
        text_format=schema,
    )
    input_tokens, output_tokens = _usage(getattr(response, "usage", None))
    parsed = response.output_parsed  # None when the model refused
    note = None if parsed is not None else "no parsed output (refusal or empty)"
    return Answer(parsed, input_tokens, output_tokens, note)


async def _call_claude(client: Any, job: str, model: str, system: str, user: str,
                       schema: type[BaseModel], max_tokens: int) -> Answer:
    extra: dict[str, Any] = {}
    if job in CLAUDE_EFFORT:
        extra["output_config"] = {"effort": CLAUDE_EFFORT[job]}
    response = await client.messages.parse(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=schema,
        **extra,
    )
    input_tokens, output_tokens = _usage(getattr(response, "usage", None))
    if response.stop_reason == "refusal":
        return Answer(None, input_tokens, output_tokens, "refusal")
    parsed = response.parsed_output  # a validated instance of `schema`
    note = None if parsed is not None else f"no parsed output (stop_reason {response.stop_reason})"
    return Answer(parsed, input_tokens, output_tokens, note)


async def _call(job: str, model: str, system: str, user: str,
                schema: type[BaseModel], max_tokens: int) -> Answer:
    """One attempt with one model. Raises on API errors."""
    provider = provider_of(model)
    client = _client(provider, _api_key(provider))
    if provider == "openai":
        return await _call_openai(client, model, system, user, schema)
    return await _call_claude(client, job, model, system, user, schema, max_tokens)


def _record(job: str, model: str, prompt_version: str, user: str, answer: Answer | None,
            ok: bool, error: str | None, latency_ms: int) -> None:
    """Write one model_runs row in its own short session. Never raises."""
    output_json = None
    if answer is not None and answer.parsed is not None:
        output_json = answer.parsed.model_dump_json()
    try:
        with new_session() as db:
            db.add(ModelRun(
                job=job,
                model=model,
                prompt_version=prompt_version,
                input_json=json.dumps({"user": user}),
                output_json=output_json,
                ok=ok,
                error=error[:ERROR_CHARS] if error else None,
                latency_ms=latency_ms,
                input_tokens=answer.input_tokens if answer else None,
                output_tokens=answer.output_tokens if answer else None,
                created_at=now_iso(),
            ))
            db.commit()
    except Exception:
        log.exception("could not write the model_runs row for job %s", job)


def describe_error(exc: Exception) -> str:
    """The error for the log and the model_runs row. A provider SDK's own
    error gives only its class and HTTP status: its message can quote part
    of the API key (an authentication error does)."""
    module = type(exc).__module__ or ""
    if module.split(".")[0] in ("openai", "anthropic"):
        status = getattr(exc, "status_code", None)
        return f"{type(exc).__name__} (status {status})" if status else type(exc).__name__
    return f"{type(exc).__name__}: {exc}"


async def _attempt(job: str, model: str, system: str, user: str, schema: type[BaseModel],
                   prompt_version: str, max_tokens: int) -> BaseModel | None:
    """One model, within the job's time limit. Writes its row; never raises."""
    seconds = JOB_SECONDS.get(job, 30)
    started = time.monotonic()
    answer: Answer | None = None
    error: str | None = None
    try:
        answer = await asyncio.wait_for(_call(job, model, system, user, schema, max_tokens), seconds)
        if answer.parsed is not None and not isinstance(answer.parsed, schema):
            error = f"parsed output is {type(answer.parsed).__name__}, not {schema.__name__}"
        elif answer.parsed is None:
            error = answer.note or "no parsed output"
    except TimeoutError:
        error = f"timed out after {seconds} s"
    except asyncio.CancelledError:
        # A caller's own time limit cancelled us: keep the row, then stop.
        _record(job, model, prompt_version, user, None, False, "cancelled",
                int((time.monotonic() - started) * 1000))
        raise
    except Exception as exc:  # noqa: BLE001  (any provider failure means: try the next model)
        error = describe_error(exc)
    latency_ms = int((time.monotonic() - started) * 1000)
    ok = error is None
    _record(job, model, prompt_version, user, answer, ok, error, latency_ms)
    if not ok:
        log.warning("model job %s on %s failed: %s", job, model, error)
        return None
    return answer.parsed if answer else None


async def run_job(job: str, *, system: str, user: str, schema: type[BaseModel],
                  prompt_version: str, max_tokens: int = 8000) -> BaseModel | None:
    """Try the job's models in order (first choice, then the other provider),
    each within the job's time limit; return the first parsed result, or None
    so the caller uses its fallback in code. Writes one model_runs row per
    attempt. Never raises (cancellation still propagates)."""
    try:
        for model in job_models(job):
            if not _api_key(provider_of(model)):
                log.info("model job %s: skipping %s, no %s API key", job, model, provider_of(model))
                continue
            result = await _attempt(job, model, system, user, schema, prompt_version, max_tokens)
            if result is not None:
                return result
    except Exception:
        log.exception("model job %s failed unexpectedly", job)
    return None
