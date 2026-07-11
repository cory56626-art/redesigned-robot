# The Marauder — Companion Boss for the Oathbreaker Titan

A Bloodborne-flavored, Boreal-Dancer-styled **blood/beast rival boss** for Minecraft
Bedrock. Where the Oathbreaker Titan is a slow molten brawler, The Marauder is a
fast blood-dancer who transforms partway through the fight. Designed as a rival:
she **actively hunts the Titan**, and the two will fight on sight — no edits to
the Oathbreaker addon required.

---

## What's new in this upgraded build

- **Playable out of the box** — both textures are now included as generated
  placeholders (painted per-bone from the model UVs: ivory mask, crimson
  regalia + gold trim, bare arm, steel blade; darker blood-soaked frenzied
  variant with glowing eyes). Replace them with hand-painted art whenever you
  like; regenerate after model edits with `python3 tools/gen_placeholder_textures.py`.
- **Blood Eclipse pools actually hurt now** — the lingering pools used to be
  spawned but dealt no damage. They now wither anyone (player or Titan)
  standing in them every half second and clean themselves up after 6s.
- **Transform invulnerability implemented** — `TRANSFORM_INVULN_SECONDS` was
  defined but never used; she now gets full damage immunity (Resistance V)
  during the waltz→beast transformation, as designed.
- **Creative/spectator players are properly ignored** — the old check used a
  nonexistent `minecraft:gamemode` component and never filtered anyone; script
  abilities now use `player.getGameMode()`.
- **Riposte stance holds** — she stands her ground during the parry window
  instead of wandering, so the telegraph reads.
- **Blood-Curse bookkeeping** — stacks on dead/despawned targets are pruned.
- **`package.sh` included** — the README referenced it but it wasn't in the
  addon; it now builds a valid `.mcaddon` with manifests at each pack root.
- A prebuilt `The_Marauder.mcaddon` is committed at the repo root — just
  download and double-click it.

---

## TL;DR — how to play it

1. **Install:** double-click `The_Marauder.mcaddon` (imports BP + RP), then
   enable both packs on a world. Enable **Beta APIs / Experimental** if your
   world requires it for `@minecraft/server` scripting.
2. **Spawn:** use the spawn egg (inventory, crimson + gold), or run
   `/scriptevent mar:spawn` to summon her at your location.
3. **The duel:** spawn an Oathbreaker Titan (`ob:oathbreaker_titan`) near her.
   She targets the Titan automatically; the Titan retaliates once struck. Enjoy.
4. *(Optional)* repaint the 2 textures (see *Step 1* below) and rebuild with
   `bash package.sh` → produces a fresh `The_Marauder.mcaddon`.

---

## What's in this addon

```
BP/  (behavior + script)
  manifest.json                 data + script modules, deps on @minecraft/server 1.12.0 + RP
  entities/marauder.se.json     500 HP, 0.45 speed, scale 0.55, families: mar_rival/monster/mob,
                                properties mar:attack_state + mar:frenzied, targets player + ob_titan
  scripts/main.js               full boss AI: 10 abilities, 2 phases, Rally, Blood-Curse, rivalry
  loot_tables/entities/marauder.json   drops
  texts/en_US.lang              display name

RP/  (visuals)
  manifest.json
  entity/marauder.entity.json   client_entity: 2 geometries, 2 textures, 12 animations
  models/entity/marauder.geo.json        Phase 1 "Crimson Waltz" rig (slender dancer, blade, cloak)
  models/entity/marauder_beast.geo.json  Phase 2 "Frenzy" rig (hunched, beast-claw arm, longer blade)
  animations/marauder.animation.json     idle/walk/death + 8 combat anims + transform
  animation_controllers/marauder.ac.json client state machine on mar:attack_state
  render_controllers/marauder.rc.json    swaps geometry + texture on mar:frenzied
  texts/en_US.lang
```

---

## The design (quick reference)

### Stats (glass-cannon, tuned vs Oathbreaker's 600 HP)
| Stat | Marauder | Oathbreaker |
|---|---|---|
| HP | 500 | 600 |
| Base attack | 7 | 8 |
| Movement | 0.45 | 0.35 |
| Scale | 0.55 | 0.55 |

### Phase 1 — "Crimson Waltz" (100% → 50%)
- **Waltz Cleave** — 3-hit spinning combo, deliberate pause before hit 2 (roll-catch). 9/hit.
- **Blood Flicker** — quickstep blink *through* the target, repositions behind. 4 dmg exit.
- **Crimson Lance** — ranged blood-spear projectile. 8 dmg + Blood-Curse stack.
- **Riposte / Visceral** — reactive parry: if hit during guard window, counters for 14.
- **Blood Scent** *(passive)* — Speed boost toward targets below 35% HP.

### Phase 2 — "The Frenzy" (≤50% HP — transforms, draws second blade, beast arm)
- **Twin Waltz** — Waltz becomes 4-hit, wider, faster, applies Blood-Curse.
- **Beast Lunge** — telegraphed pounce + claw rake. 16 dmg. (Her heavy hitter.)
- **Blood Eclipse** — r6 AoE burst + lingering blood pools (wither). 12 dmg.
- **Feral Flurry** — rushing 5-hit combo, 6/hit (30 burst), each dodgeable.
- **Rally** *(passive)* — 3s after taking damage, 45% of damage dealt heals her.
- **Blood-Curse** — stacking bleed; at 5 stacks a Hemorrhage proc deals a flat 10.

