# Backseat — from prototype script to real desktop app

> Approved plan, July 2026. "Backseat" (as in backseat gamer) is the new app name —
> game-agnostic, replaces "Mine Buddy" as the product name. The default persona is
> still called Mine Buddy.

## Context

Today's prototype (`mine_buddy_gemma.py`, ~185 lines) works end-to-end: a daemon thread screenshots the
primary monitor every 20s and asks Gemma to comment or reply `SKIP`; the main thread reads typed input;
a `threading.Lock` keeps the two from colliding. It proves the concept, but it's a console script — the
terminal UI is unpleasant, the personality is a hardcoded string constant, there's no voice, one API key,
and commenting is a fixed metronome.

The goal is a real installable Windows application with: a proper UI, swappable personalities, TTS,
lifelike comment timing, maturity settings, multi-key support, optional web search, and (later) a VRM
avatar.

**Decisions locked with the user:**
- **Name:** Backseat. Package `backseat`, app window `Backseat`, installer `BackseatSetup.exe`.
- **Stack:** Python backend + local web UI in a `pywebview` window (Edge WebView2), shipped via
  PyInstaller + Inno Setup. Chosen because VRM rendering means three.js, which means a webview.
- **Providers:** provider-agnostic layer — Google (Gemma/Gemini) stays the free default; Anthropic,
  OpenAI, and local Ollama supported.
- **TTS:** three pluggable engines — Edge (free), Fish Audio, Cartesia.
- **Scope:** phased. **v1 = everything except VRM and web search.** v2 = VRM + search.

**Non-goals for v1:** VRM avatar, web search, speech-to-text (no mic).

**Build/test note:** development happens in a cloud session; the target machine is the user's
Windows 10 PC (Python 3.11). Anything Windows-only (pywebview window behavior, keyring/Credential
Manager, PyInstaller/Inno builds, audio playback) must be verified on the user's machine — give them
simple step-by-step run instructions when a Windows check is needed.

---

## Two honest constraints that shape the design

1. **Maturity settings cannot be fully honored on Google's API.** Safety filters apply server-side
   regardless of the system prompt. The upper maturity tiers are best-effort on Google and only truly
   unrestricted on local Ollama. The UI must say this plainly rather than silently under-delivering.
