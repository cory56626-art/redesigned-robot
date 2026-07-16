"""KeyPool rotation/cooldown tests — fake clock, no real time passes."""

import pytest

from backseat.keys import KeyPool, mask_key


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def make_pool(n=3, **kw):
    clock = FakeClock()
    pool = KeyPool([f"key-{i}" for i in range(n)], clock=clock, **kw)
    return pool, clock


def test_empty_pool_rejected():
    with pytest.raises(ValueError):
        KeyPool([])


def test_round_robin_spreads_requests():
    pool, _ = make_pool(3)
    assert [pool.acquire() for _ in range(6)] == [
        "key-0", "key-1", "key-2", "key-0", "key-1", "key-2",
    ]


def test_rate_limited_key_is_skipped_until_cooldown_expires():
    pool, clock = make_pool(2, base_cooldown=60.0)
    pool.record_rate_limit("key-0")
    assert pool.acquire() == "key-1"
    assert pool.acquire() == "key-1"  # key-0 still cooling
    clock.now += 61
    acquired = {pool.acquire(), pool.acquire()}
    assert acquired == {"key-0", "key-1"}  # back in rotation


def test_all_cooling_returns_none_and_reports_wait():
    pool, clock = make_pool(2, base_cooldown=60.0)
    pool.record_rate_limit("key-0")
    clock.now += 10
    pool.record_rate_limit("key-1")
    assert pool.acquire() is None
    assert pool.next_available_in() == pytest.approx(50.0)  # key-0 recovers first


def test_consecutive_rate_limits_double_the_cooldown():
    pool, clock = make_pool(1, base_cooldown=60.0, max_cooldown=900.0)
    until1 = pool.record_rate_limit("key-0")
    assert until1 == pytest.approx(clock.now + 60)
    until2 = pool.record_rate_limit("key-0")
    assert until2 == pytest.approx(clock.now + 120)
    until3 = pool.record_rate_limit("key-0")
    assert until3 == pytest.approx(clock.now + 240)


def test_cooldown_is_capped():
    pool, clock = make_pool(1, base_cooldown=60.0, max_cooldown=100.0)
    for _ in range(10):
        until = pool.record_rate_limit("key-0")
    assert until == pytest.approx(clock.now + 100.0)


def test_success_resets_consecutive_counter_but_keeps_totals():
    pool, clock = make_pool(1, base_cooldown=60.0)
    pool.record_rate_limit("key-0")
    clock.now += 61
    pool.record_success("key-0")
    until = pool.record_rate_limit("key-0")
    assert until == pytest.approx(clock.now + 60)  # back to base, not doubled
    stats = pool.stats()[0]
    assert stats["requests"] == 3
    assert stats["rate_limits"] == 2


def test_stats_mask_keys():
    pool, _ = make_pool(1)
    assert pool.stats()[0]["key"] == mask_key("key-0")
    assert "key-0" not in str(pool.stats())


def test_mask_key_never_reveals_middle():
    masked = mask_key("AIzaSyB-1234567890abcdefghij")
    assert masked.startswith("AIzaSyB")
    assert masked.endswith("ghij")
    assert "1234567890" not in masked
