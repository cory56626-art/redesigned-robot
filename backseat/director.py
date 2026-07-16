"""The director: decides WHEN Backseat speaks — PLAN step 3.

The prototype burned an API request every 20 seconds even on a static
screen. The director inverts that: frames are hashed locally every few
seconds (free), and an API call happens only when

1. the screen meaningfully changed since the last frame (hamming distance
   over the perceptual hashes crosses a threshold), AND
2. a jittered cooldown has elapsed — never a metronome.

An energy value makes it lively: big scene changes raise energy, quiet
stretches decay it, and higher energy (or a chattier persona) shortens the
next cooldown. The persona `chattiness` trait (step 4) plugs straight into
DirectorConfig.

Replies also pass through a dedupe filter: anything fuzzy-matching a recent
comment is dropped, so it never says "careful with that lava" three times
in a row.
"""

from __future__ import annotations

import random
import time
from collections import deque
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Callable

from .capture.change import hamming


@dataclass
class DirectorConfig:
    chattiness: float = 0.4  # 0..1, the persona trait (step 4 wires this)
    min_cooldown: float = 25.0  # seconds; floor at max chattiness+energy
    max_cooldown: float = 70.0  # ceiling at zero chattiness+energy
    jitter: float = 0.25  # +/- fraction applied to every cooldown
    change_threshold: int = 8  # hamming bits (of 64) that count as "changed"
    energy_halflife: float = 60.0  # seconds for energy to decay by half
    dedupe_window: int = 6  # compare against this many recent replies
    dedupe_threshold: float = 0.85  # SequenceMatcher ratio that counts as a repeat


class Director:
    def __init__(
        self,
        config: DirectorConfig | None = None,
        *,
        clock: Callable[[], float] = time.time,
        rng: random.Random | None = None,
    ):
        self.config = config or DirectorConfig()
        self._clock = clock
        self._rng = rng or random.Random()
        self._last_hash: int | None = None
        self._last_observed: float | None = None
        self._next_allowed = 0.0
        self.energy = 0.0
        self._recent_replies: deque[str] = deque(maxlen=self.config.dedupe_window)

    # -- deciding when to call the API ------------------------------------

    def should_glance(self, frame_hash: int) -> bool:
        """Feed one frame hash; True means "spend an API call now"."""
        cfg = self.config
        now = self._clock()

        if self._last_observed is not None:
            elapsed = now - self._last_observed
            if elapsed > 0:
                self.energy *= 0.5 ** (elapsed / cfg.energy_halflife)
        self._last_observed = now

        if self._last_hash is None:
            # First frame: baseline only. Start a settle-in cooldown so the
            # app doesn't blurt something the instant it opens.
            self._last_hash = frame_hash
            self._next_allowed = now + self._cooldown()
            return False

        distance = hamming(frame_hash, self._last_hash)
        self._last_hash = frame_hash

        if distance < cfg.change_threshold:
            return False  # static screen: never call the API

        # A change always feeds energy, even mid-cooldown — a burst of
        # action makes the *next* comment come sooner.
        self.energy = min(1.0, self.energy + distance / 64.0)

        if now < self._next_allowed:
            return False

        self._next_allowed = now + self._cooldown()
        return True

    def _cooldown(self) -> float:
        cfg = self.config
        liveliness = min(1.0, max(0.0, 0.6 * cfg.chattiness + 0.4 * self.energy))
        base = cfg.max_cooldown - (cfg.max_cooldown - cfg.min_cooldown) * liveliness
        jittered = base * self._rng.uniform(1 - cfg.jitter, 1 + cfg.jitter)
        return max(cfg.min_cooldown * 0.5, jittered)

    # -- deciding whether a reply is worth saying --------------------------

    def approve_reply(self, reply: str) -> bool:
        """False if the reply near-repeats something recently said."""
        normalized = reply.strip().lower()
        for previous in self._recent_replies:
            if SequenceMatcher(None, normalized, previous).ratio() >= self.config.dedupe_threshold:
                return False
        self._recent_replies.append(normalized)
        return True
