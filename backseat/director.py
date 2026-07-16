"""The director: decides WHEN to speak — PLAN step 3 (not built yet).

Will replace the fixed-interval glance loop in app.py with: short local
capture cadence, perceptual-hash change detection (no API call when nothing
changed), jittered cooldowns, an energy/mood value, reply dedupe, and
pausing when the game isn't focused.
"""
