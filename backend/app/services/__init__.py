"""Services. Shared helper: run_in_background() for work after a request."""

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

log = logging.getLogger("app.background")

# Strong references, so running tasks are not garbage-collected.
_tasks: set[asyncio.Task] = set()


def _log_failure(task: asyncio.Task) -> None:
    _tasks.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        log.error("background task %s failed", task.get_name(), exc_info=error)


def run_in_background(coro: Coroutine[Any, Any, Any], name: str) -> asyncio.Task:
    """Start a coroutine without waiting for it (e.g. pipeline.after_call).
    Failures are logged, never raised. Call from inside a running event loop."""
    task = asyncio.get_running_loop().create_task(coro, name=name)
    _tasks.add(task)
    task.add_done_callback(_log_failure)
    return task
