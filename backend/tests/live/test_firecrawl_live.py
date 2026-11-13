"""Live: one real run of the weekly scrape (firecrawl.fetch_warnings on the
weekly run's pages). About one Firecrawl credit per page."""

import time

import pytest

from app.routers import weekly
from app.services import firecrawl
from tests.live.support import need

pytestmark = pytest.mark.live

MIN_CHARS = 500  # a page with less main text than this is no use to the digest job


async def test_weekly_scrape_returns_usable_pages(report):
    need("FIRECRAWL_API_KEY")
    started = time.monotonic()
    pages = await firecrawl.fetch_warnings(weekly.WARNING_URLS)
    seconds = time.monotonic() - started
    fetched = [page for page in pages if not str(page["url"]).startswith("builtin:")]
    for page in fetched:
        report(f"firecrawl: {page['url']}: {len(page['text']):,} characters, title {page['title'][:60]!r}")
    report(f"firecrawl: {len(fetched)} of {len(weekly.WARNING_URLS)} pages in {seconds:.1f} s")

    assert fetched, "no page could be fetched; fetch_warnings fell back to the built-in pages (see the log)"
    assert {page["url"] for page in fetched} <= set(weekly.WARNING_URLS)
    for page in fetched:
        text = page["text"].lower()
        assert len(text) >= MIN_CHARS, f"{page['url']}: only {len(text)} characters of main text"
        assert "scam" in text or "fraud" in text, f"{page['url']}: the text mentions no scam or fraud"
