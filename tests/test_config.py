import json

from backseat.config import Settings, load_settings, save_settings


def test_missing_file_gives_defaults(tmp_path):
    settings = load_settings(tmp_path / "nope.json")
    assert settings == Settings()


def test_round_trip(tmp_path):
    path = tmp_path / "settings.json"
    original = Settings(provider="ollama", model="gemma3", comment_interval=45)
    save_settings(original, path)
    assert load_settings(path) == original


def test_unknown_keys_from_older_or_newer_versions_are_ignored(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"provider": "mock", "some_future_setting": 1}))
    settings = load_settings(path)
    assert settings.provider == "mock"


def test_save_creates_parent_dirs(tmp_path):
    path = tmp_path / "deep" / "dir" / "settings.json"
    save_settings(Settings(), path)
    assert path.exists()
