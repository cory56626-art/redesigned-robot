"""Google (Gemma / Gemini) provider — the free-tier default.

Ported from the working prototype ``prototype/mine_buddy_gemma.py``:
same ``google-genai`` SDK (NOT the deprecated ``google-generativeai``),
same ``types.Part.from_bytes`` / ``GenerateContentConfig`` call shape.
"""

from __future__ import annotations

from .base import ChatMessage, LLMProvider, ProviderError

_RETRYABLE_CODES = {408, 500, 502, 503, 504}


class GoogleProvider(LLMProvider):
    name = "google"

    def __init__(self, api_key: str, model: str, max_output_tokens: int = 300):
        try:
            from google import genai
            from google.genai import types
        except ImportError as err:
            raise ProviderError(
                "google-genai is not installed. Run: pip install google-genai"
            ) from err
        self._types = types
        self._errors = genai.errors
        self._client = genai.Client(api_key=api_key)
        self.model = model
        self.max_output_tokens = max_output_tokens

    def chat(self, messages: list[ChatMessage], images: list[bytes], system: str) -> str:
        types = self._types
        contents = []
        for i, msg in enumerate(messages):
            parts = []
            if images and i == len(messages) - 1:
                for image in images:
                    parts.append(types.Part.from_bytes(data=image, mime_type="image/jpeg"))
            parts.append(types.Part.from_text(text=msg.text))
            role = "user" if msg.role == "user" else "model"
            contents.append(types.Content(role=role, parts=parts))

        try:
            response = self._client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    max_output_tokens=self.max_output_tokens,
                ),
            )
        except self._errors.APIError as err:
            code = getattr(err, "code", None)
            raise ProviderError(
                f"Google API error {code}: {err}",
                retryable=code in _RETRYABLE_CODES,
                rate_limited=code == 429,
            ) from err
        except Exception as err:  # connection resets etc. surface as misc errors
            raise ProviderError(f"Google API call failed: {err}", retryable=True) from err

        return (response.text or "").strip()

    def list_models(self) -> list[str]:
        try:
            return [m.name for m in self._client.models.list()]
        except Exception as err:
            raise ProviderError(f"Could not list Google models: {err}", retryable=True) from err
