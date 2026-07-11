# The Marauder — a Boreal-Dancer-style Boss for Bedrock

A Dark-Souls-flavored **dancer/cinder boss** for Minecraft Bedrock. The Marauder
is a fast blood-dancer who transforms partway through the fight. She's a
**standalone boss tuned to the same power tier as the Oathbreaker Titan** —
similar scale, similar threat — but she is *not* a rival or counter to it: she
doesn't hunt the Titan, and only fights back if something (Titan included)
strikes her first.

**Model:** Phase 1 is built on the Dancer of the Boreal Valley silhouette —
tall, gaunt and hunched, with long trailing limbs, a flowing veil, a crowned
helm, and a long blade dragged low. Phase 2 shifts toward Soul of Cinder:
charred armor, a crown of cinders, a molten blade, and an Abyss-Watcher parry
dagger in the off-hand.

---

## What's new in v2 (this update)

- **Model rebuilt from scratch** to the Dancer of the Boreal Valley / Soul of
  Cinder references — no more Oathbreaker-alike proportions. Same bone names,
  so all animations still drive it.
- **Rivalry removed.** She no longer prioritizes hunting `ob_titan`; her AI
  targets players, and `hurt_by_target` makes her retaliate against anything
  that hits her. Equal power, no built-in grudge.
- **Abilities now work against the Oathbreaker (and any mob).** Hit detection
  used to accept only the exact entity id `ob:oathbreaker_titan`, so swings
  whiffed against anything else — including every Phase 2 ability. Victims are
  now "players + whatever her AI is currently fighting", no hardcoded ids.
- **Two Abyss-Watcher abilities:**
  - **Abyssal Leap** (both phases) — crouch telegraph, plunging arc onto the
    target, landing slam AoE (12 / 15 dmg, knock-up; curses in Phase 2).
  - **Flame Wake** (Phase 2) — a burning dash through the fight (10 dmg direct
    hit + ignite) that leaves a fire trail on the ground for 4 seconds.
- Loosened Phase 2 ability ranges so Flurry/Lunge actually fire in close
  quarters; taller collision box (2.3) to match the new silhouette.
- Placeholder textures regenerated for the new rigs and palettes.

---

## What was fixed in v1 (previous update)

- **Playable out of the box** — both textures are included as generated
  placeholders, painted per-bone from the model UVs. Replace them with
  hand-painted art whenever you like; regenerate after model edits with
  `python3 tools/gen_placeholder_textures.py`.
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
3. *(Optional)* repaint the 2 textures (see *Step 1* below) and rebuild with
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

### Stats (glass-cannon, same power tier as the Oathbreaker's 600 HP)
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
- **Abyssal Leap** — Watcher's plunge: crouch, arcing leap, landing slam AoE. 12 dmg + knock-up.
- **Blood Scent** *(passive)* — Speed boost toward targets below 35% HP.

### Phase 2 — "The Frenzy" (≤50% HP — transforms: cinder crown, molten blade, parry dagger)
- **Twin Waltz** — Waltz becomes 4-hit, wider, faster, applies Blood-Curse.
- **Beast Lunge** — telegraphed pounce + rake. 16 dmg. (Her heavy hitter.)
- **Blood Eclipse** — r6 AoE burst + lingering blood pools (wither). 12 dmg.
- **Feral Flurry** — rushing 5-hit combo, 6/hit (30 burst), each dodgeable.
- **Abyssal Leap** — upgraded: 15 dmg and applies Blood-Curse on the slam.
- **Flame Wake** — burning dash: 10 dmg + ignite on contact, leaves a fire
  trail on the ground for 4s. Don't stand in it.
- **Rally** *(passive)* — 3s after taking damage, 45% of damage dealt heals her.
- **Blood-Curse** — stacking bleed; at 5 stacks a Hemorrhage proc deals a flat 10.

---

## Step 1 — Repaint the textures (optional — placeholders are included)

Two **128×128 PNGs** ship with the pack, auto-painted from the UV maps by
`tools/gen_placeholder_textures.py`. To make them yours:

| File | Path | Description |
|---|---|---|
| Phase 1 | `RP/textures/entity/marauder.png` | Boreal-Dancer look: aged gold armor, ash-blue flowing veil, dark crowned helm, long ember blade. |
| Phase 2 | `RP/textures/entity/marauder_frenzied.png` | Soul-of-Cinder look: charred armor with ember cracks, burning visor, crown of cinders, molten blade, steel parry dagger. |

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

## Sharing a world with the Oathbreaker Titan

They coexist peacefully. The Marauder's AI only targets **players**; she has no
special interest in the Titan. Both bosses have `hurt_by_target`, so if one
happens to hit the other (a stray AoE, or you kiting them together), they'll
brawl — and all of her scripted abilities work in that fight, because ability
hit-detection targets *whatever her AI is currently fighting* rather than any
hardcoded entity id. Equal power tier, no built-in rivalry.

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
- **She ignores the Titan:** that's by design now — she only retaliates if it
  hits her first. Shove them into each other's AoEs to start the brawl.
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

*"She danced for the gods once. Now she dances on ash."*
Inspired by the Dancer of the Boreal Valley and Soul of Cinder (model), the
Abyss Watchers (Abyssal Leap, Flame Wake, the parry dagger), Bloodborne
trick-weapons & rally, and Elden Ring delayed-timing roll-catches.
