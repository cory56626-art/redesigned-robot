# The Marauder

A Minecraft **Fabric 1.20.1** mod that adds a recurring, player-specific cursed
knight rival who hunts you across **ten escalating nights**. The Marauder begins
as a frail, reckless swordsman and returns stronger after every defeat — new
armor, new weapons, smarter combat, and new abilities — until a final voluntary
duel resolves the rivalry.

> Part stalker, part boss progression, part cursed-knight duel.

## Requirements

- Minecraft **1.20.1**
- **Fabric Loader** 0.15+
- **Fabric API** (required) — [download](https://modrinth.com/mod/fabric-api)
- Java **17+**

## Install

1. Install the Fabric loader for 1.20.1.
2. Drop **Fabric API** and `marauder-1.0.0.jar` into your `mods/` folder.
3. Launch. The hunt begins at dusk.

The prebuilt jar is `build/libs/marauder-1.0.0.jar` after building (see below).

## How it plays

Each eligible night follows a rhythm: **Omen → Stalking → Ambush → Challenge →
Duel → Outcome → Return**.

- **Eligibility** (all must be true): Overworld, difficulty not Peaceful, actual
  night (not weather-dark), you are alive and in Survival/Adventure, you have not
  already had an encounter this night, and you have not finished Night 10 (unless
  you armed a rematch).
- **Stalking & ambush.** The Marauder spawns 24–48 blocks away on fair, open
  ground — never inside your walls, liquids, or suffocation spots — and holds
  position until you come near.
- **The duel.** When you enter the trigger radius it locks onto you, plays a
  dread cue ("The Marauder has found you."), and fights *only you*. Other players
  deal 90% reduced damage to it and cannot steal your progression. Boss bar
  appears for stages 7–10.
- **Progression.** Defeating it advances your stage — but only on the **next**
  eligible night. Dying, fleeing, or logging out does **not** advance you. One
  attempt per night; stages can't be farmed.
- **Persistence.** Your stage, defeat history, and behavior profile are saved
  server-side per player UUID and survive death, logout, world reload, and
  server restarts. Multiplayer players each keep an independent Marauder.
- **Adaptive memory.** The Marauder biases its attacks based on how you fought
  last time (shield turtling → more Guard Breakers; constant fleeing → more
  chains and pursuit; trap reliance → more repositioning). Subtle, not unfair.

### The ten nights

| Night | Form | Focus |
| ---: | --- | --- |
| 1 | Rusted Challenger | Reckless basic melee |
| 2 | Scarred Pursuer | Lunge Cut, punishes backpedaling |
| 3 | Oathbound Duelist | Guard Breaker, Riposte |
| 4 | Blacksteel Marauder | Grave Step, Earthsplitter shockwave |
| 5 | Ashen Knight | Cinder Arc, Brand of Pursuit |
| 6 | Moonlit Executioner | Moon Flash dash, heal-punish |
| 7 | Spellscarred Knight | Blade Beam, Runic Snare (boss bar) |
| 8 | Abyss-Touched | Abyssal Chain, Night Rend combo |
| 9 | The Unbroken | Starfall Cleave, Last Stand |
| 10 | The Marauder Ascendant | Three-phase final duel, waits by your bed |

Every damaging ability has a **windup telegraph → active frames → recovery
punish window** — no instant, unavoidable damage.

### Rewards

Nightly drops of dark scraps and blacksteel/ash/moon/rune materials scale with
stage. Defeating Night 10 drops the **Marauder's Blacksteel Blade** (a
netherite-tier sword with a night curse), a **Trophy Banner**, and an **Ashen
Remnant** — right-click it at night to summon the completed Marauder for a
rematch.

## Building from source

Requires a JDK (17–21) and internet access for the first build (downloads
Minecraft, mappings, and Fabric API).

```bash
./gradlew build
```

The remapped mod jar is written to `build/libs/marauder-<version>.jar`.

### Regenerating textures

The entity skins, item textures, and item models are generated procedurally:

```bash
java tools/GenAssets.java src/main/resources
java tools/GenIcon.java src/main/resources/assets/marauder/icon.png
```

## Architecture

Authoritative logic is server-side; the client only presents particles, sounds,
animation, boss bars, and titles.

- `MarauderEntity` — staged attributes, a deterministic `Behavior` state machine
  (stalk → ambush → challenge → duel → reposition/retreat/defeat, plus the
  Night 10 final-wait/final-duel), ability execution, and anti-cheese damage
  handling.
- `NightManager` — server-tick controller: eligibility, fair ambush placement,
  spawn/staging, one-encounter-per-night, final-duel setup near your respawn.
- `MarauderState` / `PlayerProgress` — per-player persistent state via vanilla
  `PersistentState` on the overworld.
- `DuelManager` — one active Marauder per player; unambiguous duel ownership.
- `Ability` — declarative telegraph/active/recovery/cooldown/range table.

## License

MIT.
