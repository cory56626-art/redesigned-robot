# 🌍 Endangered Earth

A static website showing **populations of endangered animals**, each with an
**evolutionary family tree** (who they evolved from and roughly when) and their
**predator / prey** role — plus a section on **endangered plants** and a
Clippy-style pixel-art assistant named **Jimmy** in the top-right corner.

## Features
- **Dropdown** to pick any animal → loads its family-tree timeline (clade +
  approximate divergence date in millions of years), IUCN status, role
  (predator/prey), estimated wild population, range, and an IUCN Red List link.
- **Animal grid** (10 species) and **plant grid** (6 species) — click an animal
  card to load it in the explorer above.
- **Jimmy** 📎 — a pixel-art assistant drawn on a `<canvas>`. Click (or focus +
  Enter/Space) to cycle through conservation facts.
- Dark, responsive UI; keyboard-accessible; respects `prefers-reduced-motion`.

## Run it
No build step — it's plain HTML/CSS/JS. Serve the folder:

```bash
cd endangered-species-site
python3 -m http.server 8000
# open http://localhost:8000
```

## Files
| File | Purpose |
|------|---------|
| `index.html` | Page structure |
| `style.css`  | Styling, layout, Jimmy animation |
| `data.js`    | Dataset: animals, plants, Jimmy facts |
| `app.js`     | Rendering, dropdown, cards, Jimmy logic |
| `test.js`    | jsdom test suite (`node test.js`) — 154 checks |
| `groupchat.py` | The 6-AI orchestrator used to build this (see below) |

## How this was built — the 6-AI groupchat
Claude (boss) wrote v1, then convened a **real** multi-agent review: each
teammate is a live API call in its specialty role. `groupchat.py` sends the
current code to all five and collects findings as JSON.

| Agent | Model | Role |
|-------|-------|------|
| GROQ | llama-3.3-70b-versatile | speed / quick checks |
| MISTRAL | mistral-large-latest | general coding + debugging |
| GEMINI | gemini-3.5-flash / 3.1-flash-lite | UI/UX |
| OPENROUTER | llama-3.3-70b-instruct | heavy reasoning |
| COHERE | command-a-03-2025 | logic / structure |
| CLAUDE | (boss) | all roles, merges, final decision |

**Rounds**
1. **Round 1** — team flagged a real classification bug (`isCrit` keyed off raw
   population, mislabeling species) and an inconsistent plant `population` field.
   Boss fixed both, plus added IUCN links and badge tooltips. ✅ 146 tests pass.
2. **Round 2** — accessibility pass: emojis hidden from screen readers, Jimmy
   made keyboard-operable (`role=button`, Enter/Space, `aria-expanded`), plant
   cards de-styled as non-interactive, new-tab warning on links. ✅ 154 tests.
3. **Round 3** — convergence: reported "bugs" were all already-fixed or false
   positives, so the boss stopped (no infinite loop). One semantic-grouping
   nicety applied.

The boss discarded incorrect findings (e.g. claims that Jimmy's bubble fails
contrast — it's ~17:1; or that the pixel art is "blurry" — the 8×8 grid maps
exactly to 64px).

> Population and divergence figures are approximate, IUCN-style educational
> estimates — not scientific citations.
