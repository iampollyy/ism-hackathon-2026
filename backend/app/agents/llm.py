"""One function for every model job (docs/ai.md "One function"). OWNER: track C."""

from pydantic import BaseModel


async def run_job(job: str, *, system: str, user: str, schema: type[BaseModel],
                  prompt_version: str, max_tokens: int = 8000) -> BaseModel | None:
    """Try settings.job_models(job) in order (first choice, then the other
    provider), each within the job's time limit; return the first parsed
    result, or None so the caller uses its fallback in code. Writes one
    model_runs row per attempt. Never raises.
    OWNER: track C."""
    raise NotImplementedError
