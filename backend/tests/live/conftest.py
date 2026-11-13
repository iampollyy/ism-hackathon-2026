"""Live tests: the real ElevenLabs, OpenAI, Anthropic and Firecrawl APIs.

Not in the default run (pytest.ini has -m "not live"). Run them with:
    .venv/bin/pytest -m live -v

They use the keys and the agent and voice ids in backend/.env. Each test
still gets a fresh temporary database and media folder, the scheduler off,
FAKE_ELEVENLABS off (unless the test turns it on) and the settings cache
cleared. A test skips, naming the setting, when a key or id it needs is not
set (support.need). The numbers worth reading (credit, models, latencies,
pages) are printed in a "live report" section at the end of the run.
"""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from tests.live.support import REPORT, storage


@pytest.fixture(autouse=True)
def test_settings(tmp_path: Path) -> Iterator[None]:
    """Overrides tests/conftest.py's fixture of the same name for this folder:
    the same fresh storage, but no key or id is blanked or faked."""
    with storage(tmp_path):
        yield


@pytest.fixture
def report() -> Callable[[str], None]:
    """report(line): print it now and again in the live report at the end."""
    def add(line: str) -> None:
        REPORT.append(line)
        print(line)

    return add


def pytest_terminal_summary(terminalreporter: Any) -> None:
    if REPORT:
        terminalreporter.section("live report")
        for line in REPORT:
            terminalreporter.write_line(line)
