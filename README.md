# Backseat

An AI backseat gamer: a desktop companion that watches your screen while you
play, chats with you, and pipes up with commentary of its own — swappable
personalities, TTS voices, and multiple AI providers (Google's free tier by
default). Formerly "Mine Buddy", which lives on as the default persona.

**Status: rebuild in progress** — see `PLAN.md` for the roadmap. Done so
far: step 1 (package skeleton + provider layer), step 2 (multi-key rotation
+ secure key storage), step 3 (the director — lively, cheap comment
timing). The windowed app, personas, TTS, and the rest land in the
following steps; until then it runs as a console chat.

## Try it now (console mode)

1. Install (from the repo folder):
   ```
   pip install -e .[google]
   ```
   (Use `.[anthropic]` or `.[openai]` for those providers instead. Ollama
   needs no extra install.)

2. Get a free Google API key: https://aistudio.google.com/app/apikey

3. Save your key once — it goes into Windows Credential Manager, not a file:
   ```
   python -m backseat --add-key YOUR-KEY-HERE
   ```
   Have more keys? Run `--add-key` once per key. Backseat rotates through
   them automatically and rests any key that hits its rate limit.
   (`--list-keys` and `--remove-key` manage the pool.)

4. First run lists the models your key can access. Pick one with "gemma" in
   the name and save it:
   ```
   python -m backseat --model models/gemma-4-31b-it
   ```

5. Run it:
   ```
   python -m backseat
   ```
   Play in windowed or borderless mode (not exclusive fullscreen) so the
   screen can be captured. Type in the console to chat; `quit` to exit.

No API key? Kick the tires with canned replies:
```
python -m backseat --provider mock
```

## Building Backseat.exe

On your Windows PC, double-click **`build\build_windows.bat`**. It sets up a
clean environment, installs everything, and produces
`dist\Backseat\Backseat.exe` — keep that whole folder together; the exe
needs the files beside it. (A proper `BackseatSetup.exe` installer with
Start Menu shortcuts comes in PLAN step 8.)

Notes:
- The exe can only be built on Windows (PyInstaller doesn't cross-compile).
- Windows SmartScreen may warn about an unsigned exe the first time — click
  "More info" → "Run anyway". It's your own build.

## Repo layout

- `backseat/` — the application package (see `PLAN.md` for the full map).
  - `providers/` — provider-agnostic LLM layer: Google, Anthropic, OpenAI,
    local Ollama, and a quota-free mock. All calls get exponential-backoff
    retry; rate-limit errors are surfaced for key rotation (step 2).
  - `capture/` — mss screenshot → downscale → JPEG pipeline.
  - `memory.py`, `config.py`, `app.py`, `__main__.py` — history, settings
    (`%APPDATA%\Backseat\settings.json`), and the console app.
- `prototype/` — the original working console scripts, kept for reference.
- `tests/` — unit tests for the pure logic (`pip install -e .[dev]`, then
  `python -m pytest`).

## How commenting works now (the director)

Backseat looks at your screen every few seconds **locally** (costing
nothing), fingerprints the frame, and only spends an API request when the
scene actually changed AND a randomized cooldown has passed. Bursts of
action make it chattier; quiet mining makes it back off; near-duplicate
comments get dropped. Net effect: livelier timing with *fewer* API calls
than the old fixed 20-second poll.

It also never captures while a password manager (or any window title on
your blocklist — `privacy_blocklist` in settings.json) is focused; the
console prints watching/paused transitions so you always know.

## Known limitations (current step)

- Console UI, no TTS, single hardcoded personality yet — coming in later
  PLAN.md steps.
- Free Google tier: rate-limited (multiple keys soften this), and
  prompts/outputs may be used to improve Google's models (not private the
  way a paid tier is).

See `CLAUDE.md` for project history and design decisions.
