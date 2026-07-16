"""Multi-API-key pool — PLAN step 2 (not built yet).

Will hold: per-provider key pools with round-robin rotation, cooldown on
429/quota-exhausted, per-key request counts, and keyring-backed storage in
Windows Credential Manager (replacing the temporary plaintext api_key field
in config.py).
"""