**Win condition vs Titan:** she out-DPSes if Rally keeps her alive; she loses the
raw-HP race. It's a momentum fight — a genuine tossup.

---

## Step 1 — Repaint the textures (optional — placeholders are included)

Two **128×128 PNGs** ship with the pack, auto-painted from the UV maps by
`tools/gen_placeholder_textures.py`. To make them yours:

| File | Path | Description |
|---|---|---|
| Phase 1 | `RP/textures/entity/marauder.png` | Slender crimson regalia, ivory mask, one bare arm, curved blade. Elegant. |
| Phase 2 | `RP/textures/entity/marauder_frenzied.png` | Same silhouette but torn/blood-soaked, glowing red eyes/mask, beast-arm fur. |

**Easiest workflow in Blockbench:**
1. Open `RP/models/entity/marauder.geo.json` in Blockbench (Bedrock Entity format).
2. Switch to the **Paint** tab → create a 128×128 texture → paint by face.
3. Export texture to `RP/textures/entity/marauder.png`.
4. Repeat with `marauder_beast.geo.json` for the frenzied texture.

Placeholders are fine to start — the boss will still load and fight with a
missing/blank texture (you'll just see the untextured material).

---

## Step 2 — Refine the model & animations (optional, recommended)

The geo and animation JSONs are **valid and open directly in Blockbench**.
They're intentionally clean starting rigs. To polish:
- Open the `.geo.json` in Blockbench → adjust cubes/ proportions.
- Open `animations/marauder.animation.json` alongside → scrub keyframes,
  retime hit moments to match the `*_HIT_TICKS` constants in `main.js`.

The **hit timing** is what matters most for feel: in `main.js` the arrays
`WALTZ_HIT_TICKS_P1`/`P2`, `LANCE_TICK`, `ECLIPSE_BURST_TICK`, etc. define *when*
damage lands. Match each animation's visual "impact" frame to its tick.

---

## Step 3 — Balance knobs (all in `BP/scripts/main.js`)

Everything is tuned at the top of the file. Key dials:
- `PHASE2_HP_FRAC` (0.5) — when she transforms.
- HP is in `entities/marauder.se.json` → `minecraft:health`.
- Per-ability `*_DAMAGE` and `*_COOLDOWN` constants.
- `RALLY_HEAL_FRACTION` (0.45) — how much she self-heals in Phase 2.
- `CURSE_MAX_STACKS` (5) / `CURSE_HEMORRHAGE_DAMAGE` (10) — the bleed payoff.

After any change, reload the world (script changes need a world reload, not
just a re-summon, to take effect).

---

## How the rivalry works (no edits to Oathbreaker)

- The Marauder's `nearest_prioritized_attackable_target` lists `ob_titan` at
  **priority 0** (preferred) and `player` at priority 1. She hunts the Titan.
- The Oathbreaker Titan already has `behavior.hurt_by_target` (priority 1), so
  once she strikes it, it retaliates — reciprocal aggro, zero cross-pack edits.
- Summon both in an arena and they auto-fight. ✓ verified against the addon's
  actual entity definition (Titan family = `ob_titan`).

---

## Troubleshooting

- **Boss won't spawn / no abilities:** ensure the world has the **Beta APIs**
  (a.k.a. "Experimental") toggle ON — required for `@minecraft/server` scripts.
  Reload the world after enabling.
- **Missing texture / purple-black:** the two PNGs in `RP/textures/entity/`
  are missing from the pack you installed — rebuild with `bash package.sh`
  (they ship as generated placeholders; see Step 1).
- **Phase 2 doesn't trigger:** it fires on the `entityHurt` event at ≤50% HP;
  if she's oneshot or takes no damage events, it won't. There's a safety-net
  check in the tick loop too.
- **She won't fight the Titan:** confirm the Oathbreaker addon is *also* enabled
  on the world (its entity must be registered for her targeting filter to match).
- **Edits not applying:** re-zip via `bash package.sh` and re-import; or edit
  the pack files directly in `development_behavior_packs` / `development_resource_packs`
  for live iteration.

---

## Verifying the build (already done, for reference)

- All 9 JSON files pass strict JSON parse. ✓
- `main.js` brace/paren/bracket balanced (244/244, 413/413, 5/5), 43 functions. ✓
- `package.sh` builds a valid `The_Marauder.mcaddon` with `manifest.json` at the
  root of each inner `.mcpack`. ✓

---

## Credits / lore

*"The Oathbreaker broke his vow to the gods. The Marauder broke hers to him."*
She hunts the Titan. Inspired by Boreal Dancer (DS3), Bloodborne trick-weapons &
rally, Asura's Wrath dramatic bursts, and Elden Ring delayed-timing roll-catches.
Built as a companion to the Oathbreaker Titan addon.
