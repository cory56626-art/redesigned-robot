"""Exponential-backoff retry around provider calls.

Closes the long-standing open item from CLAUDE.md: intermittent
``500 INTERNAL`` errors from the Gemini free tier are transient, so every
provider call gets 3 attempts with exponential backoff. Rate-limit errors
additionally fire ``on_rate_limit`` so the key pool (PLAN step 2) can mark
the key cooling-down and rotate before the retry.
"""

from __future__ import annotations

import time
from typing import Callable, TypeVar

from .base import ProviderError

T = TypeVar("T")


def with_retry(
    fn: Callable[[], T],
    *,
    attempts: int = 3,
    base_delay: float = 2.0,
    sleep: Callable[[float], None] = time.sleep,
    on_rate_limit: Callable[[ProviderError], None] | None = None,
) -> T:
    """Call ``fn``, retrying retryable ProviderErrors with backoff.

    Delays are base_delay * 2^attempt (2s, 4s, ...). Non-retryable errors
    and the final failed attempt propagate unchanged.
    """
    for attempt in range(attempts):
        try:
            return fn()
        except ProviderError as err:
            if err.rate_limited and on_rate_limit is not None:
                on_rate_limit(err)
            if not err.retryable or attempt == attempts - 1:
                raise
            sleep(base_delay * (2**attempt))
    raise AssertionError("unreachable")
