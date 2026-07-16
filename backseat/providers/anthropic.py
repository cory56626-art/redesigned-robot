"""Anthropic (Claude) provider.

Ported from the original prototype ``prototype/mine_buddy.py`` — same
base64-image content-block call shape.
"""

from __future__ import annotations

import base64

from .base import ChatMessage, LLMProvider, ProviderError


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str, max_tokens: int = 300):
        try:
            import anthropic
        except ImportError as err:
            raise ProviderError(
                "anthropic is not installed. Run: pip install anthropic"
            ) from err
        self._sdk = anthropic
        self._client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens

    def chat(self, messages: list[ChatMessage], images: list[bytes], system: str) -> str:
        api_messages = []
        for i, msg in enumerate(messages):
            content: list | str = msg.text
            if images and i == len(messages) - 1:
                content = [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": base64.b64encode(image).decode("ascii"),
                        },
                    }
                    for image in images
                ] + [{"type": "text", "text": msg.text}]
            api_messages.append({"role": msg.role, "content": content})

        try:
            response = self._client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system,
                messages=api_messages,
            )
        except self._sdk.RateLimitError as err:
            raise ProviderError(f"Anthropic rate limit: {err}", rate_limited=True) from err
        except self._sdk.APIConnectionError as err:
            raise ProviderError(f"Anthropic connection error: {err}", retryable=True) from err
        except self._sdk.APIStatusError as err:
            raise ProviderError(
                f"Anthropic API error {err.status_code}: {err}",
                retryable=err.status_code >= 500,
            ) from err

        return "".join(
            block.text for block in response.content if block.type == "text"
        ).strip()

    def list_models(self) -> list[str]:
        try:
            return [m.id for m in self._client.models.list()]
        except Exception as err:
            raise ProviderError(f"Could not list Anthropic models: {err}", retryable=True) from err
