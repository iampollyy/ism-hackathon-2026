"""This week's scam warnings from public pages, via Firecrawl. OWNER: track C.

One request per page to Firecrawl's scrape endpoint, all at once, each with
a time limit. A page that fails is skipped. Without FIRECRAWL_API_KEY, or
when every page fails, the built-in pages below are returned instead, so the
weekly run always has something for the digest job to read.
"""

import asyncio
import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger("app.services.firecrawl")

SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape"  # check: v2 path and response shape
PAGE_SECONDS = 30.0

# Written by us, in our own words, about phone scams that are widely reported
# this year. Their addresses start with "builtin:" so nobody mistakes them for
# a fetched source.
BUILTIN_PAGES: list[dict[str, Any]] = [
    {
        "url": "builtin:bank-security-calls",
        "title": "Callers posing as a bank's security team",
        "text": "A caller says they are from your bank's fraud or security team. They say a suspicious "
                "payment was blocked and, to stop it, they ask you to read out a code that was just sent "
                "to your phone by text. They sound calm and official and say it must be done now. A real "
                "bank never asks for such a code on a call.",
    },
    {
        "url": "builtin:relative-new-number",
        "title": "A relative in trouble, calling from a new number",
        "text": "A message or call comes from an unknown number. The voice sounds like a son, daughter or "
                "grandchild, sometimes made with voice-cloning tools. They say they lost or broke their "
                "phone and need money sent today to a friend's account, and ask you not to tell anyone.",
    },
    {
        "url": "builtin:police-safe-account",
        "title": "Fake police asking you to move savings to a safe account",
        "text": "A caller claims to be a police officer investigating fraud at your bank. They say your "
                "savings are at risk, that bank staff may be involved, and that you must move the money "
                "to a 'safe account' or hand it to a courier, without telling your bank or family.",
    },
]


def builtin_pages() -> list[dict[str, Any]]:
    return [dict(page) for page in BUILTIN_PAGES]


def _page(url: str, body: dict[str, Any]) -> dict[str, Any] | None:
    data = body.get("data") or {}
    text = str(data.get("markdown") or "").strip()
    if not body.get("success", True) or not text:
        return None
    title = str((data.get("metadata") or {}).get("title") or "")
    return {"url": url, "title": title, "text": text}


async def _scrape(client: httpx.AsyncClient, url: str) -> dict[str, Any] | None:
    try:
        response = await client.post(SCRAPE_URL, json={"url": url, "formats": ["markdown"], "onlyMainContent": True})
        response.raise_for_status()
        return _page(url, response.json())
    except Exception as exc:  # noqa: BLE001  (a failed page is skipped)
        log.warning("firecrawl could not fetch %s: %s", url, type(exc).__name__)
        return None


async def fetch_warnings(urls: list[str]) -> list[dict[str, Any]]:
    """Fetch each page's main text: [{url, title, text}]. Pages that fail
    are skipped. Without settings.firecrawl_api_key, or when no page could
    be fetched, returns the built-in pages. Never raises. OWNER: track C."""
    api_key = get_settings().firecrawl_api_key
    if not api_key or not urls:
        return builtin_pages()
    try:
        headers = {"Authorization": f"Bearer {api_key}"}
        async with httpx.AsyncClient(headers=headers, timeout=PAGE_SECONDS) as client:
            pages = await asyncio.gather(*(_scrape(client, url) for url in urls))
        fetched = [page for page in pages if page is not None]
    except Exception:
        log.exception("firecrawl failed")
        fetched = []
    if not fetched:
        log.info("no warning page could be fetched; using the built-in pages")
    return fetched or builtin_pages()
