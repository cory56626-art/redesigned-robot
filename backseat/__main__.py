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
from .keys import KEYED_PROVIDERS, KeyStore, mask_key
from .providers import PROVIDER_NAMES, ProviderError


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
        "--add-key",
        metavar="KEY",
        help="add an API key for the current provider (stored in the OS keyring); "
        "run multiple times to build a rotation pool",
    )
    parser.add_argument(
        "--api-key",
        dest="add_key_alias",
        metavar="KEY",
        help=argparse.SUPPRESS,  # old name for --add-key, kept working
    )
    parser.add_argument(
        "--remove-key",
        metavar="KEY",
        help="remove a stored key (paste the full key or its masked form from --list-keys)",
    )
    parser.add_argument(
        "--list-keys",
        action="store_true",
        help="show stored keys (masked) for the current provider, then exit",
    )
    parser.add_argument(
        "--show-config",
        action="store_true",
        help="print the settings file location and current values, then exit",
    )
    args = parser.parse_args()

    settings = load_settings()

    changed = False
    if args.provider:
        settings.provider = args.provider
        changed = True
    if args.model:
        settings.model = args.model
        changed = True

    store = KeyStore()

    # One-time migration: the step-1 console stored a single key in
    # settings.json; move it into the keyring and scrub the JSON.
    if settings.api_key:
        if store.add(settings.provider, settings.api_key):
            print(f"Moved your API key out of settings.json into secure storage.")
        settings.api_key = ""
        changed = True

    key_to_add = args.add_key or args.add_key_alias
    if key_to_add:
        if store.add(settings.provider, key_to_add):
            count = len(store.load(settings.provider))
            print(
                f"Key {mask_key(key_to_add)} added for '{settings.provider}' "
                f"({count} key(s) in the pool)."
            )
        else:
            print(f"Key {mask_key(key_to_add)} is already stored.")

    if args.remove_key:
        if store.remove(settings.provider, args.remove_key):
            print("Key removed.")
        else:
            print("No matching key found. Use --list-keys to see what's stored.")

    if changed:
        save_settings(settings)

    if args.list_keys:
        keys = store.load(settings.provider)
        if not keys:
            print(f"No keys stored for '{settings.provider}'.")
        else:
            print(f"Keys stored for '{settings.provider}':")
            for k in keys:
                print(f"  {mask_key(k)}")
        return

    if args.show_config:
        print(f"Settings file: {settings_path()}")
        print(f"  provider: {settings.provider}")
        print(f"  model:    {settings.model or '(not set)'}")
        print(f"  keys:     {len(store.load(settings.provider))} stored")
        return

    if key_to_add or args.remove_key:
        return  # key management is its own command; don't also launch

    if settings.provider in KEYED_PROVIDERS and not store.load(settings.provider):
        print(
            f"ERROR: no API keys stored for provider '{settings.provider}'.\n"
            "Add one with:   python -m backseat --add-key YOUR-KEY-HERE\n"
            "(or use --provider mock to try Backseat with no key at all)"
        )
        sys.exit(1)

    from .app import run_console

    try:
        run_console(settings)
    except ProviderError as err:
        print(f"ERROR: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
