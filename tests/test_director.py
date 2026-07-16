"""Director timing tests — fake clock and jitter-free rng, no real waiting.

Frame hashes are plain ints: 0 as the baseline, (1 << n) - 1 flips n bits.
"""

from backseat.director import Director, DirectorConfig


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def tick(self, seconds):
        self.now += seconds

    def __call__(self):
        return self.now


class NoJitter:
    @staticmethod
    def uniform(a, b):
        return (a + b) / 2  # midpoint == 1.0x multiplier


def changed(bits=16, base=0):
    return base ^ ((1 << bits) - 1)


def make(clock=None, **cfg):
    clock = clock or FakeClock()
    return Director(DirectorConfig(**cfg), clock=clock, rng=NoJitter()), clock


def run_until_glance(director, clock, step=4.0, limit=1000):
    """Feed alternating changed frames until one triggers; return elapsed."""
    start = clock.now
    frame = 0
    for _ in range(limit):
        clock.tick(step)
        frame = changed(16, frame)  # every frame differs from the last
        if director.should_glance(frame):
            return clock.now - start
    raise AssertionError("never glanced")


def test_first_frame_is_baseline_only():
    director, _ = make()
    assert director.should_glance(changed(64)) is False


def test_static_screen_never_calls_api():
    director, clock = make()
    director.should_glance(0)
    for _ in range(500):  # half an hour of identical frames
        clock.tick(4)
        assert director.should_glance(0) is False


def test_change_during_cooldown_does_not_trigger():
    director, clock = make(min_cooldown=25, max_cooldown=70)
    director.should_glance(0)
    clock.tick(4)  # far inside the settle-in cooldown
    assert director.should_glance(changed(16)) is False


def test_change_after_cooldown_triggers_then_recools():
    director, clock = make()
    director.should_glance(0)
    clock.tick(200)  # any cooldown has long expired
    assert director.should_glance(changed(16)) is True
    clock.tick(4)
    assert director.should_glance(changed(16, changed(16))) is False  # cooling again


def test_small_wiggle_below_threshold_is_not_change():
    director, clock = make(change_threshold=8)
    director.should_glance(0)
    clock.tick(200)
    assert director.should_glance(changed(4)) is False  # only 4 bits moved


def test_chattier_persona_comments_sooner():
    quiet_director, quiet_clock = make(chattiness=0.0)
    chatty_director, chatty_clock = make(chattiness=1.0)
    quiet_director.should_glance(0)
    chatty_director.should_glance(0)
    assert run_until_glance(chatty_director, chatty_clock) < run_until_glance(
        quiet_director, quiet_clock
    )


def test_big_events_raise_energy_and_shorten_the_next_wait():
    calm_director, calm_clock = make()
    excited_director, excited_clock = make()
    calm_director.should_glance(0)
    excited_director.should_glance(0)
    # the excited one sees a huge scene change mid-cooldown (energy up)
    excited_clock.tick(4)
    calm_clock.tick(4)
    excited_director.should_glance(changed(64))
    calm_director.should_glance(changed(9))  # barely over threshold
    assert excited_director.energy > calm_director.energy
    assert run_until_glance(excited_director, excited_clock) <= run_until_glance(
        calm_director, calm_clock
    )


def test_energy_decays_over_quiet_time():
    director, clock = make(energy_halflife=60.0)
    director.should_glance(0)
    clock.tick(200)
    director.should_glance(changed(64))
    energy_after_event = director.energy
    clock.tick(60)
    director.should_glance(director._last_hash)  # same frame: quiet tick
    assert director.energy < energy_after_event * 0.6


def test_dedupe_drops_near_repeats():
    director, _ = make()
    assert director.approve_reply("careful, that creeper is right behind you!")
    assert not director.approve_reply("Careful — that creeper is right behind you")
    assert director.approve_reply("nice, a whole vein of diamonds down there")


def test_dedupe_window_forgets_old_replies():
    director, _ = make(dedupe_window=2)
    director.approve_reply("watch your hunger bar")
    director.approve_reply("nice house")
    director.approve_reply("big cave ahead")  # pushes the first one out
    assert director.approve_reply("watch your hunger bar")
