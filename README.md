# 🌍 Endangered Animals Tracker (with Miku ♪)

A self-contained static website that shows current population estimates for
endangered animals. Each card has an **Explore** button that opens:

- 🌳 **Family tree** — taxonomy from Kingdom down to subspecies
- 🧬 **Evolution tree** — simplified evolutionary lineage
- ⚔️ **Predator vs Prey** — the historical eras each animal was predator or prey

A draggable **pixel-art Hatsune Miku** buddy floats in the corner like Clippy —
drag her anywhere, click her for tips, fun facts, a random animal, or a dance.

## Run it

No build step. Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page shell + Explore modal |
| `styles.css` | All styling (Miku-themed teal/pink) |
| `data.js`    | Animal dataset (populations, trees, roles) |
| `app.js`     | Card rendering, search/sort, modal logic |
| `miku.js`    | Draggable pixel-art Miku assistant |
| `test.mjs`   | Playwright end-to-end test suite |

## Tests

```bash
npm i -D playwright   # or use a global playwright install
node test.mjs
```

The suite covers card rendering, the Explore modal + tab switching, search/sort,
focus restoration, and Miku (sprite, speech bubble, dragging).

## Data note

Population figures are published estimates with the year shown on each card;
treat them as approximate. Trees are simplified for readability.
