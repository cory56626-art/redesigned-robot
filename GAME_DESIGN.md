# Pixel Crawler — RPG Idle Game Design

> Boss design doc authored by Claude. The team (Groq, Mistral, Gemini) builds on this.

## High concept
A single-file pixel-art **RPG idle crawler**. A lone hero auto-fights an endless
march of monsters across rising stages. It plays itself when you walk away, but a
layer of **manual mechanics** keeps your hands busy when you're watching — and a
periodic **Siege (tower-defense) mode** breaks up the grind.

## The core loop (idle spine)
```
Auto-attack monster ─▶ Monster dies ─▶ Gain GOLD + XP
        ▲                                   │
        │                                   ├─▶ Spend GOLD on upgrades (DMG / HP / crit / auto-speed / towers)
        │                                   ├─▶ Gain XP ─▶ LEVEL UP ─▶ stat bumps + skill points
   Next monster ◀── advance STAGE ◀── every 10 kills = BOSS ── win ─▶ stage++
```
- **Monsters scale** in HP and reward with stage. Every 10th encounter is a **boss**
  (big HP, big gold). Clear it to advance the stage; the world gets prettier/harder.
- **Idle accrual**: combat ticks on a fixed timestep so it runs unattended. Closing
  the tab banks **offline progress** (capped) credited on return.
- **Gold sinks**: weapon (DMG), armor (max HP), crit chance, attack speed, and Siege
  towers. Costs scale geometrically so there's always a next purchase.

## Manual layer (so it isn't "just idle")
1. **Active skills with cooldowns** (click or hotkey 1/2/3):
   - **Power Strike (1)** — burst damage, short CD.
   - **Heal (2)** — restore HP, medium CD.
   - **Fireball (3)** — big nuke + brief stun, long CD.
2. **Focus clicks** — click the monster to deal manual taps that build a **Rage**
   meter; full Rage = guaranteed crit window. Rewards active play without being mandatory.
3. **Loot timing** — bosses can drop a glowing item; click it before it fades for a
   bonus. Misses are fine (idle-safe) but clicking pays off.

## Siege mode (tower-defense break)
Every few stages a **Horde** marches down a lane toward your town gate.
- Spend gold to **place towers** on tiles beside the lane (Arrow / Cannon / Frost).
- Towers auto-fire, but the player **manually targets / triggers a hero ultimate**.
- Survive the wave → big gold + relic. Gate HP hits 0 → lose some gold, retry.
- This reuses the same gold economy, giving the manual layer real stakes.

## Prestige / Ascension (long-term)
At a stage threshold, **Ascend**: reset stage/gold/levels for **Soul Shards** that buy
permanent multipliers (global DMG, gold find, starting stage). Classic idle retention.

## Pixel art (single-file, canvas-rendered)
All art is drawn from **integer pixel grids** scaled up with `imageSmoothingEnabled=false`.
Three required sprites, each a small palette-indexed grid:
- **Hero** — armored knight with sword, idle bob + attack lunge frame.
- **Item** — a sword/weapon icon that visually upgrades by tier (color shift).
- **Monster** — a slime as base mob, recolored per biome; bosses are scaled-up variants.

## Tech constraints
- **One `index.html`** — inline CSS + JS, no external assets or network.
- Canvas for the world/sprites; HTML/CSS for HUD, shop, skill bar.
- `localStorage` save (autosave + offline timestamp).
- 60fps render loop, fixed-timestep simulation, deterministic-ish combat math.

## Team roles
- **Groq** — fast prototypes: rough working JS for new systems.
- **Mistral** — clean code + debugging: refactor, fix, balance numbers.
- **Gemini** — UI + pixel art: layout, CSS, sprite pixel grids, juice.
- **Claude (boss)** — direction, integration into the single file, QA with Playwright.
