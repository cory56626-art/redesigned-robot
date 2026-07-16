"""PyInstaller entry script — a plain script (not a package module) so
relative imports inside the backseat package work when frozen."""

from backseat.__main__ import main

main()
