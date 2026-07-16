from backseat.app import GLANCE_PROMPT
from backseat.providers import build_provider
from backseat.providers.base import ChatMessage
from backseat.providers.mock import GLANCE_SPEAK_EVERY, MockProvider


def glance(provider):
    return provider.chat([ChatMessage("user", GLANCE_PROMPT)], [], "sys")


def test_direct_messages_always_get_a_reply():
    provider = MockProvider()
    for i in range(6):
        reply = provider.chat([ChatMessage("user", f"hello {i}")], [], "sys")
        assert reply and reply != "SKIP"


def test_glances_mostly_skip_but_sometimes_speak():
    provider = MockProvider()
    replies = [glance(provider) for _ in range(GLANCE_SPEAK_EVERY * 3)]
    spoke = [r for r in replies if r != "SKIP"]
    skipped = [r for r in replies if r == "SKIP"]
    assert len(spoke) == 3
    assert len(skipped) == GLANCE_SPEAK_EVERY * 3 - 3


def test_registry_builds_mock_without_key():
    provider = build_provider("mock")
    assert provider.name == "mock"
    assert provider.list_models() == ["mock-1"]


def test_registry_rejects_unknown_provider():
    import pytest

    with pytest.raises(ValueError):
        build_provider("skynet")
