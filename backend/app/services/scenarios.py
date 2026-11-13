"""Scenario files: one JSON file per scenario in app/scenarios/. OWNER: track A."""

from typing import Any


def list_scenarios() -> list[dict[str, Any]]:
    """Every scenario file in app/scenarios/, parsed, sorted by key. Each has
    key, title, voice ("clone" or the name of a settings field / env var
    holding a library voice id), caller_label, allowed_tactics, template.
    OWNER: track A."""
    raise NotImplementedError


def get_scenario(key: str) -> dict[str, Any] | None:
    """One scenario by key, or None if there is no such file.
    OWNER: track A."""
    raise NotImplementedError
