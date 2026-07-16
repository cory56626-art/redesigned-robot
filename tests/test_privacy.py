import sys

from backseat.capture.privacy import DEFAULT_BLOCKLIST, PrivacyGuard, focused_window_title


def test_blocks_case_insensitive_substring():
    guard = PrivacyGuard(["KeePass", "My Bank"])
    assert guard.is_blocked("Passwords - keepass 2.57")
    assert guard.is_blocked("MY BANK - login")
    assert not guard.is_blocked("Minecraft 1.21")


def test_unknown_title_is_not_blocked():
    guard = PrivacyGuard(["password"])
    assert not guard.is_blocked(None)
    assert not guard.is_blocked("")


def test_empty_blocklist_blocks_nothing():
    guard = PrivacyGuard([])
    assert not guard.is_blocked("KeePass")


def test_default_blocklist_covers_password_managers():
    guard = PrivacyGuard()
    assert guard.blocklist == DEFAULT_BLOCKLIST
    for title in ("Bitwarden", "KeePassXC", "1Password — vault", "Chrome password manager"):
        assert guard.is_blocked(title)


def test_focused_window_title_is_none_off_windows():
    if sys.platform != "win32":
        assert focused_window_title() is None
