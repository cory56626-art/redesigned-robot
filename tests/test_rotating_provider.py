import pytest

from backseat.keys import KeyPool, RotatingProvider
from backseat.providers.base import ChatMessage, LLMProvider, ProviderError


class ScriptedProvider(LLMProvider):
    """Replies normally unless its key is in the rate-limited set."""

    def __init__(self, key, limited_keys, built):
        self.key = key
        self.limited_keys = limited_keys
        built.append(key)

    def chat(self, messages, images, system):
        if self.key in self.limited_keys:
            raise ProviderError("429", rate_limited=True)
        return f"reply-from-{self.key}"


def make_rotating(keys, limited_keys=(), clock=None):
    built = []
    pool = KeyPool(list(keys), clock=clock or (lambda: 1000.0))
    limited = set(limited_keys)
    provider = RotatingProvider(lambda k: ScriptedProvider(k, limited, built), pool, name="test")
    return provider, pool, built, limited


MSG = [ChatMessage("user", "hi")]


def test_rotates_to_next_key_on_rate_limit():
    provider, pool, built, _ = make_rotating(["k1", "k2"], limited_keys=["k1"])
    assert provider.chat(MSG, [], "sys") == "reply-from-k2"
    assert built == ["k1", "k2"]


def test_all_keys_limited_raises_rate_limited_error():
    provider, _, _, _ = make_rotating(["k1", "k2"], limited_keys=["k1", "k2"])
    with pytest.raises(ProviderError) as exc:
        provider.chat(MSG, [], "sys")
    assert exc.value.rate_limited


def test_non_rate_limit_errors_do_not_rotate():
    pool = KeyPool(["k1", "k2"], clock=lambda: 1000.0)
    calls = []

    class BadKeyProvider(LLMProvider):
        def __init__(self, key):
            calls.append(key)

        def chat(self, messages, images, system):
            raise ProviderError("invalid key", retryable=False)

    provider = RotatingProvider(BadKeyProvider, pool)
    with pytest.raises(ProviderError):
        provider.chat(MSG, [], "sys")
    assert calls == ["k1"]  # never touched k2


def test_provider_instances_are_cached_per_key():
    provider, _, built, _ = make_rotating(["k1", "k2"])
    provider.chat(MSG, [], "sys")  # k1
    provider.chat(MSG, [], "sys")  # k2
    provider.chat(MSG, [], "sys")  # k1 again — cached
    assert built == ["k1", "k2"]


def test_recovered_key_rejoins_rotation():
    clock_now = {"t": 1000.0}
    provider, pool, _, limited = make_rotating(
        ["k1", "k2"], limited_keys=["k1"], clock=lambda: clock_now["t"]
    )
    assert provider.chat(MSG, [], "sys") == "reply-from-k2"
    limited.clear()  # k1's quota recovers upstream
    clock_now["t"] += 3600
    replies = {provider.chat(MSG, [], "sys") for _ in range(2)}
    assert replies == {"reply-from-k1", "reply-from-k2"}


def test_requests_spread_round_robin_across_keys():
    provider, pool, _, _ = make_rotating(["k1", "k2", "k3"])
    for _ in range(6):
        provider.chat(MSG, [], "sys")
    assert [s["requests"] for s in pool.stats()] == [2, 2, 2]
