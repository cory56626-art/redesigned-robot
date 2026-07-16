#!/usr/bin/env python3
"""Diagnostic: list every model your Google API key can access.

Model names are account-dependent and change over time. If the prototype
hits a 404 "model not found", run this and copy an exact name into MODEL.

    pip install google-genai
    set GOOGLE_API_KEY=your-key-here   (Windows cmd)
    python list_models.py
"""
import os
import sys

from google import genai

if not os.environ.get("GOOGLE_API_KEY"):
    print("ERROR: Set the GOOGLE_API_KEY environment variable first.")
    sys.exit(1)

client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
for model in client.models.list():
    print(model.name)
