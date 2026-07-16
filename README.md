# Backseat

An AI backseat gamer: a desktop companion that watches your screen while you
play, chats with you, and pipes up with commentary of its own — swappable
personalities, TTS voices, and multiple AI providers (Google's free tier by
default). Formerly "Mine Buddy", which lives on as the default persona.

**Status: rebuild in progress** — see `PLAN.md` for the roadmap. Step 1
(package skeleton + provider layer) is done; the app currently runs as a
console chat with prototype feature-parity. The windowed app, personas, TTS,
and the rest land in the following steps.

## Try it now (console mode)

1. Install (from the repo folder):
   ```
   pip install -e .[google]
   ```
   (Use `.[anthropic]` or `.[openai]` for those providers instead. Ollama
   needs no extra install.)

2. Get a free Google API key: https://aistudio.google.com/app/apikey

3. Save your key once (no more environment variables):
   ```
   python -m backseat --api-key YOUR-KEY-HERE
   ```

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

## Known limitations (current step)

- Console UI, single API key, fixed 20s comment interval, no TTS yet —
  all replaced in later PLAN.md steps.
- API key is stored in plain-text settings JSON until step 2 moves it into
  Windows Credential Manager.
- Free Google tier: rate-limited, and prompts/outputs may be used to
  improve Google's models (not private the way a paid tier is).

See `CLAUDE.md` for project history and design decisions.
