# CLAUDE.md

This file gives Claude Code the context it needs to keep working on this project.

## Project: Backseat (formerly "Mine Buddy")

An AI companion desktop app that watches the user's screen while they game and
chats with them — personality-driven commentary, tips, and text back-and-forth,
now growing voice output. Renamed from "Mine Buddy" to **Backseat** (as in
backseat gamer) because nothing about it is Minecraft-specific; "Mine Buddy"
lives on as the name of the default persona.

### Current status (July 2026): rebuild underway — PLAN.md steps 1-3 DONE

**Step 3 (the director) is complete:**
- `capture/change.py`: dHash perceptual hashing (8x8, 64-bit) + hamming
  distance; JPEG re-compression stays under the change threshold (8 bits).
  Uses `tobytes()` — `getdata()` is deprecated in Pillow 12+.
- `director.py`: `Director.should_glance(frame_hash)` gates API calls on
  scene-change + jittered cooldown (25-70s, ±25%); energy value rises with
  change magnitude, halves per 60s of quiet, shortens cooldowns; persona
  `chattiness` plugs into `DirectorConfig` (step 4 wires it). Reply dedupe
  via `SequenceMatcher` ratio ≥ 0.85 over last 6 replies
  (`approve_reply`).
- `capture/privacy.py`: `PrivacyGuard` blocklist (substring,
  case-insensitive) + `focused_window_title()` (ctypes, Windows-only, None
  elsewhere = not blocked). Checked BEFORE capture; console prints
  watching/paused transitions. Default blocklist = password managers.
- `app.py` watch loop is director-driven; `comment_interval` setting
  replaced by `capture_interval`/`min_cooldown`/`max_cooldown`/
  `chattiness`/`privacy_blocklist`. Simulated run: 43 frames → 3 API
  calls (old design: 8). NOT yet verified against real gameplay on the
  user's PC.

**Next up: step 4 (personas)**, then maturity (step 5), TTS (step 6),
UI (step 7 — user cares a lot that it looks good; use the
frontend-design skill).

Earlier: **step 2 (multi-key support, `keys.py`) complete:**
- `KeyPool`: round-robin rotation; 429 marks a key cooling-down with a
  reset timestamp that doubles on consecutive limits (60s base, 15min cap);
  per-key request/rate-limit stats for the step-7 usage panel.
- `KeyStore`: keys in the OS keyring (Windows Credential Manager on the
  target PC). Falls back to `keys.json` in the config dir when no usable
  keyring exists (headless dev box) — probe must catch `BaseException`,
  a broken Linux SecretService backend raises a pyo3 `PanicException`.
- `RotatingProvider`: wraps keyed providers; retries the same request on
  the next key after a 429; raises rate_limited only when ALL keys cool.
- CLI: `--add-key` / `--remove-key` / `--list-keys`; old `--api-key` kept
  as a hidden alias; a key stored in settings.json by step 1 auto-migrates
  to the keyring on startup. ollama/mock need no keys.
