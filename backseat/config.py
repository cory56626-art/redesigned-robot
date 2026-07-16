"""Settings persisted as JSON in %APPDATA%\\Backseat (or ~/.config/backseat).

API keys do NOT live here — they're in the OS keyring via keys.py. The
``api_key`` field below only remains so step-1 installs migrate cleanly
(``__main__`` moves any value into the keyring and blanks it on startup).
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

from .capture.privacy import DEFAULT_BLOCKLIST

APP_NAME = "Backseat"


def config_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if appdata:  # Windows — the target platform
        return Path(appdata) / APP_NAME
    base = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
    return Path(base) / APP_NAME.lower()


def settings_path() -> Path:
    return config_dir() / "settings.json"


@dataclass
class Settings:
    provider: str = "google"
    # Empty means "not chosen yet" — model names are account-dependent
    # (see CLAUDE.md), so the app asks the provider for its list rather
    # than assuming.
    model: str = ""
    api_key: str = ""  # legacy step-1 field; auto-migrated to the keyring
    ollama_host: str = "http://localhost:11434"
    max_image_width: int = 1024
    jpeg_quality: int = 70
    monitor: int = 1
    max_history_turns: int = 20
    # Director timing (see director.py). chattiness moves into personas
    # in step 4; until then it's a plain setting.
    capture_interval: float = 4.0  # local hash cadence, costs no API calls
    min_cooldown: float = 25.0
    max_cooldown: float = 70.0
    chattiness: float = 0.4
    privacy_blocklist: list[str] = field(default_factory=lambda: list(DEFAULT_BLOCKLIST))


def load_settings(path: Path | None = None) -> Settings:
    """Load settings, tolerating a missing file and unknown/extra keys."""
    path = path or settings_path()
    if not path.exists():
        return Settings()
    data = json.loads(path.read_text(encoding="utf-8"))
    known = {f.name for f in fields(Settings)}
    return Settings(**{k: v for k, v in data.items() if k in known})


def save_settings(settings: Settings, path: Path | None = None) -> Path:
    path = path or settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(settings), indent=2), encoding="utf-8")
    return path
