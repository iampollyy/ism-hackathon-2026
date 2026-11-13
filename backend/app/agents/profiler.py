"""Profiler job: welcome transcript to a readiness profile. OWNER: track C."""

from typing import Any


async def build_profile(transcript: str, consent_from_event: bool | None) -> dict[str, Any]:
    """Return an ai.md `Profile` as a dict. Fallback: all items 0, consent
    from the `consent` event only. Never raises. OWNER: track C."""
    raise NotImplementedError
