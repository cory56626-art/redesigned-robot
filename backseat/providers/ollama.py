"""Local Ollama provider — plain HTTP to localhost, no SDK, no API key.

This is the backend that makes the top maturity tier real (no server-side
safety filters) and the pressure valve when free-tier quotas run dry.
Requires a locally running Ollama with a vision-capable model pulled
(e.g. ``ollama pull llama3.2-vision`` or ``gemma3``).
"""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request

from .base import ChatMessage, LLMProvider, ProviderError

DEFAULT_HOST = "http://localhost:11434"


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, model: str, host: str = DEFAULT_HOST, timeout: float = 120.0):
        self.model = model
        self.host = host.rstrip("/")
        self.timeout = timeout

    def _post(self, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            self.host + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")
            raise ProviderError(
                f"Ollama HTTP {err.code}: {body}",
                retryable=err.code >= 500,
                rate_limited=err.code == 429,
            ) from err
        except (urllib.error.URLError, TimeoutError) as err:
            raise ProviderError(
                f"Could not reach Ollama at {self.host} — is it running? ({err})",
                retryable=True,
            ) from err

    def chat(self, messages: list[ChatMessage], images: list[bytes], system: str) -> str:
        api_messages: list[dict] = []
        if system:
            api_messages.append({"role": "system", "content": system})
        for i, msg in enumerate(messages):
            entry: dict = {"role": msg.role, "content": msg.text}
            if images and i == len(messages) - 1:
                entry["images"] = [base64.b64encode(image).decode("ascii") for image in images]
            api_messages.append(entry)

        data = self._post(
            "/api/chat",
            {"model": self.model, "messages": api_messages, "stream": False},
        )
        return (data.get("message", {}).get("content") or "").strip()

    def list_models(self) -> list[str]:
        request = urllib.request.Request(self.host + "/api/tags")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except Exception as err:
            raise ProviderError(
                f"Could not list Ollama models at {self.host}: {err}", retryable=True
            ) from err
        return [m["name"] for m in data.get("models", [])]
