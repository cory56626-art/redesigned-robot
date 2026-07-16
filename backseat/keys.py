"""Multi-API-key support — PLAN step 2.

Three pieces:

- :class:`KeyPool` — round-robin over the keys for one provider. A key that
  hits a rate limit is marked cooling-down (with a reset timestamp that
  doubles on repeated limits) and skipped until it recovers.
- :class:`KeyStore` — persistent storage. Uses the OS keyring (Windows
  Credential Manager on the target machine) when available; falls back to a
  JSON file in the config dir on systems without a usable keyring (e.g. the
  headless dev box), with an honest warning.
- :class:`RotatingProvider` — wraps any keyed LLMProvider factory. On a
  rate-limited call it cools the key, rotates to the next, and retries the
  same request; only when every key is cooling does the error escape (still
  marked rate_limited, so retry.py backs off).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import config_dir
from .providers.base import ChatMessage, LLMProvider, ProviderError

SERVICE = "Backseat"

# Providers that need API keys at all (ollama and mock don't).
KEYED_PROVIDERS = ("google", "anthropic", "openai")


def mask_key(key: str) -> str:
    """AIzaSyB…x2Yq — enough to tell keys apart, never the whole secret."""
    if len(key) <= 10:
        return key[:2] + "…"
    return f"{key[:7]}…{key[-4:]}"


# ---------------------------------------------------------------------------
# KeyPool — in-memory rotation state for one provider's keys
# ---------------------------------------------------------------------------


@dataclass
class KeyState:
    key: str
    requests: int = 0
    rate_limits: int = 0
    consecutive_limits: int = 0
    cooldown_until: float = 0.0


class KeyPool:
    def __init__(
        self,
        keys: list[str],
        *,
        base_cooldown: float = 60.0,
        max_cooldown: float = 900.0,
        clock: Callable[[], float] = time.time,
    ):
        if not keys:
            raise ValueError("KeyPool needs at least one key")
        self._states = [KeyState(key=k) for k in keys]
        self._by_key = {s.key: s for s in self._states}
        self._index = 0
        self.base_cooldown = base_cooldown
        self.max_cooldown = max_cooldown
        self._clock = clock

    def __len__(self) -> int:
        return len(self._states)

    def acquire(self) -> str | None:
        """Next available key, round-robin. None if every key is cooling."""
        now = self._clock()
        for offset in range(len(self._states)):
            state = self._states[(self._index + offset) % len(self._states)]
            if state.cooldown_until <= now:
                self._index = (self._index + offset + 1) % len(self._states)
                return state.key
        return None

    def record_success(self, key: str) -> None:
        state = self._by_key[key]
        state.requests += 1
        state.consecutive_limits = 0

    def record_rate_limit(self, key: str) -> float:
        """Mark a key cooling-down; repeated limits double the cooldown.

        Returns the timestamp when the key becomes usable again."""
        state = self._by_key[key]
        state.requests += 1
        state.rate_limits += 1
        state.consecutive_limits += 1
        cooldown = min(
            self.base_cooldown * 2 ** (state.consecutive_limits - 1), self.max_cooldown
        )
        state.cooldown_until = self._clock() + cooldown
        return state.cooldown_until

    def next_available_in(self) -> float:
        """Seconds until the soonest key recovers (0 if one is free now)."""
        now = self._clock()
        return max(0.0, min(s.cooldown_until for s in self._states) - now)

    def stats(self) -> list[dict]:
        """Per-key usage for the settings/usage panel (PLAN step 7)."""
        now = self._clock()
        return [
            {
                "key": mask_key(s.key),
                "requests": s.requests,
                "rate_limits": s.rate_limits,
                "cooling_for": max(0.0, s.cooldown_until - now),
            }
            for s in self._states
        ]


# ---------------------------------------------------------------------------
# KeyStore — persistent key storage (keyring, with file fallback)
# ---------------------------------------------------------------------------


class _KeyringBackend:
    """OS keyring — Windows Credential Manager on the target machine."""

    def __init__(self, keyring_module):
        self._keyring = keyring_module

    def get(self, name: str) -> str | None:
        return self._keyring.get_password(SERVICE, name)

    def set(self, name: str, value: str) -> None:
        self._keyring.set_password(SERVICE, name, value)


class _FileBackend:
    """Plain-JSON fallback for systems without a usable keyring.

    Only used when the keyring probe fails (headless Linux dev box, CI).
    On the user's Windows PC the real Credential Manager is used."""

    def __init__(self, path: Path):
        self.path = path

    def _read(self) -> dict:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def get(self, name: str) -> str | None:
        return self._read().get(name)

    def set(self, name: str, value: str) -> None:
        data = self._read()
        data[name] = value
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _default_backend():
    try:
        import keyring

        keyring.get_password(SERVICE, "__probe__")  # raises if no usable backend
        return _KeyringBackend(keyring)
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException:
        # BaseException, not Exception: a broken Linux SecretService backend
        # surfaces as a pyo3 PanicException, which skips Exception entirely.
        print(
            "[Backseat] NOTE: no usable OS keyring here — storing keys in "
            f"{config_dir() / 'keys.json'} (plain text). On Windows this "
            "won't happen: keys go into Credential Manager."
        )
        return _FileBackend(config_dir() / "keys.json")


