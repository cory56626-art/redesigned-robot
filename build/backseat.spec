# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Backseat.

Build ON WINDOWS by double-clicking build\\build_windows.bat — PyInstaller
cannot cross-compile, so a Windows exe can only be produced on Windows.

One-folder mode per PLAN step 8 (faster startup, fewer antivirus false
positives than --onefile). console=True while Backseat is a console app;
PLAN step 7 (the pywebview window) flips this to False. The Inno Setup
installer also arrives in step 8.
"""

import os

from PyInstaller.utils.hooks import collect_submodules

repo_root = os.path.abspath(os.path.join(SPECPATH, ".."))

# Providers and capture import their SDKs lazily (inside functions/ctors),
# so PyInstaller's import tracer misses them — list everything explicitly.
hiddenimports = [
    "backseat.providers.google",
    "backseat.providers.anthropic",
    "backseat.providers.openai",
    "backseat.providers.ollama",
    "backseat.providers.mock",
    "mss",
    "PIL.Image",
    "keyring.backends.Windows",
]

# Bundle whichever provider SDKs are installed in the build environment.
for sdk in ("google.genai", "anthropic", "openai"):
    try:
        __import__(sdk)
        hiddenimports += collect_submodules(sdk)
    except ImportError:
        pass

a = Analysis(
    [os.path.join(SPECPATH, "launch.py")],
    pathex=[repo_root],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    # pywebview (step 7) pulls PyQt into the bundle if it's merely
    # installed — keep these excluded permanently.
    excludes=["PyQt5", "PyQt6", "PySide2", "PySide6", "tkinter"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Backseat",
    debug=False,
    strip=False,
    upx=False,
    console=True,  # -> False in PLAN step 7 when the window replaces the terminal
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Backseat",
)
