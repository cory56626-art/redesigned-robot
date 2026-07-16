"""Provider registry: build an LLMProvider by name from settings."""

from __future__ import annotations

from .base import ChatMessage, LLMProvider, ProviderError
from .retry import with_retry

PROVIDER_NAMES = ("google", "anthropic", "openai", "ollama", "mock")

__all__ = [
    "ChatMessage",
    "LLMProvider",
    "ProviderError",
    "PROVIDER_NAMES",
    "build_provider",
    "with_retry",
]


def build_provider(
    name: str,
    *,
    api_key: str = "",
    model: str = "",
    ollama_host: str = "",
) -> LLMProvider:
    """Construct the named provider. Imports are lazy so only the SDK for
    the provider actually in use needs to be installed."""
    if name == "google":
        from .google import GoogleProvider

        return GoogleProvider(api_key=api_key, model=model)
    if name == "anthropic":
        from .anthropic import AnthropicProvider

        return AnthropicProvider(api_key=api_key, model=model)
    if name == "openai":
        from .openai import OpenAIProvider

        return OpenAIProvider(api_key=api_key, model=model)
    if name == "ollama":
        from .ollama import DEFAULT_HOST, OllamaProvider

        return OllamaProvider(model=model, host=ollama_host or DEFAULT_HOST)
    if name == "mock":
        from .mock import MockProvider

        return MockProvider()
    raise ValueError(f"Unknown provider {name!r}. Choose one of: {', '.join(PROVIDER_NAMES)}")
