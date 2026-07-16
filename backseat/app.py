"""App wiring.

For now this is a console app with prototype feature-parity, running on the
new provider layer — it exists so each build step stays runnable end-to-end.
The pywebview window replaces it in PLAN step 7; the fixed-interval glance
loop below is replaced by the director in step 3.
"""

from __future__ import annotations

import threading
import time

from .capture import capture_screenshot
from .config import Settings
from .keys import KEYED_PROVIDERS, KeyPool, KeyStore, RotatingProvider
from .memory import Memory
from .providers import ChatMessage, LLMProvider, ProviderError, build_provider, with_retry

# Lives here only until the persona system (PLAN step 4) turns it into
# builtin/mine-buddy.json.
DEFAULT_PERSONALITY = """You are Mine Buddy, a witty, easygoing gaming companion watching someone
play a game over their shoulder. You have personality: dry humor, genuine
enthusiasm about cool finds, light teasing when they do something silly, and
real, useful tips when it matters (threats, low health, obvious crafting
opportunities, resource management, better strategies).

Ground rules:
- Keep every response SHORT: 1-2 sentences, like a friend actually talking, not an essay.
- When you're only glancing at the screen periodically (not responding to a direct
  question), only speak up if something is genuinely notable (danger nearby, a
  good opportunity, a funny or interesting moment, a mistake worth flagging).
  If nothing's worth commenting on, respond with exactly: SKIP
- When the player directly asks or says something to you, always respond -
  never SKIP a direct message.
- Don't narrate mundane gameplay unless there's a reason to.
"""

GLANCE_PROMPT = (
    "(This is an automatic glance at the screen, not a direct question. "
    "Comment only if something's notable, otherwise reply exactly SKIP.)"
)

SKIP = "SKIP"


class Backseat:
    """One companion session: provider + memory + capture settings."""

    def __init__(self, provider: LLMProvider, settings: Settings):
        self.provider = provider
        self.settings = settings
        self.memory = Memory(max_turns=settings.max_history_turns)
        self._lock = threading.Lock()  # auto-comments and questions must not collide

    def _capture(self) -> list[bytes]:
        return [
            capture_screenshot(
                max_width=self.settings.max_image_width,
                jpeg_quality=self.settings.jpeg_quality,
                monitor=self.settings.monitor,
            )
        ]

    def _ask(self, text: str, images: list[bytes]) -> str:
        messages = self.memory.messages() + [ChatMessage(role="user", text=text)]
        reply = with_retry(
            lambda: self.provider.chat(messages, images, DEFAULT_PERSONALITY)
        )
        self.memory.add("user", text)
        self.memory.add("assistant", reply)
        return reply

    def say(self, text: str) -> str:
        """A direct message from the player, with a fresh screenshot."""
        with self._lock:
            return self._ask(text, self._capture())

    def glance(self) -> str | None:
        """Auto-glance: returns a comment, or None when the model says SKIP."""
        with self._lock:
            reply = self._ask(GLANCE_PROMPT, self._capture())
        if not reply or reply.strip().upper() == SKIP:
            return None
        return reply


def make_provider(settings: Settings, store: KeyStore | None = None) -> LLMProvider:
    """Build the configured provider, wrapped in key rotation when keyed."""
    if settings.provider not in KEYED_PROVIDERS:
        return build_provider(
            settings.provider, model=settings.model, ollama_host=settings.ollama_host
        )
    store = store or KeyStore()
    keys = store.load(settings.provider)
    if not keys:
        raise ProviderError(
            f"No API keys stored for '{settings.provider}'. "
            "Add one with:  python -m backseat --add-key YOUR-KEY-HERE"
        )
    factory = lambda key: build_provider(
        settings.provider, api_key=key, model=settings.model
    )
    return RotatingProvider(factory, KeyPool(keys), name=settings.provider)


def run_console(settings: Settings) -> None:
    provider = make_provider(settings)
    if not settings.model and provider.name != "mock":
        print("No model set yet. Models available to your key/install:\n")
        try:
            for name in provider.list_models():
                print(f"  {name}")
        except ProviderError as err:
            print(f"  (could not list models: {err})")
        print("\nPick one and run again with:  python -m backseat --model MODEL-NAME")
        return

    session = Backseat(provider, settings)

    keys_note = (
        f", {len(provider.pool)} key(s) in rotation"
        if isinstance(provider, RotatingProvider)
        else ""
    )
    print(
        f"Backseat is watching your screen ({provider.name}: "
        f"{settings.model or 'default'}{keys_note}). "
        "Type anytime to chat, or 'quit' to exit.\n"
    )

    def glance_loop() -> None:
        while True:
            time.sleep(settings.comment_interval)
            try:
                comment = session.glance()
                if comment:
                    print(f"\n[Backseat]: {comment}\n> ", end="", flush=True)
            except ProviderError as err:
                print(f"\n[Backseat - auto-comment error]: {err}\n> ", end="", flush=True)

    threading.Thread(target=glance_loop, daemon=True).start()

    while True:
        try:
            user_text = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user_text:
            continue
        if user_text.lower() in ("quit", "exit"):
            break
        try:
            print(f"[Backseat]: {session.say(user_text)}\n")
        except ProviderError as err:
            print(f"[Backseat - error]: {err}\n")

    print("Catch you later!")