class KeyStore:
    """Persistent per-provider key lists, stored as one JSON array each."""

    def __init__(self, backend=None):
        self._backend = backend if backend is not None else _default_backend()

    def load(self, provider: str) -> list[str]:
        raw = self._backend.get(f"{provider}-api-keys")
        if not raw:
            return []
        return json.loads(raw)

    def save(self, provider: str, keys: list[str]) -> None:
        self._backend.set(f"{provider}-api-keys", json.dumps(keys))

    def add(self, provider: str, key: str) -> bool:
        """Add a key. Returns False if it was already stored."""
        keys = self.load(provider)
        if key in keys:
            return False
        keys.append(key)
        self.save(provider, keys)
        return True

    def remove(self, provider: str, key: str) -> bool:
        """Remove a key (exact value or its masked form). False if not found."""
        keys = self.load(provider)
        for stored in keys:
            if stored == key or mask_key(stored) == key:
                keys.remove(stored)
                self.save(provider, keys)
                return True
        return False


# ---------------------------------------------------------------------------
# RotatingProvider — key rotation wrapped around any keyed provider
# ---------------------------------------------------------------------------


class RotatingProvider(LLMProvider):
    name = "rotating"

    def __init__(self, factory: Callable[[str], LLMProvider], pool: KeyPool, name: str = ""):
        self._factory = factory
        self._pool = pool
        self._providers: dict[str, LLMProvider] = {}
        if name:
            self.name = name

    @property
    def pool(self) -> KeyPool:
        return self._pool

    def _provider_for(self, key: str) -> LLMProvider:
        if key not in self._providers:
            self._providers[key] = self._factory(key)
        return self._providers[key]

    def _all_cooling_error(self) -> ProviderError:
        wait = self._pool.next_available_in()
        return ProviderError(
            f"All {len(self._pool)} API key(s) are rate-limited; "
            f"next one recovers in ~{wait:.0f}s.",
            rate_limited=True,
        )

    def chat(self, messages: list[ChatMessage], images: list[bytes], system: str) -> str:
        tried: set[str] = set()
        while True:
            key = self._pool.acquire()
            if key is None or key in tried:
                raise self._all_cooling_error()
            tried.add(key)
            try:
                reply = self._provider_for(key).chat(messages, images, system)
            except ProviderError as err:
                if err.rate_limited:
                    self._pool.record_rate_limit(key)
                    continue  # same request, next key
                raise
            self._pool.record_success(key)
            return reply

    def list_models(self) -> list[str]:
        key = self._pool.acquire()
        if key is None:
            raise self._all_cooling_error()
        return self._provider_for(key).list_models()
