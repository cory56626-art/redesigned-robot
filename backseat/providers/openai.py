"""OpenAI provider (chat.completions with data-URI images)."""

from __future__ import annotations

import base64

from .base import ChatMessage, LLMProvider, ProviderError


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, max_tokens: int = 300):
        try:
            import openai
        except ImportError as err:
            raise ProviderError("openai is not installed. Run: pip install openai") from err
        self._sdk = openai
        self._client = openai.OpenAI(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens

    def chat(self, messages: list[ChatMessage], images: list[bytes], system: str) -> str:
        api_messages: list[dict] = []
        if system:
            api_messages.append({"role": "system", "content": system})
        for i, msg in enumerate(messages):
            content: list | str = msg.text
            if images and i == len(messages) - 1:
                content = [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/jpeg;base64,"
                            + base64.b64encode(image).decode("ascii")
                        },
                    }
                    for image in images
                ] + [{"type": "text", "text": msg.text}]
            api_messages.append({"role": msg.role, "content": content})

        try:
            response = self._client.chat.completions.create(
                model=self.model,
                messages=api_messages,
                max_tokens=self.max_tokens,
            )
        except self._sdk.RateLimitError as err:
            raise ProviderError(f"OpenAI rate limit: {err}", rate_limited=True) from err
        except self._sdk.APIConnectionError as err:
            raise ProviderError(f"OpenAI connection error: {err}", retryable=True) from err
        except self._sdk.APIStatusError as err:
            raise ProviderError(
                f"OpenAI API error {err.status_code}: {err}",
                retryable=err.status_code >= 500,
            ) from err

        return (response.choices[0].message.content or "").strip()

    def list_models(self) -> list[str]:
        try:
            return [m.id for m in self._client.models.list()]
        except Exception as err:
            raise ProviderError(f"Could not list OpenAI models: {err}", retryable=True) from err
