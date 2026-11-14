"""Digest job: this week's scam warnings to tactics. OWNER: track C.

Also the weekly note (ai.md: "a sixth small job with the same pattern"):
one digest pattern plus the person's weak spot in, a message of at most 40
words out.
"""

import json
import logging
import re
from typing import Any

from app.agents import llm
from app.agents.shapes import Digest, WeeklyNote

log = logging.getLogger("app.agents.digest")

JOB = "digest"
PROMPT_VERSION = "digest.v1"
NOTE_JOB = "weekly_note"
NOTE_PROMPT_VERSION = "weekly_note.v2"
MAX_PATTERNS = 3
# Scraped pages can be very long; the warnings are near the top.
PAGE_CHARS = 15000
NOTE_WORDS = 40


def _norm_url(url: str) -> str:
    return str(url or "").strip().rstrip("/").lower()


def _user_message(pages: list[dict[str, Any]]) -> str:
    blocks = []
    for page in pages:
        text = str(page.get("text") or "")[:PAGE_CHARS]
        title = str(page.get("title") or "")
        blocks.append(f'<page url="{page.get("url", "")}" title="{title}">\n{text}\n</page>')
    return "\n".join(blocks)


def clean_digest(digest: Digest, pages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """At most three patterns with a title and a summary, tactics without
    repeats. A source that matches a page is written as that page's address;
    an empty one becomes the first page's. None if no pattern is left."""
    sources = {_norm_url(page.get("url", "")): page.get("url", "") for page in pages}
    first_url = str(pages[0].get("url", "")) if pages else ""
    patterns = []
    for pattern in digest.patterns:
        given = pattern.source_url.strip()
        source = sources.get(_norm_url(given)) or given or first_url
        if not pattern.title.strip() or not pattern.summary.strip():
            continue
        tactics = list(dict.fromkeys(pattern.tactics))
        patterns.append({
            "title": " ".join(pattern.title.split()),
            "summary": " ".join(pattern.summary.split()),
            "tactics": tactics,
            "closest_scenario": pattern.closest_scenario,
            "source_url": source,
        })
    return {"patterns": patterns[:MAX_PATTERNS]} if patterns else None


async def build_digest(pages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return an ai.md `Digest` as a dict (patterns), or None (the caller
    then uses last week's digest). `pages` are [{url, title, text}] from
    firecrawl.fetch_warnings. Never raises. OWNER: track C."""
    try:
        pages = [page for page in pages if str(page.get("text") or "").strip()]
        if not pages:
            return None
        result = await llm.run_job(
            JOB,
            system=llm.load_prompt(JOB),
            user=_user_message(pages),
            schema=Digest,
            prompt_version=PROMPT_VERSION,
        )
        if isinstance(result, Digest):
            return clean_digest(result, pages)
    except Exception:
        log.exception("digest failed")
    return None


def _note_ok(text: str) -> bool:
    """One short message with no long digit run and no link."""
    if not text or len(text.split()) > NOTE_WORDS + 5:
        return False
    return not re.search(r"\d{6,}|https?://|www\.", text)


def fallback_note(pattern: dict[str, Any]) -> str:
    title = str(pattern.get("title") or "calls that ask for money in a hurry").rstrip(".")
    return (f"This week: {title[0].lower() + title[1:] if title else title}. "
            "If a call asks for money or a code, hang up and call the family number.")


async def write_note(pattern: dict[str, Any], member_name: str, weak_spot: str | None) -> str:
    """The weekly message for one person, at most 40 words. Fallback: a fixed
    sentence with the pattern's title. Never raises."""
    try:
        person = {"name": member_name, "weak_spot": weak_spot or "not known yet"}
        pattern_view = {key: pattern.get(key) for key in ("title", "summary", "tactics")}
        result = await llm.run_job(
            NOTE_JOB,
            system=llm.load_prompt(NOTE_JOB, NOTE_PROMPT_VERSION.split(".", 1)[1]),
            user=(f"<pattern>\n{json.dumps(pattern_view, ensure_ascii=False)}\n</pattern>\n"
                  f"<person>\n{json.dumps(person, ensure_ascii=False)}\n</person>"),
            schema=WeeklyNote,
            prompt_version=NOTE_PROMPT_VERSION,
            max_tokens=2000,
        )
        if isinstance(result, WeeklyNote):
            text = " ".join(result.text.split())
            if _note_ok(text):
                return text
    except Exception:
        log.exception("weekly note failed; using the fixed text")
    return fallback_note(pattern)