- **Packaging scaffold (early slice of step 8):** `build/backseat.spec`
  (onedir, console=True until step 7, lazy-imported SDKs listed as
  hiddenimports, Qt excluded) + `build/build_windows.bat` (double-click
  build on the user's PC → `dist\Backseat\Backseat.exe`). PyInstaller
  cannot cross-compile — exe builds happen only on the user's Windows
  machine; the bat is written for that. NOT yet verified on Windows.

The project is being rebuilt into a real installable Windows app per
**`PLAN.md`** — read that file first; it is the approved roadmap and
architecture.

Earlier: **step 1 (skeleton + provider layer) complete:**
- `backseat/` package with the PLAN.md layout; later-step modules exist as
  docstring placeholders (`keys.py`, `director.py`, `maturity.py`,
  `bridge.py`, `persona/`, `tts/`).
- `providers/`: `LLMProvider` ABC (`chat(messages, images, system) -> str`),
  implementations for google (ported from prototype), ollama (plain HTTP,
  no SDK), anthropic, openai, and mock (canned replies, zero quota — use it
  to develop the director/UI). SDK imports are lazy; errors normalize to
  `ProviderError(retryable, rate_limited)`.
- `providers/retry.py`: exponential backoff, 3 attempts (closes the old
  `500 INTERNAL` open item); `on_rate_limit` hook ready for step-2 key
  rotation.
- `capture/screen.py` ported; `memory.py` rolling text-only history;
  `config.py` settings JSON in `%APPDATA%\Backseat` (api_key in JSON is a
  stopgap — step 2 replaces it with keyring).
- `python -m backseat` = console app with prototype parity (fixed-interval
  glance loop lives in `app.py` until the director replaces it in step 3).
- `tests/` cover retry, memory, config, mock, ollama payload shaping —
  20 passing. Prototype scripts moved to `prototype/` (reference only).

Key locked decisions:

- **Stack:** Python backend + web UI in a `pywebview` window (Edge WebView2);
  PyInstaller `--onedir` + Inno Setup for shipping. Chosen so a v2 VRM avatar
  (three.js) is possible.
- **Providers:** provider-agnostic layer (Google free tier default; Anthropic,
  OpenAI, local Ollama). Multi-API-key rotation with keys in Windows
  Credential Manager via `keyring`.
- **TTS:** pluggable engines — `edge-tts` (default, free), Fish Audio
  (`fish-audio-sdk`), Cartesia (`cartesia`, sonic-3.5, websocket streaming).
- **Maturity tiers:** Family Friendly / Casual / Edgy / Unfiltered. Honest
  capability gating: "Unfiltered" is only real on local Ollama — Google's
  server-side safety filters apply regardless of prompt.
- **Comment liveliness:** replace the fixed 20s API poll with local perceptual-
  hash change detection + jittered cooldowns (fewer API calls, livelier feel).
- **Scope:** v1 = app window, personas, TTS, maturity, multi-key, director.
  v2 = VRM avatar + web search. No speech-to-text (user has no mic).
- **Known v2 risk, already researched:** pywebview `transparent=True` does NOT
  work on Windows — the floating avatar overlay needs a spike (chroma-key
  layered window, Qt overlay, or Electron shell) at the start of v2.

### Development environment

- Code is developed in a Claude Code cloud session connected to this GitHub
  repo. **The target machine is the user's Windows 10 PC (Python 3.11,
  Node.js NOT installed yet).** Anything Windows-only — pywebview windowing,
  keyring, PyInstaller/Inno builds, audio playback — must be verified by the
  user on their machine; give them beginner-friendly step-by-step instructions
  when a local check is needed.

### Origin / history

- The user saw a YouTube video of someone talking to an AI that watched their
  gameplay, tried Questie AI, found the free tier too limited, and built a
  local script with a free-tier API instead.
- The prototype started on the Claude API (`mine_buddy.py`, kept for
  reference), then **switched to Google Gemini/Gemma for the free tier**
  (`mine_buddy_gemma.py`, the working version). Uses the `google-genai` SDK
  (`from google import genai`), NOT the deprecated `google-generativeai`.
- **Model names are account-dependent and change over time.** The user's
  account has Gemma 4: `models/gemma-4-31b-it` (default) and
  `models/gemma-4-26b-a4b-it` (MoE, faster). Never hardcode/assume model
  names — list them at runtime via `client.models.list()` (see
  `list_models.py`; in the new app this becomes a "Refresh models" button).
- Gemma accepts `system_instruction` via `GenerateContentConfig` — verified;
  the personality system builds on it.

### Prototype design notes that carry forward

- Screen capture via `mss` (use `mss.MSS()`, the lowercase alias is
  deprecated), downscaled to width 1024, JPEG quality 70.
- Conversation history is text-only (images never stored, only sent fresh),
  trimmed to 20 turns.
- One lock around API calls so auto-comments and user questions don't collide.
- Auto-glance prompt asks the model to reply exactly `SKIP` when nothing is
  notable. The new output contract ({"speak", "text", "emotion"} JSON with
  lenient parsing) keeps SKIP as a fallback since Gemma's structured output
  is unreliable.
- Intermittent `500 INTERNAL` errors from the Gemini API are transient —
  the rebuild adds exponential-backoff retry (3 attempts) around all calls.
- Free tier caveats: RPM/RPD rate limits, and Google may train on free-tier
  prompts/outputs (not private like a paid tier).

### Files in this repo

- `PLAN.md` — the approved rebuild plan: architecture, build order, risks.
- `backseat/` — the application package (step 1 layout above).
- `tests/` — unit tests for the pure logic; run with `python -m pytest`.
- `prototype/` — the original console scripts, reference only:
  `mine_buddy_gemma.py` (working Gemma version — capture pipeline and Google
  call shape), `mine_buddy.py` (earlier Claude-API version),
  `list_models.py` (lists models available to a Google key).
- `ui/` — placeholder; Vite + React frontend lands in step 7.
- `README.md` — current setup instructions (console mode).

### User context / preferences

- Windows 10 PC, gamer (Minecraft primarily), new to Python — keep
  run/debug instructions concrete and beginner-friendly (explain `pip
  install`, `cd`, etc. when relevant).
- Wants: personality-driven commentary, swappable personas, TTS voices,
  free/cheap to run, eventual VRM avatar.
- Not interested in: voice input (no mic), paid subscriptions.
