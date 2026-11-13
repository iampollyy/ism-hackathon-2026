"""Scenario files: one JSON file per scenario in app/scenarios/. OWNER: track A.

Each file has:
- key, title, caller_label, allowed_tactics (keys from the fixed list);
- voice: "clone", or the name of the setting holding a library voice id,
  such as ELEVENLABS_POLICE_VOICE_ID (read as getattr(settings, name.lower()));
- summary: a few words for the family line ("about a new phone number");
- default_caller: {name, relationship}, the caller when no family member is
  the claimed caller (always the case for library voices);
- template: caller_claim, opening_line, scenario_brief, ask, tactic_order and
  optionally address_as. Text may hold the placeholders filled by
  services.briefs: {target_name}, {address_as}, {caller_name},
  {caller_relationship}, {target_relation_to_caller}, {family_name}.
The template alone must make a complete call; the director only improves it.

Files are read on each call (they are tiny), so an edit needs no restart.
"""

import json
import logging
import re
from pathlib import Path
from typing import Any

from app.config import Settings

log = logging.getLogger("app.scenarios")

SCENARIO_DIR = Path(__file__).resolve().parent.parent / "scenarios"
KEY_PATTERN = re.compile(r"^[a-z0-9_]{1,40}$")


def _load(path: Path) -> dict[str, Any] | None:
    try:
        scenario = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log.exception("scenario file %s could not be read", path.name)
        return None
    if not isinstance(scenario, dict) or scenario.get("key") != path.stem:
        log.error("scenario file %s is not a scenario for key %s", path.name, path.stem)
        return None
    return scenario


def list_scenarios() -> list[dict[str, Any]]:
    """Every scenario file in app/scenarios/, parsed, sorted by key."""
    scenarios = [_load(path) for path in sorted(SCENARIO_DIR.glob("*.json"))]
    return [scenario for scenario in scenarios if scenario is not None]


def get_scenario(key: str) -> dict[str, Any] | None:
    """One scenario by key, or None if there is no such file."""
    if not isinstance(key, str) or not KEY_PATTERN.match(key):
        return None
    path = SCENARIO_DIR / f"{key}.json"
    if not path.is_file():
        return None
    return _load(path)


def uses_clone(scenario: dict[str, Any]) -> bool:
    return scenario.get("voice") == "clone"


def library_voice_id(scenario: dict[str, Any], settings: Settings) -> str:
    """The library voice id for a scenario that names one, or "" (also for clone scenarios)."""
    voice = scenario.get("voice") or ""
    if not voice or voice == "clone":
        return ""
    name = str(voice).lower()
    # Only library voice settings, so a file can never point at a secret
    # such as ELEVENLABS_API_KEY and send it to the phone page.
    if not (name.startswith("elevenlabs_") and name.endswith("_voice_id")):
        log.error("scenario %s names %r, which is not a library voice setting", scenario.get("key"), voice)
        return ""
    value = getattr(settings, name, "")
    return value if isinstance(value, str) else ""
