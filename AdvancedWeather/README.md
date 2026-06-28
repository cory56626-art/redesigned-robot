# Advanced Weather System (Minecraft Bedrock Add-on)

Three escalating storm systems for Minecraft Bedrock, each with **4 levels**:

| Storm | What it does |
|-------|--------------|
| ❄ **Snowstorm** | Snow & cold. Level 1 is a calm winter; higher levels add a freezing meter, snow that buries caves and houses, and a lethal *Fimbulwinter* at level 4. |
| 🌀 **Hurricane** | Wind that shoves you around, rain, and lightning at high levels. |
| ⚡ **Omega Storm** | Everything at once — freezing, burying snow, brutal wind, and lightning, scaled up. |

## Storm levels

**Snowstorm**
1. Normal winter — snow falls, ambient fog. No danger.
2. A freezing/warmth meter appears. Exposed to the open sky (and away from heat) you slowly freeze; at 0 warmth you take frostbite damage and slow down.
3. Snow piles up — small caves fill in, doorways and paths get blocked, you must dig out. You freeze noticeably faster and visibility drops.
4. **Fimbulwinter** — snow buries huge caves and can fully cover a house; whiteout fog; unsheltered players can die in about a minute.

**Hurricane** — wind strength climbs each level (push → stagger → toss), rain becomes thunder, and lightning strikes near exposed players at levels 3–4.

**Omega Storm** — snowstorm + hurricane combined and amplified at every level.

## How to use / test

Open chat and run any of these (`/scriptevent`):

```
/scriptevent aw:snow 1        start a snowstorm at level 1
/scriptevent aw:snow 4        jump straight to Fimbulwinter
/scriptevent aw:hurricane 3   hurricane with lightning
/scriptevent aw:omega 4       the full combined storm
/scriptevent aw:level 2       change the current storm's level
/scriptevent aw:next          step the current storm up one level
/scriptevent aw:clear         stop the storm
/scriptevent aw:info          show the active storm
/scriptevent aw:warmth        print your warmth value
/scriptevent aw:demo          auto-cycle every storm and level (run again to stop)
/scriptevent aw:help          list all commands
```

Also: `/scriptevent aw:set <snowstorm|hurricane|omega> <1-4>`.

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

## Notes

- Targets the `@minecraft/server` Script API (manifest pins `1.13.0`). The
  wind knockback call is written to work on both the 1.x and 2.x signatures.
- Snow accumulation is throttled with a per-pass block-write budget so it
  never lags the server.
- Tunable numbers (freeze rates, wind strength, fog, block budgets) all live in
  `behavior_pack/scripts/config.js`.
