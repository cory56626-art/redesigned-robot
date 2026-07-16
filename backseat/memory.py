"""Rolling conversation history.

Text-only, exactly like the prototype: screenshots are attached fresh to
each call and never stored, so history stays cheap. The notable-events
journal ("that's the second creeper that got you") lands here in a later
step per PLAN.md.
"""

from __future__ import annotations

from .providers.base import ChatMessage


class Memory:
    def __init__(self, max_turns: int = 20):
        self.max_turns = max_turns
        self._turns: list[ChatMessage] = []

    def add(self, role: str, text: str) -> None:
        self._turns.append(ChatMessage(role=role, text=text))
        if len(self._turns) > self.max_turns:
            self._turns = self._turns[-self.max_turns :]

    def messages(self) -> list[ChatMessage]:
        """A copy of the current history, oldest first."""
        return list(self._turns)

    def clear(self) -> None:
        self._turns.clear()
