"""Privacy blocklist: never capture when a sensitive window is focused.

This app screenshots the whole screen — the least it can do is refuse to
look while a password manager (or anything the user blocklists) is in the
foreground. The check happens BEFORE capture, so a blocked frame is never
even taken. The console prints watching/paused transitions; the step-7 UI
gets a proper indicator.
"""

from __future__ import annotations

import sys

DEFAULT_BLOCKLIST = [
    "password",
    "keepass",
    "bitwarden",
    "1password",
    "lastpass",
    "dashlane",
    "credential",
]


def focused_window_title() -> str | None:
    """Title of the foreground window. Windows-only; None elsewhere
    (and None means "can't tell", which the guard treats as not blocked)."""
    if sys.platform != "win32":
        return None
    import ctypes

    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


class PrivacyGuard:
    """Case-insensitive substring match of window titles against a blocklist."""

    def __init__(self, blocklist: list[str] | None = None):
        self.blocklist = DEFAULT_BLOCKLIST if blocklist is None else blocklist

    def is_blocked(self, title: str | None) -> bool:
        if not title:
            return False
        lowered = title.lower()
        return any(entry.lower() in lowered for entry in self.blocklist if entry)
