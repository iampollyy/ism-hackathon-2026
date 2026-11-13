"""Digest job: this week's scam warnings to tactics. OWNER: track C."""

from typing import Any


async def build_digest(pages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return an ai.md `Digest` as a dict (patterns), or None (the caller
    then uses last week's digest). Never raises. OWNER: track C."""
    raise NotImplementedError
