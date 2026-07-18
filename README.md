# Summoner Realms

A polished, original **2D sandbox-survival vertical slice** that runs entirely in
the browser — inspired by the genre of games like Terraria, but built from scratch
with original art, names, weapons, enemies, bosses, and mechanics. No external
game assets, sprites, music, or designs are used or copied.

Explore a small procedurally generated world across three biomes, mine and build,
craft progressively stronger gear across four combat classes, summon minions, and
fight three phased bosses — solo or in **real peer‑to‑peer co‑op** that works
between PC and mobile.

![vertical slice](https://img.shields.io/badge/status-playable%20demo-7ee0c0)

---

## Quick start (play locally)

It's a static site (HTML5 Canvas + ES modules) — no build step. You just need to
serve the folder over HTTP (ES modules don't load from `file://`):

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx http-server`, `php -S`, VS Code Live Server, …).

### Play online (GitHub Pages)

The included workflow (`.github/workflows/pages.yml`) publishes the repo root to
GitHub Pages automatically on push. Enable **Settings → Pages → Build and
deployment → GitHub Actions**, and your live URL will appear after the first run.

---

## How to play

Click **New World**, pick a seed (or leave it blank for random), and start
gathering. Your goal: gather materials, craft gear, and defeat the three bosses
in order.

**Progression path**

1. Chop **Oakenwood**, gather **Plant Fiber**, mine **Stone/Cuprite**. Place a
   **Crafting Bench** (it's in your bag) to unlock recipes.
2. Craft a **Smeltery** and **Forge**; smelt ore into bars; build starter gear
   and a **Verdant Effigy**.
3. Use the Verdant Effigy in the **Forest** to summon the **Grovekeeper**.
4. Its loot (**Grove Heart**) lets you craft a **Bone Sigil** → summon the
   **Gravemaw** underground.
5. Gravemaw's loot opens the **Blight** tier → craft a **Blight Idol** → summon
   the **Blight Sovereign** in the **Corrupted Lands** for the endgame gear.

Progress autosaves every 30 seconds and whenever you open a menu.

---

## Controls

Switch between **PC** and **Mobile** controls on the main menu (auto-detected).

### PC (keyboard + mouse)

| Action | Key / Button |
| --- | --- |
| Move | `A` / `D` or arrow keys |
| Jump (double-jump with Cloudstep Charm) | `W` / `Space` |
| Use selected item (attack / cast / summon / **place** / mine-with-pickaxe) | **Left mouse** |
| Mine targeted tile with your best pickaxe | **Right mouse** |
| Select hotbar slot | `1`–`0` or scroll wheel |
| Inventory & crafting | `E` |
| Use potion | `Q` |
| Pause / back | `Esc` |
| Chat (multiplayer) | `Enter` |
| Demo Commands | `/` (also in the pause menu) |

### Mobile (touch)

Two virtual joysticks — **left = move, right = aim** — plus on-screen buttons for
**Jump, Use, Mine, Place, Bag (inventory), Item (potion)** and the menu. The
whole UI is responsive and safe-area aware for phones and iPads.

---

## Multiplayer (real peer-to-peer co-op)

Open **Multiplayer** from the main menu:

- **Create Server** — you become the host (the host simulates the authoritative
  world). You get a **room code** and a shareable **invite link** (`?room=CODE`).
- **Join Server** — enter a room code, or just open someone's invite link.

Player movement, mining, building, combat, health, enemies, minions, **bosses**,
items, and world changes are synchronized. You get player names, colors, a live
player list, chat, a connection indicator, and a **Leave Server** button. Multiple
players can fight bosses together (damage is pooled; bosses aggro everyone). It's
real WebRTC — no bots, no duplicated characters. Single-player runs fully offline.

> Multiplayer uses [PeerJS](https://peerjs.com) (WebRTC). The library is
> **vendored** in `vendor/peerjs.min.js` (with a CDN fallback) and, by default,
> uses PeerJS's free public broker for signaling — so it needs internet access
> and works from any static host. Cross-platform PC ↔ mobile is supported because
> both platforms feed the exact same normalized input into the netcode.

### Optional: self-hosted signaling server

If you'd rather not use the public broker, an optional server is in
[`server/`](server/):

```bash
cd server && npm install && npm start   # PeerServer on :9000
```

Then load the game pointing at it:
`https://your-site/?peerhost=YOURHOST&peerport=9000` (add `&peersecure=1` for
HTTPS/WSS).

---

## Saving

Progress is saved to `localStorage` (multiple named world slots). Saved data
includes the **world seed**, all **mined/placed blocks** (stored as diffs),
**inventory / equipment / hotbar**, **health**, **position**, **defeated bosses**,
**unlocked recipes**, and **time of day**.

- **New World**, **Load World**, **Save Game**, **Delete Save** (with a
  confirmation), and **Reset World** are all available.
- **Autosave** runs every 30 seconds and when you open a menu.
- A live indicator shows **Saving… / Saved / Unsaved Changes**.

---

## Demo Commands (testing panel)

Open the pause menu → **Demo Commands** (or press `/`). A console with
autocomplete and a full command list — you never need these for normal play, but
they make testing fast:

```
/help                 show all commands
/give [item] [amount] give an item        /giveall   give all demo items
/spawn [enemy]        spawn an enemy       /spawnboss [boss]  spawn a boss
/summonitem [boss]    give a boss-summon item
/killall              defeat nearby enemies (not bosses)
/clearboss            remove active boss(es), their adds & projectiles
/resetcombat          clear projectiles/particles & combat state
/resetworldstate      clear all bosses, enemies & projectiles (keep terrain)
/heal                 restore health       /mana      restore Aether
/fly                  toggle flight        /godmode   toggle invincibility
/time day|night       set time of day      /teleport [biome]  forest|underground|corrupt
/clearinventory       clear inventory      /save      manually save
/resetdemo            reset the demo world
```

Item and enemy names are matched loosely — `/give plantfiber`, `/give plant fiber`
and `/give fiber` all work, and `/spawn slime` maps to the Slugling. Every command
prints a success or error message, and names autocomplete (Tab) as you type.

---

## Claude's Notes (dev annotations)

The main menu and pause menu have a **Claude's Notes** button (and there's a
`CLAUDE_NOTES.md` in the repo root). It's a developer commentary written to sit
beside the QA/stress-test review: for each reported issue it says whether it was a
real bug (and how it was fixed), a misunderstanding, or intended behaviour, plus a
crib sheet for driving the game via `window.__game` and the console — so a
reviewer can test the right things the right way.

