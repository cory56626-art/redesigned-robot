"""Screen capture: mss grab -> downscale -> JPEG bytes.

Coming later per PLAN.md: change.py (perceptual-hash scene-change
detection, step 3) and privacy.py (focused-window blocklist).
"""

from .screen import capture_screenshot

__all__ = ["capture_screenshot"]
