#!/usr/bin/env python3
"""
team.py — group-chat harness for the Pixel Keep dev team.

Claude (the boss) routes messages to teammates and logs everything to
TEAM_CHAT.md so the whole collaboration is on the record.

Roles:
  groq    -> Groq    : fast prototyper, balance (llama-3.3-70b-versatile)
  mistral -> Mistral : clean code + debugging (mistral-large-latest)
  gemini  -> Gemini  : UI / visual design (gemini-2.0-flash)

Usage:
  python3 tools/team.py <agent> "<message>"          # ask one teammate
  python3 tools/team.py post "<speaker>" "<message>"  # log a message (e.g. Claude)
"""
import os
import sys
import json
import urllib.request
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAT = os.path.join(ROOT, "TEAM_CHAT.md")

ROLES = {
    "groq": {
        "name": "Groq",
        "title": "Fast Prototyper",
        "system": (
            "You are Groq, the rapid-prototyper on a small game-dev team building "
            "'Pixel Keep', a single-file HTML idle-RPG. You move FAST and concrete: "
            "balance numbers, core-loop logic, gameplay feel. When reviewing code you "
            "give a short list of specific, actionable fixes (cite the symbol/line idea). "
            "Be terse and ship-focused. No fluff. Claude is the lead and integrates "
            "everything into one index.html. Refer to yourself only as Groq."
        ),
    },
    "mistral": {
        "name": "Mistral",
        "title": "Clean Code & Debug",
        "system": (
            "You are Mistral, the clean-code and debugging specialist on a game-dev team "
            "building 'Pixel Keep', a single-file HTML idle-RPG (vanilla JS + canvas). "
            "You hunt real bugs: state management, the game loop, save/load, NaN, leaks, "
            "logic errors. When given code you return a numbered list of precise, "
            "actionable fixes — quote the offending code. Be rigorous and concise. Claude "
            "is the lead integrator. Refer to yourself only as Mistral."
        ),
    },
    "gemini": {
        "name": "Gemini",
        "title": "UI / Visual Design",
        "system": (
            "You are Gemini, the UI and visual designer on a game-dev team building "
            "'Pixel Keep', a single-file HTML idle-RPG. You critique and improve layout, "
            "color palettes (hex codes), typography, and game-feel (animation, juice). "
            "Give specific values devs can paste in. Claude is the lead integrator. "
            "Refer to yourself only as Gemini."
        ),
    },
}


def log(speaker, text):
    ts = datetime.datetime.now().strftime("%H:%M")
    with open(CHAT, "a") as f:
        f.write(f"\n**[{ts}] {speaker}:**\n\n{text.strip()}\n")


def call_groq(system, user):
    body = json.dumps({
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": 0.8, "max_tokens": 1200,
    }).encode()
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions", data=body,
        headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}",
                 "Content-Type": "application/json",
                 "User-Agent": "Mozilla/5.0 (PixelKeep-DevTeam)"})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    return d["choices"][0]["message"]["content"]


def call_mistral(system, user):
    body = json.dumps({
        "model": "mistral-large-latest",
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": 0.4, "max_tokens": 1800,
    }).encode()
    req = urllib.request.Request(
        "https://api.mistral.ai/v1/chat/completions", data=body,
        headers={"Authorization": f"Bearer {os.environ['MISTRAL_API_KEY']}",
                 "Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=180))
    return d["choices"][0]["message"]["content"]


def call_gemini(system, user):
    body = json.dumps({
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"parts": [{"text": user}]}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1500,
                             },
    }).encode()
    url = ("https://generativelanguage.googleapis.com/v1beta/models/"
           f"gemini-flash-lite-latest:generateContent?key={os.environ['GEMINI_API_KEY']}")
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=180))
    return d["candidates"][0]["content"]["parts"][0]["text"]


CALLERS = {"groq": call_groq, "mistral": call_mistral, "gemini": call_gemini}


def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    agent = sys.argv[1].lower()
    if agent == "post":
        log(sys.argv[2], sys.argv[3]); print("logged."); return
    role = ROLES[agent]
    user = sys.argv[2]
    # optional code attachment: 3rd arg = path to a file to include
    attach = ""
    if len(sys.argv) > 3 and os.path.exists(sys.argv[3]):
        with open(sys.argv[3]) as f:
            code = f.read()
        attach = f"\n\n[CURRENT index.html — review this exact code]\n```html\n{code}\n```\n"
    # include recent chat so teammates have context
    context = ""
    if os.path.exists(CHAT):
        with open(CHAT) as f:
            context = f.read()[-4000:]
    prompt = (f"[recent team chat]\n{context}\n{attach}\n"
              f"[Claude -> {role['name']}]: {user}")
    reply = CALLERS[agent](role["system"], prompt)
    speaker = f"{role['name']} ({role['title']}, via {agent})"
    log(speaker, reply)
    print(reply)


if __name__ == "__main__":
    main()
