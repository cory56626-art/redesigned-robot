# Advanced Weather System (Minecraft Bedrock Add-on)

Three escalating storm systems for Minecraft Bedrock, each with **4 levels**:

| Storm | What it does |
|-------|--------------|
| ❄ **Snowstorm** | Snow & cold. Level 1 is a calm winter; higher levels add a freezing meter, snow that buries caves and houses, and a lethal *Fimbulwinter* at level 4. |
| 🌀 **Hurricane** | Wind that shoves you around, rain, and lightning at high levels. |
| ⚡ **Omega Storm** | Everything at once — freezing, burying snow, brutal wind, and lightning, scaled up. |

## Storm levels

**Snowstorm** (death times are for an unsheltered player ignoring the warmth meter)
1. Normal winter — snow falls, ambient fog. No danger.
2. A freezing/warmth meter appears. Warmth drains in ~9s exposed, then frostbite damage + slowdown set in (death in ~20s if ignored). Light snow dusting builds up.
3. Brutal cold — warmth gone in ~4s, heavy frostbite, mining-fatigue and strong slowdown; snow actively buries small caves, doorways and paths. Visibility drops hard.
4. **Fimbulwinter** — warmth gone in ~2s and lethal within seconds; near-whiteout fog; snow buries huge caves and fully covers houses. Get inside or die.

> A single torch or lantern is **not** enough heat to survive a blizzard — you need a real heat source nearby (campfire, fire, lava, magma) or solid shelter from the open sky.

**Hurricane** — wind strength climbs each level (push → stagger → toss), rain becomes thunder, and lightning strikes near exposed players at levels 3–4.

**Omega Storm** — snowstorm + hurricane combined and amplified at every level.

## How long do storms last?

Storms now have a **finite, realistic duration** and fade on their own (you'll
see *"The storm has passed."*). Each level rolls a random length within a range:

| Storm | L1 | L2 | L3 | L4 |
|-------|----|----|----|----|
| Snowstorm | 6–10 min | 5–8 min | 4–6 min | 3–5 min |
| Hurricane | 4–7 min | 4–6 min | 3–5 min | 2–4 min |
| Omega | 3–6 min | 3–5 min | 2.5–4 min | 2–3.5 min |

You can override the length per command (see below). Ranges live in
`config.js` under each level's `durationSec`.

## How to use / test

Open chat and run any of these (`/scriptevent`):

```
/scriptevent aw:snow 1        start a snowstorm at level 1 (random duration)
/scriptevent aw:snow 4        jump straight to Fimbulwinter
/scriptevent aw:snow 4 120    Fimbulwinter for exactly 120 seconds
/scriptevent aw:snow 4 0      Fimbulwinter that never ends (great for building)
/scriptevent aw:hurricane 3   hurricane with lightning
/scriptevent aw:omega 4       the full combined storm
/scriptevent aw:level 2       change the current storm's level
/scriptevent aw:next          step the current storm up one level
/scriptevent aw:clear         stop the storm
/scriptevent aw:info          show the active storm + time remaining
/scriptevent aw:warmth        print your warmth value
/scriptevent aw:demo          auto-cycle every storm and level (run again to stop)
/scriptevent aw:help          list all commands
```

Also: `/scriptevent aw:set <snowstorm|hurricane|omega> <1-4> [seconds]`
(`[seconds]` optional: omit = random realistic length, `0` = never ends).

## Install

Double-click `AdvancedWeather.mcaddon` to import, or import it from the
Minecraft "Storage / Settings → Global Resources / Behavior Packs" screen.
Then, in the world settings, enable **both** the behavior and resource packs
(the behavior pack requires the resource pack for fog). Make sure
**Beta APIs / Holiday Creator Features** scripting is allowed if your version
gates the Script API.

## Building from source

```
python3 build_mcaddon.py
```

This zips `behavior_pack/` and `resource_pack/` into `AdvancedWeather.mcaddon`.

## Range — it's world-wide weather, not just "around you"

The storm is global, like real Minecraft weather:

- **Vanilla snow/rain/thunder** and **fog** affect the whole dimension / every
  player's full view.
- **Freezing** applies to every player anywhere in the world, not just near a
  spawn point.
- **Snow accumulation** scatters across the entire **loaded area** around every
  player — a full **110-block radius (220 blocks wide) for every storm and
  level** — landing correctly on hills, valleys and rooftops via
  `getTopmostBlock`. Coverage builds over the storm, so within a minute a
  blizzard blankets thousands of blocks in every direction.

The one hard limit (true of *any* add-on): blocks can only change in **loaded
chunks**. Chunks the game hasn't loaded — far past your simulation distance —
can't be edited by script, so snow piles out as far as Minecraft actually
simulates around players, then stops.

## Notes

- Targets the `@minecraft/server` Script API (manifest pins `1.13.0`). The
  wind knockback call is written to work on both the 1.x and 2.x signatures.
- Snow accumulation is throttled with a per-pass column budget so wide coverage
  never lags the server.
- Tunable numbers (freeze rates, wind strength, fog, accumulation radius &
  budgets) all live in `behavior_pack/scripts/config.js`.
