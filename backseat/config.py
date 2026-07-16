"""Settings persisted as JSON in %APPDATA%\\Backseat (or ~/.config/backseat).

NOTE: ``api_key`` living in this JSON is a stopgap for the console phase
only. PLAN step 2 (keys.py) moves keys into Windows Credential Manager via
``keyring`` and adds the multi-key pool; this field is deleted then.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path

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
    api_key: str = ""  # temporary; replaced by keyring in PLAN step 2
    ollama_host: str = "http://localhost:11434"
    comment_interval: int = 20  # seconds; replaced by the director in step 3
    max_image_width: int = 1024
    jpeg_quality: int = 70
    monitor: int = 1
    max_history_turns: int = 20


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