---

## Content

- **Three biomes:** Forest, Underground, Corrupted Lands (procedurally generated,
  seeded).
- **32 original weapons:** 8 melee, 8 ranged, 8 mage, 6 summoner.
- **5 minion types**, **8 enemy types**, **3 phased bosses** (Grovekeeper,
  Gravemaw, Blight Sovereign) with health bars, unique attacks, summon items, and
  loot tables.
- Ores, bars, armor sets, accessories, potions, materials, and 5 crafting
  stations, plus day/night cycling with biome/time-based enemy spawns.
- All art is generated procedurally at runtime (no image files) — original by
  design.

---

## Project structure

```
index.html            markup + all UI overlays
css/styles.css        theme + responsive/mobile layout
vendor/peerjs.min.js  vendored PeerJS (WebRTC)
server/               optional self-hosted PeerServer
js/
  config.js  utils.js
  engine/    loop, camera, input (PC + mobile), renderer
  art/       procedural sprite generation
  world/     tiles, seeded worldgen, runtime world + lighting
  data/      items, recipes, enemies, minions, bosses (pure data)
  entities/  player, enemy, minion, boss, projectile, dropped item, physics
  systems/   combat, inventory, crafting, progression, spawner, day/night
  ui/        HUD, menus, controls-mode
  net/       protocol, PeerJS transport, host-authoritative sync
  commands.js  save.js  main.js (orchestrator + game loop)
```

---

## Tech notes

- Pure vanilla JS + Canvas 2D, ES modules, ~zero dependencies (PeerJS only, for
  multiplayer).
- Fixed-timestep simulation with viewport-culled rendering and a smooth lightmap.
- Host-authoritative netcode: world/enemies/bosses/drops on the host; each client
  owns its inventory and reports actions. Normalized input makes PC ↔ mobile
  interoperate directly.
- `window.__game` is exposed as a test hook.

Have fun, summoner. ✦
