# The Lobber

A small Fabric mod for **Minecraft 1.20.1** that adds a single, rare, mischievous mob: the **Lobber**.

## What is the Lobber?

A short, skinny, enderman-like humanoid with a glowing green grin. It does not spawn like an ordinary
monster — it creeps into your world only once you've settled in, and stalks lone players from the dark.

### Spawning rules
The Lobber spawns through a custom spawner (it is **not** added to normal mob spawning), only when **all** of these are true:

- The world is at least **3 days** old.
- It is **night**.
- A player is **completely alone** (no other players within 48 blocks).
- A valid **low-light** spot exists 24–40 blocks from that player.
- **No other Lobber currently exists** — there is only ever **one** at a time, anywhere in the world.

### Behavior
- **Stalking (calm):** shadows the lone player from a wary distance, keeping its space and slipping
  away (teleporting) if you get too close without noticing it.
- **Mischief (calm):** every so often it will smash a nearby block, quietly **steal** a block from your
  base, or spirit away a nearby **animal**.
- **Provoked (aggressive):** if you **look directly at it** (like catching an enderman's stare) or
  **hit it**, it turns hostile.
- **Lobbing blocks:** once aggressive it keeps its distance, **grabs blocks** from the environment and
  **throws them at you**. Damage scales with the block — an **iron block hits far harder than wood**.

## Building

Requirements: a JDK (17+). Network access for first build (downloads Minecraft, mappings, Fabric).

```bash
./gradlew build
```

The finished mod jar is written to `build/libs/lobber-1.0.0.jar`.

> Note: ignore `*-sources.jar`; the file to install is `lobber-1.0.0.jar`.

## Installing

1. Install [Fabric Loader](https://fabricmc.net/use/) for Minecraft 1.20.1.
2. Put [Fabric API](https://modrinth.com/mod/fabric-api) (0.92.x for 1.20.1) in your `mods` folder.
3. Put `lobber-1.0.0.jar` in your `mods` folder.
