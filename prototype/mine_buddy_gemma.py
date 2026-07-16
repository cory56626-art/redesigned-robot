#!/usr/bin/env python3
"""
Mine Buddy (Gemma edition) - a local AI companion that watches your Minecraft
screen and chats with you via text, powered by Google's Gemma 3 vision model
through Google AI Studio's free API tier.

SETUP
-----
1. pip install google-genai mss pillow
2. Get a free API key: https://aistudio.google.com/app/apikey
3. Set it as an environment variable before running:
   Windows (PowerShell):  $env:GOOGLE_API_KEY="your-key-here"
   Windows (cmd):         set GOOGLE_API_KEY=your-key-here
   Mac/Linux:             export GOOGLE_API_KEY="your-key-here"
4. Run: python mine_buddy_gemma.py
5. Play Minecraft in windowed or borderless mode (not exclusive fullscreen)
   so this script can screenshot alongside it. Type in this console anytime
   to chat. Type 'quit' to exit.

NOTE ON THE FREE TIER
----------------------
Google's free tier has rate limits (requests per minute / per day) and its
terms allow prompts/outputs to be used to improve Google's models. That's
fine for casual personal use — just know the data isn't private the way a
paid tier would be. If you hit rate limit errors, the script will print
them; just wait a bit and try again, or increase COMMENT_INTERVAL below.

HOW IT WORKS
------------
- A background thread takes a screenshot every COMMENT_INTERVAL seconds and
  asks Gemma to comment ONLY if something's actually worth saying.
- The main thread waits for you to type. When you do, it grabs a fresh
  screenshot, sends your message + the image, and prints the reply.
- A lock makes sure only one API call happens at a time.
"""

import base64
import io
import os
import sys
import threading
import time

import mss
from PIL import Image
from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# CONFIG - tweak these freely
# ---------------------------------------------------------------------------

MODEL = "models/gemma-4-31b-it"     # also available: "models/gemma-4-26b-a4b-it" (faster, mixture-of-experts)
COMMENT_INTERVAL = 20         # seconds between automatic "glance at the screen" checks
MAX_IMAGE_WIDTH = 1024        # downscale screenshots to save on tokens/cost

PERSONALITY = """You are Mine Buddy, a witty, easygoing gaming companion watching someone
play Minecraft over their shoulder. You have personality: dry humor, genuine
enthusiasm about cool finds, light teasing when they do something silly, and
real, useful tips when it matters (mob threats, low health, obvious crafting
opportunities, resource management, better strategies).

Ground rules:
- Keep every response SHORT: 1-2 sentences, like a friend actually talking, not an essay.
- When you're only glancing at the screen periodically (not responding to a direct
  question), only speak up if something is genuinely notable (danger nearby, a
  good opportunity, a funny or interesting moment, a mistake worth flagging).
  If nothing's worth commenting on, respond with exactly: SKIP
- When the player directly asks or says something to you, always respond -
  never SKIP a direct message.
- Don't narrate mundane walking/mining unless there's a reason to.
"""

# ---------------------------------------------------------------------------

client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY"))
lock = threading.Lock()
conversation = []  # list of types.Content, alternating user/model turns
MAX_HISTORY = 20   # trim after this many turns


def capture_screenshot_bytes():
    """Grab the primary screen, downscale it, return raw JPEG bytes."""
    with mss.MSS() as sct:
        monitor = sct.monitors[1]  # primary monitor
        shot = sct.grab(monitor)
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

    if img.width > MAX_IMAGE_WIDTH:
        ratio = MAX_IMAGE_WIDTH / img.width
        img = img.resize((MAX_IMAGE_WIDTH, int(img.height * ratio)))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


def trim_history():
    global conversation
    if len(conversation) > MAX_HISTORY:
        conversation = conversation[-MAX_HISTORY:]


def ask_gemma(user_text, image_bytes):
    """Send a message (with a screenshot) to Gemma and return the text reply."""
    parts = []
    if image_bytes:
        parts.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
    parts.append(types.Part.from_text(text=user_text))

    turn = types.Content(role="user", parts=parts)
    contents = conversation + [turn]

    response = client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=PERSONALITY,
            max_output_tokens=300,
        ),
    )

    reply = (response.text or "").strip()

    # Store a lightweight (text-only) version in history so it doesn't balloon with images
    conversation.append(types.Content(role="user", parts=[types.Part.from_text(text=user_text)]))
    conversation.append(types.Content(role="model", parts=[types.Part.from_text(text=reply)]))
    trim_history()

    return reply


def commentary_loop():
    """Background thread: periodically glance at the screen and maybe comment."""
    while True:
        time.sleep(COMMENT_INTERVAL)
        try:
            image_bytes = capture_screenshot_bytes()
            with lock:
                reply = ask_gemma(
                    "(This is an automatic glance at the screen, not a direct question. "
                    "Comment only if something's notable, otherwise reply exactly SKIP.)",
                    image_bytes,
                )
            if reply and reply.strip().upper() != "SKIP":
                print(f"\n[Mine Buddy]: {reply}\n> ", end="", flush=True)
        except Exception as e:
            print(f"\n[Mine Buddy - error during auto-comment]: {e}\n> ", end="", flush=True)


def main():
    if not os.environ.get("GOOGLE_API_KEY"):
        print("ERROR: Set the GOOGLE_API_KEY environment variable first. See the top of this file.")
        print("Get a free key at: https://aistudio.google.com/app/apikey")
        sys.exit(1)

    print("Mine Buddy (Gemma edition) is watching your screen. Type anytime to chat, or 'quit' to exit.\n")

    t = threading.Thread(target=commentary_loop, daemon=True)
    t.start()

    while True:
        try:
            user_text = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break

        if not user_text:
            continue
        if user_text.lower() in ("quit", "exit"):
            break

        try:
            image_bytes = capture_screenshot_bytes()
            with lock:
                reply = ask_gemma(user_text, image_bytes)
            print(f"[Mine Buddy]: {reply}\n")
        except Exception as e:
            print(f"[Mine Buddy - error]: {e}\n")

    print("Catch you later!")


if __name__ == "__main__":
    main()
