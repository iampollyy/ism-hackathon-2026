"""This week's scam warnings from public pages, via Firecrawl. OWNER: track C."""

from typing import Any


async def fetch_warnings(urls: list[str]) -> list[dict[str, Any]]:
    """Fetch each page's main text: [{url, title, text}]. Pages that fail
    are skipped. Empty list when settings.firecrawl_api_key is not set.
    OWNER: track C."""
    raise NotImplementedError
