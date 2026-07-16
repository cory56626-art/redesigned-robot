"""Entry point: ``python -m backseat``.

Console mode is the only mode for now; the pywebview window arrives in
PLAN step 7 and will become the default, with ``--console`` kept for
debugging.
"""

from __future__ import annotations

import argparse
import sys

from . import __version__
from .config import load_settings, save_settings, settings_path
from .providers import PROVIDER_NAMES


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="backseat",
        description="An AI backseat gamer: watches your screen, comments, and chats.",
    )
    parser.add_argument("--version", action="version", version=f"backseat {__version__}")
    parser.add_argument(
        "--provider",
        choices=PROVIDER_NAMES,
        help="switch provider (saved to settings.json)",
    )
    parser.add_argument("--model", help="set the model id (saved to settings.json)")
    parser.add_argument(
        "--api-key",
        help="set the API key and save it to settings (temporary until keyring support)",
    )
    parser.add_argument(
        "--show-config",
        action="store_true",
        help="print the settings file location and current values, then exit",
    )
    args = parser.parse_args()

    settings = load_settings()

    changed = False
    if args.api_key:
        settings.api_key = args.api_key
        changed = True
    if args.provider:
        settings.provider = args.provider
        changed = True
    if args.model:
        settings.model = args.model
        changed = True
    if changed:
        save_settings(settings)
        print(f"Saved to {settings_path()}")

    if args.show_config:
        print(f"Settings file: {settings_path()}")
        print(f"  provider: {settings.provider}")
        print(f"  model:    {settings.model or '(not set)'}")
        print(f"  api key:  {'set' if settings.api_key else '(not set)'}")
        return

    if settings.provider in ("google", "anthropic", "openai") and not settings.api_key:
        print(
            f"ERROR: no API key set for provider '{settings.provider}'.\n"
            "Run once with:  python -m backseat --api-key YOUR-KEY-HERE\n"
            "(or use --provider mock to try Backseat with no key at all)"
        )
        sys.exit(1)

    from .app import run_console

    run_console(settings)


if __name__ == "__main__":
    main()
