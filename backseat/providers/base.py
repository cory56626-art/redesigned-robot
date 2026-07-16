"""Provider-agnostic LLM layer.

Every backend implements :class:`LLMProvider` with a single call:
``chat(messages, images, system) -> reply``.

Conventions shared by all providers:

- ``messages`` is the rolling conversation as :class:`ChatMessage` items,
  ending with the new user message.
- ``images`` are raw JPEG bytes attached to that final user message only.
  History stays text-only (see ``memory.py``) so context never balloons
  with old screenshots.
- Failures are normalized to :class:`ProviderError` so ``retry.py`` and the
  key pool (PLAN step 2) can react without knowing which SDK threw what.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class ChatMessage:
    role: str  # "user" or "assistant"
    text: str


class ProviderError(Exception):
    """A normalized provider failure.

    retryable: transient (5xx, timeouts, dropped connections) — worth
        retrying with backoff.
    rate_limited: quota exhausted / 429. Implies retryable, and is the
        signal the key pool uses to rotate keys (PLAN step 2).
    """

    def __init__(self, message: str, *, retryable: bool = False, rate_limited: bool = False):
        super().__init__(message)
        self.rate_limited = rate_limited
        self.retryable = retryable or rate_limited


class LLMProvider(ABC):
    """One LLM backend (Google, Anthropic, OpenAI, Ollama, mock)."""

    name: str = "base"

    @abstractmethod
    def chat(self, messages: list[ChatMessage], images: list[bytes], system: str) -> str:
        """Send the conversation and return the reply text.

        Raise ProviderError for any failure.
        """

    def list_models(self) -> list[str]:
        """Model ids available to this provider/key, for the settings UI.

        Model names are account-dependent and change over time (see
        CLAUDE.md) — never hardcode them anywhere but a default.
        """
        return []
