#!/usr/bin/env python3
"""
Mine Buddy - a local AI companion that watches your Minecraft screen and
comments/chats with you via text, using your own Anthropic API key.

SETUP
-----
1. pip install anthropic mss pillow
2. Get an API key: https://console.anthropic.com/settings/keys
3. Set it as an environment variable before running:
   Windows (PowerShell):  $env:ANTHROPIC_API_KEY="your-key-here"
   Windows (cmd):         set ANTHROPIC_API_KEY=your-key-here
   Mac/Linux:             export ANTHROPIC_API_KEY="your-key-here"
4. Run: python mine_buddy.py
5. Play Minecraft in a window (not exclusive fullscreen) so this script
   can screenshot alongside it. Type in this console anytime to chat.
   Type 'quit' to exit.

HOW IT WORKS
------------
- A background thread takes a screenshot every COMMENT_INTERVAL seconds
  and asks Claude to comment ONLY if something's actually worth saying
  (so it's not constantly narrating nothing).
- The main thread waits for you to type. When you do, it grabs a fresh
  screenshot, sends your message + the image, and prints the reply.
- A lock makes sure only one API call happens at a time so the automatic
  commentary and your questions don't collide.
"""

import base64
import io
import os
import sys
import threading
import time

import mss
from PIL import Image
from anthropic import Anthropic

# ---------------------------------------------------------------------------
# CONFIG - tweak these freely
# ---------------------------------------------------------------------------

MODEL = "claude-sonnet-5"          # swap to "claude-haiku-4-5-20251001" for cheaper/faster
COMMENT_INTERVAL = 20               # seconds between automatic "glance at the screen" checks
MAX_IMAGE_WIDTH = 1024               # downscale screenshots to save on tokens/cost

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

client = Anthropic()  # reads ANTHROPIC_API_KEY from environment automatically
lock = threading.Lock()
conversation = []  # rolling chat history (text only, images are attached fresh each call)
MAX_HISTORY = 20  # keep this many turns before trimming


def capture_screenshot_b64():
    """Grab the primary screen, downscale it, return base64 JPEG."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]  # primary monitor
        shot = sct.grab(monitor)
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

    if img.width > MAX_IMAGE_WIDTH:
        ratio = MAX_IMAGE_WIDTH / img.width
        img = img.resize((MAX_IMAGE_WIDTH, int(img.height * ratio)))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def trim_history():
    global conversation
    if len(conversation) > MAX_HISTORY:
        conversation = conversation[-MAX_HISTORY:]


def ask_claude(user_text, image_b64):
    """Send a message (with a screenshot) to Claude and return the text reply."""
    content = []
    if image_b64:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64},
        })
    content.append({"type": "text", "text": user_text})

    messages = conversation + [{"role": "user", "content": content}]

    response = client.messages.create(
        model=MODEL,
        max_tokens=300,
        system=PERSONALITY,
        messages=messages,
    )

    reply = "".join(block.text for block in response.content if block.type == "text").strip()

    # Store a lightweight (text-only) version in history so it doesn't balloon with images
    conversation.append({"role": "user", "content": user_text})
    conversation.append({"role": "assistant", "content": reply})
    trim_history()

    return reply


def commentary_loop():
    """Background thread: periodically glance at the screen and maybe comment."""
    while True:
        time.sleep(COMMENT_INTERVAL)
        try:
            image_b64 = capture_screenshot_b64()
            with lock:
                reply = ask_claude(
                    "(This is an automatic glance at the screen, not a direct question. "
                    "Comment only if something's notable, otherwise reply exactly SKIP.)",
                    image_b64,
                )
            if reply and reply.strip().upper() != "SKIP":
                print(f"\n[Mine Buddy]: {reply}\n> ", end="", flush=True)
        except Exception as e:
            print(f"\n[Mine Buddy - error during auto-comment]: {e}\n> ", end="", flush=True)


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: Set the ANTHROPIC_API_KEY environment variable first. See the top of this file.")
        sys.exit(1)

    print("Mine Buddy is watching your screen. Type anytime to chat, or 'quit' to exit.\n")

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
            image_b64 = capture_screenshot_b64()
            with lock:
                reply = ask_claude(user_text, image_b64)
            print(f"[Mine Buddy]: {reply}\n")
        except Exception as e:
            print(f"[Mine Buddy - error]: {e}\n")

    print("Catch you later!")


if __name__ == "__main__":
    main()