2. **`transparent=True` is not supported on Windows in pywebview**
   (https://pywebview.flowrl.com/examples/transparent). `frameless` and `on_top` work. A
   see-through floating avatar therefore needs a spike in v2 (see Risks). v1 is unaffected.

---

## Architecture

One Python process. `pywebview` owns the window; the backend runs in threads behind it; the frontend is
static files built by Vite and bundled into the exe. Communication via pywebview's `js_api` (UI→Python)
and `window.evaluate_js()` (Python→UI, for pushing comments in as they arrive).

```
repo root
  pyproject.toml
  backseat\
    __main__.py          entry point — creates the webview window, starts the backend
    app.py               lifecycle wiring
    config.py            settings JSON in %APPDATA%\Backseat
    keys.py              multi-key pool, rotation, keyring-backed storage
    bridge.py            the Python<->JS surface (js_api)
    director.py          decides WHEN to speak  <- the "lively" feature
    memory.py            rolling history + notable-events journal
    maturity.py          tiers -> prompt clauses + provider capability gate
    capture\
      screen.py          mss capture, monitor/window targeting, downscale, JPEG
      change.py          perceptual-hash scene-change detection
      privacy.py         blocklist — skip capture when an excluded window is focused
    providers\
      base.py            LLMProvider ABC
      google.py  anthropic.py  openai.py  ollama.py  mock.py
      retry.py           exponential backoff; 429/500 handling; triggers key rotation
    persona\
      schema.py  store.py  prompt.py  builtin\*.json
    tts\
      base.py            TTSEngine ABC
      edge.py  fish.py  cartesia.py
      player.py          playback queue, interrupt/skip, amplitude taps (v2 lip-sync)
  ui\                    Vite + React + TypeScript -> static build
  build\
    backseat.spec        PyInstaller
    installer.iss        Inno Setup
```

The existing prototype is the reference for `capture/screen.py` and `providers/google.py` — the `mss` →
PIL → downscale → JPEG path and the `types.Part.from_bytes` / `GenerateContentConfig` call shape both
carry over almost verbatim. `list_models.py` becomes a "Refresh model list" button in settings rather
than a script the user runs by hand.

---

## v1 work, in build order

### 1. Skeleton + provider layer
Restructure into the package above. `LLMProvider` ABC with a single `chat(messages, images, system) -> reply`.
Port the working Google call from `mine_buddy_gemma.py` into `providers/google.py` first; add Ollama next
(it unlocks the top maturity tier); Anthropic/OpenAI after. `providers/mock.py` returns canned replies so
the director and UI can be developed without burning quota — build this early, it pays for itself.

Wrap every call in `retry.py`: exponential backoff over 3 attempts, which closes the known
`500 INTERNAL` open item from `CLAUDE.md`.

### 2. Multi-key support (`keys.py`)
A pool of keys per provider. Round-robin; on 429/quota-exhausted, mark that key cooling-down with a reset
timestamp and rotate to the next; surface per-key request counts in settings. Store keys in Windows
Credential Manager via `keyring` — **not** plaintext JSON, and no more `set GOOGLE_API_KEY=` per session.

### 3. The director (`director.py`) — "occasional comments, more realistic and lively"
This is the most interesting piece and it *reduces* API usage versus today. The current loop burns a
request every 20s even when the screen is identical and the model just says `SKIP`.

Instead:
- Capture on a short local cadence (~3-5s). Free — no API call.
- Perceptual-hash the frame against the last one. **If nothing meaningfully changed, never call the API.**
- On meaningful change *and* a randomized cooldown having elapsed (jittered, e.g. 25-70s — not a
  metronome), make the call.
- Track an energy/mood value: chime in more readily just after a big event, back off during a lull.
- Dedupe: fuzzy-match each new reply against the last N; drop near-repeats.
- Pause entirely when the game isn't focused, or a privacy-blocked window is.

The persona's `chattiness` trait feeds the cooldown directly, so the sliders in the editor drive real
behavior rather than just prose.

### 4. Personality system (`persona/`)
Personas are JSON files (user-editable, shippable, shareable):

```json
{
  "id": "mine-buddy",
  "name": "Mine Buddy",
  "description": "witty, easygoing gaming companion",
  "system_prompt": "...",
  "traits": { "snark": 0.7, "enthusiasm": 0.8, "helpfulness": 0.5, "chattiness": 0.4 },
  "speech_style": "1-2 sentences, lowercase, no emoji",
  "voice": { "engine": "cartesia", "voice_id": "...", "speed": 1.0 },
  "max_maturity": "edgy",
  "examples": [{ "situation": "...", "says": "..." }]
}
```

The current `PERSONALITY` constant ships as the default `mine-buddy.json`.

`prompt.py` composes the final system prompt from: persona core + maturity clause + mode clause +
**output contract**. Define the output contract now so v2 doesn't force a rewrite — ask for
`{"speak": bool, "text": str, "emotion": str}` with a lenient parser and the `SKIP` sentinel as fallback
(Gemma's structured output is unreliable). The `emotion` field is dead weight in v1 and drives VRM
expressions in v2 for free.

### 5. Maturity settings (`maturity.py`)
Four tiers: Family Friendly / Casual / Edgy / Unfiltered. Enforced two ways: prompt clauses, plus a
provider capability gate that tells the truth in the UI ("Unfiltered requires a local Ollama model;
on Google this is best-effort"). Set Gemini `safety_settings` to the most permissive the API allows.
Treat the tier as a **ceiling, not a target** — allowing profanity shouldn't force it.

### 6. TTS (`tts/`)
`TTSEngine` ABC over three backends, all verified pip-installable:
- **Edge** — `edge-tts`. Free, no key, natural. The sensible default.
- **Fish Audio** — `fish-audio-sdk`; `client.tts.convert()` / `.stream()`, voice cloning via `ReferenceAudio`.
- **Cartesia** — `cartesia` SDK v2, `sonic-3.5`, websocket streaming, ~40ms time-to-first-audio.

`player.py` owns a playback queue with interrupt/skip (a new comment shouldn't talk over the last one).
Build the amplitude tap now even though nothing consumes it — it's the v2 lip-sync feed, and Cartesia's
streaming is what makes that smooth.

### 7. UI (`ui/`)
Single window, no terminal ever again. Invoke the `frontend-design` skill before building — this is a
personality app and it should not look like a default template.
- Chat transcript, with spontaneous comments visually distinct from direct replies
- Input box; top bar with persona selector, mute, pause/watching indicator
- Persona editor: sliders, freeform prompt, voice picker with preview, **"Test" button that runs the
  persona against the current screen**
- Settings: providers + keys, TTS engine/voice, maturity, capture target, timing, privacy blocklist
- Usage/quota panel (per key)
- System tray icon + global hotkeys (mute, pause)
- **First-run wizard**: paste key → pick persona → pick voice → test. No env vars, no `cd`, no `pip`.

### 8. Packaging
PyInstaller **one-folder** (`--onedir`, not `--onefile` — faster start, fewer AV false positives),
`--noconsole`, with a spec file that excludes unused deps (pywebview pulls PyQt into the bundle if it's
merely installed). Then Inno Setup → `BackseatSetup.exe` with Start Menu + desktop shortcuts, and a
WebView2 runtime check (near-certain to be present on the user's Win10 19045, but the installer should
verify).

---

## Ideas worth folding in

- **Game-agnostic, per-game profiles.** Nothing here is Minecraft-specific except the persona text.
- **Window-targeted capture** instead of the whole monitor (already an open item in `CLAUDE.md`).
- **Privacy blocklist.** This app watches your entire screen. Never capture when a browser, password
  manager, or user-blocklisted window is focused. A visible "watching / paused" indicator, and all
  history stored locally.
- **Session memory / journal.** Beyond the 20-turn rolling window: a running list of notable events so it
  can say "that's the second creeper that got you." Big personality win for little cost.
- **Multi-frame context.** Send 2-3 recent frames so it perceives motion, not stills. Off by default
  (costs tokens), on for paid providers.
- **Clip/highlight export** — save the screenshot + comment when it says something good.

---

## Verification

- **Unit tests** for the pure logic — director timing/cooldown/dedupe, change detection, key rotation
  and cooldown, prompt composition, persona round-trip. All pure functions; no API needed.
- **`providers/mock.py`** drives the full UI and director loop with zero quota.
- **Manual, on the user's Windows PC against real Minecraft:** comments fire on scene changes and stay
  quiet on a static screen; each of the three TTS engines plays audio; persona swap visibly changes tone;
  maturity tiers change output; pulling a key mid-session rotates to the next.
- **Ship test:** build the installer, run the exe from a clean directory (not the source tree), confirm
  first-run wizard works with no Python on PATH.

---

## Risks

1. **VRM overlay transparency (v2).** pywebview can't do transparent windows on Windows. Options: a
   win32 layered-window chroma-key hack on the pywebview HWND (edge fringing), a separate Qt
   `QWebEngineView` overlay with `WA_TranslucentBackground`, or moving the shell to Electron. **Spike this
   at the start of v2** — it's the one thing that could retroactively challenge the stack choice.
2. **Free-tier rate limits.** Change-detection cuts calls hard, and key rotation absorbs the rest, but
   heavy use will still hit caps. Ollama is the pressure valve.
3. **Unsigned exe → SmartScreen warning**, and an app that screenshots + sends over the network is
   plausible AV bait. `--onedir` helps; code signing costs money and is likely not worth it for personal use.
4. **Gemma model names are account-dependent** — the lesson already in `CLAUDE.md`. The settings model
   list must be populated from `client.models.list()` at runtime, never hardcoded.
