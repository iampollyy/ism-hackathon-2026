"""The learning screens' content: what each scam tactic sounds like, and the
core habits. Track 4 (docs/full-app/review.md).

Static text in app/content/, written by us warmly and plainly, naming no
real bank, police force or company, and never meant to frighten:
- tactics.json: the eight tactics and the three extra risk signals
  (schemas.RISK_SIGNALS), each {key, label, what_it_sounds_like: [two short
  example lines], why_it_works, what_to_do};
- habits.json: the core habits, each {key, title, line}.

Rules:
- Numbers from code: each tactic's `kind` (tactic or signal) and `level`
  (the live risk light that sign alone gives, agents.risk.level_for) are
  set here, and its label is schemas.RISK_SIGNAL_LABELS (the file's label
  must match; a test checks), so the learning screen and the live call's
  chips always say the same thing. The order is schemas.RISK_SIGNALS.
- Files are read on each request (they are tiny), so an edit needs no
  restart. A file that is missing, broken or lacks a key answers 503
  content_unavailable.
"""

import json
import logging
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app import schemas
from app.agents import risk

log = logging.getLogger("app.learn")

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"
EXAMPLE_LINES = 2


def unavailable() -> schemas.ApiError:
    return schemas.ApiError(503, "content_unavailable", "The learning content could not be read.")


def read_list(name: str) -> list[dict[str, Any]]:
    """One content file as a list of objects. Raises 503 content_unavailable."""
    try:
        data = json.loads((CONTENT_DIR / name).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        log.exception("content file %s could not be read", name)
        raise unavailable() from error
    if not isinstance(data, list):
        log.error("content file %s is not a list", name)
        raise unavailable()
    return [item for item in data if isinstance(item, dict)]


def tactics() -> list[schemas.LearnTactic]:
    """Every tactic and risk signal, in schemas.RISK_SIGNALS order."""
    entries: dict[str, dict[str, Any]] = {}
    for item in read_list("tactics.json"):
        key = item.get("key")
        if key in schemas.RISK_SIGNALS and key not in entries:
            entries[key] = item
    missing = [key for key in schemas.RISK_SIGNALS if key not in entries]
    if missing:
        log.error("tactics.json has no entry for %s", ", ".join(missing))
        raise unavailable()
    views: list[schemas.LearnTactic] = []
    for key in schemas.RISK_SIGNALS:
        item = entries[key]
        lines = item.get("what_it_sounds_like")
        try:
            views.append(schemas.LearnTactic(
                key=key,
                label=schemas.RISK_SIGNAL_LABELS[key],
                kind="tactic" if key in schemas.TACTICS else "signal",
                level=risk.level_for([key]),
                what_it_sounds_like=lines[:EXAMPLE_LINES] if isinstance(lines, list) else lines,
                why_it_works=item.get("why_it_works"),
                what_to_do=item.get("what_to_do"),
            ))
        except ValidationError as error:
            log.error("tactics.json entry %s is not valid: %s", key, error)
            raise unavailable() from error
    return views


def habits() -> list[schemas.Habit]:
    """The core habits, in the file's order."""
    try:
        return [schemas.Habit.model_validate(item) for item in read_list("habits.json")]
    except ValidationError as error:
        log.error("habits.json is not valid: %s", error)
        raise unavailable() from error
