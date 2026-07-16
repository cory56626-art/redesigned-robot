import pytest

from backseat.providers.base import ProviderError
from backseat.providers.retry import with_retry


def make_flaky(fail_times: int, error: ProviderError):
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] <= fail_times:
            raise error
        return "ok"

    return fn, calls


def test_succeeds_first_try_no_sleep():
    sleeps = []
    fn, calls = make_flaky(0, ProviderError("x", retryable=True))
    assert with_retry(fn, sleep=sleeps.append) == "ok"
    assert calls["n"] == 1
    assert sleeps == []


def test_retries_transient_error_with_exponential_backoff():
    sleeps = []
    fn, calls = make_flaky(2, ProviderError("500 INTERNAL", retryable=True))
    assert with_retry(fn, sleep=sleeps.append) == "ok"
    assert calls["n"] == 3
    assert sleeps == [2.0, 4.0]


def test_gives_up_after_max_attempts():
    sleeps = []
    fn, calls = make_flaky(99, ProviderError("500 INTERNAL", retryable=True))
    with pytest.raises(ProviderError):
        with_retry(fn, attempts=3, sleep=sleeps.append)
    assert calls["n"] == 3
    assert sleeps == [2.0, 4.0]


def test_non_retryable_error_raises_immediately():
    fn, calls = make_flaky(99, ProviderError("bad api key", retryable=False))
    with pytest.raises(ProviderError):
        with_retry(fn, sleep=lambda s: pytest.fail("should not sleep"))
    assert calls["n"] == 1


def test_rate_limit_is_retryable_and_fires_callback():
    seen = []
    sleeps = []
    fn, calls = make_flaky(1, ProviderError("429", rate_limited=True))
    assert with_retry(fn, sleep=sleeps.append, on_rate_limit=seen.append) == "ok"
    assert calls["n"] == 2
    assert len(seen) == 1
    assert seen[0].rate_limited


def test_rate_limit_callback_fires_even_on_final_attempt():
    seen = []
    fn, _ = make_flaky(99, ProviderError("429", rate_limited=True))
    with pytest.raises(ProviderError):
        with_retry(fn, attempts=2, sleep=lambda s: None, on_rate_limit=seen.append)
    assert len(seen) == 2
