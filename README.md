# Summoner Realms

A polished, original **2D sandbox-survival vertical slice** that runs entirely in
the browser — inspired by the genre of games like Terraria, but built from scratch
with original art, names, weapons, enemies, bosses, and mechanics. No external
game assets, sprites, music, or designs are used or copied.

Explore a procedurally generated world of layered biomes and wall-backed caves,
mine and build, blast holes in the terrain, craft progressively stronger gear
across four combat classes, summon minions, and fight three phased bosses — solo
or in **real peer-to-peer co-op** that works between PC and mobile.

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
| Talk to the Guide | `F` |
| **Smart Cursor** (auto-target the best tile) | hold `Ctrl`, or set to Always in Settings |
| Pause / back | `Esc` |
| Chat (multiplayer) | `Enter` |
| Demo Commands | `/` (also in the pause menu) |

### Mobile (touch)

Two virtual joysticks — **left = move, right = aim** — plus on-screen buttons for
**Jump, Use, Mine, Place, Bag (inventory), Item (potion)**, a **◎ Smart Cursor**
toggle, a contextual **Talk** button near the Guide, and the menu. The whole UI
is responsive and safe-area aware for phones and iPads.

**Smart Cursor** matters most here: aiming one specific tile with a thumbstick is
impractical, so the game picks the most useful tile in the direction you point —
the nearest block worth mining, the next legal spot to build, or a dark wall that
wants a torch. It's on by default on touch.

### Playing with the inventory open

The world keeps running while your bag is open and you can still move, jump and
use items, the way Terraria does. The panel is anchored in the corner rather than
covering the screen, so the rest of the view stays visible and clickable.

---

## Multiplayer (real online co-op)

Open **Multiplayer** from the main menu:

- **Create Server** — you become the host (the host simulates the authoritative
  world). You get a **room code** and a shareable **invite link** (`?room=CODE`).
- **Join Server** — enter a room code, or just open someone's invite link.

Player movement, mining, building, combat, health, enemies, minions, **bosses**,
items, and world changes are synchronized. You get player names, colors, a live
player list, chat, a connection indicator, and a **Leave Server** button. Multiple
players can fight bosses together (damage is pooled; bosses aggro everyone).
No bots, no duplicated characters. Single-player runs fully offline.

> Multiplayer runs through a small **Node.js + Socket.IO** backend (in
> [`server/`](server/)) hosted on **[Render](https://render.com)**, over HTTPS +
> WebSockets. The game is still **host-authoritative** — the backend only manages
> rooms and relays the game's messages between the host and joined clients, so all
> gameplay/saves/inventory logic is unchanged. Cross-platform PC ↔ mobile works
> because both platforms feed the exact same normalized input into the netcode.

### Backend setup (Render)

1. Deploy the [`server/`](server/) folder to Render as a **Node Web Service**
   (Root Directory `server`, Build `npm install`, Start `npm start`). Full steps
   are in [`server/README.md`](server/README.md).
2. Paste the URL Render gives you into `index.html`:

   ```html
   <script>
     window.SUMMONER_SERVER_URL = 'https://your-service.onrender.com';
   </script>
   ```

   (Or test without editing files by adding
   `?server=https://your-service.onrender.com` to the game link.)

Run it locally with `cd server && npm install && npm start`
(health check at <http://localhost:10000/health>), then load the game with
`?server=http://localhost:10000`.

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

- **Four surface biomes** in seeded bands with blended seams — Sunken Dunes,
  Verdant Reach, Frostpine Hollow, Corrupted Lands — over a layered underground
  of dirt, stone and deepstone, all procedurally generated from a seed.
- **Background walls** behind every naturally-solid tile. Carving a cave leaves
  the wall, and walls block daylight, which is what makes the underground read as
  underground.
- **32 original weapons:** 8 melee, 8 ranged, 8 mage, 6 summoner — a handful of
  which throw real effects when used.
- **6 throwables:** Blast Bomb, Dynamite, Cling Charge, Ember Flask, Iron
  Shuriken, Balanced Knife. They arc, bounce off terrain, and the explosive ones
  destroy tiles and walls (and you, if you're standing too close).
- **5 minion types**, **10 enemy types**, **3 phased bosses** (Grovekeeper,
  Gravemaw, Blight Sovereign) with health bars, telegraphed attacks, summon items
  and loot tables.
- **Vesper Thane, the Guide** — an NPC who spawns with your world and will
  explain any item you're carrying, including where it comes from.
- Ores, bars, armor sets, accessories, potions, materials, and 5 crafting
  stations, plus day/night cycling with biome/time-based enemy spawns.
- **Optional soundtrack:** drop audio files into `assets/music/` and they play,
  crossfading by biome, depth, time of day and boss fight. See that folder's
  README for the filenames.
- All art is generated procedurally at runtime (no image files) — original by
  design.

---

## Project structure

```
index.html            markup + all UI overlays
css/styles.css        theme + responsive/mobile layout
vendor/socket.io.min.js  vendored Socket.IO client (CDN fallback)
server/               Node.js + Socket.IO multiplayer backend (deploy on Render)
js/
  config.js  utils.js
  engine/    loop, camera, input (PC + mobile), renderer
  art/       procedural sprite generation
  world/     tiles, walls, biomes, seeded worldgen, runtime world + lighting
  data/      items, recipes, enemies, minions, bosses, guide dialogue (pure data)
  entities/  player, enemy, minion, boss, npc, projectile, thrown item,
             dropped item, physics
  systems/   combat, ai, explosions, smart cursor, inventory, crafting,
             progression, spawner, day/night
  ui/        HUD, menus, NPC dialogue, controls-mode
  net/       protocol, Socket.IO transport, host-authoritative sync
  commands.js  save.js  main.js (orchestrator + game loop)
tools/
  worldgen-check.mjs   headless world generation test (no dependencies)
  stamp-build.mjs      cache-bust stamper driven by config.js BUILD
assets/
  audio/     sound effects
  music/     optional soundtrack — drop files here (see its README)
```

### Checks

```bash
npm run check:worldgen   # generator invariants across many seeds
npm run check:build      # every module stamped with the current BUILD
```

`tools/worldgen-check.mjs` runs in plain node with no dependencies, because
worldgen and everything it imports are DOM-free. It asserts spawn safety,
walkable slopes, biome contiguity, cave density and surface connectivity, wall
coverage, ore banding, and that no tree is left floating.

---

## Tech notes

- Pure vanilla JS + Canvas 2D, ES modules, ~zero front-end dependencies
  (Socket.IO client only, for multiplayer).
- Fixed-timestep simulation with viewport-culled rendering and a smooth lightmap.
- Host-authoritative netcode: world/enemies/bosses/drops on the host; each client
  owns its inventory and reports actions. Normalized input makes PC ↔ mobile
  interoperate directly.
- `window.__game` is exposed as a test hook.
- There is no bundler, so ES modules are cache-busted by a `?v=` stamp applied to
  every relative import from the single `BUILD` constant in `js/config.js`. Bump
  it and run `node tools/stamp-build.mjs` before a release, so a deploy can never
  serve a half-updated module graph.

Have fun, summoner. ✦
