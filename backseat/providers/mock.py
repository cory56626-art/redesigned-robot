"""Mock provider — canned replies, zero quota.

Lets the director, UI, and tests run the full loop without an API key or
network. Deterministic: direct messages cycle through canned replies;
auto-glances mostly SKIP and occasionally "notice" something, so the
director's cadence can be watched end-to-end.
"""

from __future__ import annotations

from .base import ChatMessage, LLMProvider

GLANCE_MARKER = "automatic glance"

DIRECT_REPLIES = [
    "ha, good question — I'd punch that tree first if I were you.",
    "honestly? I'd have died three times already doing what you're doing.",
    "yeah I saw that. we don't have to talk about it.",
    "solid plan. terrible execution incoming, but solid plan.",
]

GLANCE_COMMENTS = [
    "uh, you gonna do something about that creeper or just vibe?",
    "ooh, iron! grab it grab it grab it.",
    "that's a lot of lava for someone holding all their diamonds.",
]

# Speak on every 4th glance so a mock session feels alive but not chatty.
GLANCE_SPEAK_EVERY = 4


class MockProvider(LLMProvider):
    name = "mock"

    def __init__(self, model: str = "mock-1"):
        self.model = model
        self._direct_count = 0
        self._glance_count = 0

    def chat(self, messages: list[ChatMessage], images: list[bytes], system: str) -> str:
        last = messages[-1].text if messages else ""
        if GLANCE_MARKER in last.lower():
            self._glance_count += 1
            if self._glance_count % GLANCE_SPEAK_EVERY == 0:
                return GLANCE_COMMENTS[
                    (self._glance_count // GLANCE_SPEAK_EVERY - 1) % len(GLANCE_COMMENTS)
                ]
            return "SKIP"
        reply = DIRECT_REPLIES[self._direct_count % len(DIRECT_REPLIES)]
        self._direct_count += 1
        return reply

    def list_models(self) -> list[str]:
        return ["mock-1"]
