"""Ollama provider request-shaping tests — no network, _post is stubbed."""

import base64

from backseat.providers.base import ChatMessage
from backseat.providers.ollama import OllamaProvider


def make_provider(captured):
    provider = OllamaProvider(model="test-model")

    def fake_post(path, payload):
        captured["path"] = path
        captured["payload"] = payload
        return {"message": {"content": "  hi there  "}}

    provider._post = fake_post
    return provider


def test_system_prompt_and_roles():
    captured = {}
    provider = make_provider(captured)
    reply = provider.chat(
        [ChatMessage("user", "q1"), ChatMessage("assistant", "a1"), ChatMessage("user", "q2")],
        [],
        "be cool",
    )
    assert reply == "hi there"
    assert captured["path"] == "/api/chat"
    msgs = captured["payload"]["messages"]
    assert msgs[0] == {"role": "system", "content": "be cool"}
    assert [m["role"] for m in msgs[1:]] == ["user", "assistant", "user"]
    assert captured["payload"]["stream"] is False


def test_images_attach_only_to_last_message():
    captured = {}
    provider = make_provider(captured)
    provider.chat(
        [ChatMessage("user", "old"), ChatMessage("user", "new")],
        [b"\xff\xd8fakejpeg"],
        "sys",
    )
    msgs = captured["payload"]["messages"]
    assert "images" not in msgs[1]  # the old user turn
    assert msgs[2]["images"] == [base64.b64encode(b"\xff\xd8fakejpeg").decode("ascii")]
