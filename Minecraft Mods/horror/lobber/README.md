# The Lobber

A Fabric mod for **Minecraft 1.20.1** that adds a single, rare, *growing* stalker mob: the **Lobber**.

It arrives on your **first night** as a shy little goblin and slowly **matures over several in-game
days** into an obsessive, malicious tormentor that is fixated on **you**. There is only ever **one**,
anywhere in the world, and it is always yours.

## Lifecycle

The Lobber **ages while it stalks you** (configurable, ~6 in-game days to fully mature). As it grows it
gets visibly **bigger, louder, and bolder**:

| Stage | Size & voice | Behavior |
|-------|--------------|----------|
| **Young** (curious goblin) | small, quiet, high-pitched | curious — creeps closer to watch you; plays devious pranks while it doesn't trust you, but can be **befriended** (see Trust) |
| **Growing** | larger, louder | bolder mischief — steals, smashes blocks, snatches animals |
| **Mature** (stalker) | full-size, deep-voiced | a sadistic harassment campaign — unless you've earned enough trust to delay it (see below) |

### Spawning rules
Custom spawner (it is **not** added to normal mob spawning). It appears only when **all** are true:

- It is **night** (from the very first night on).
- A player is **completely alone** (no other players within 48 blocks).
- A valid **low-light** spot exists 24–40 blocks away.
- **No Lobber already exists** — only ever **one** at a time.

## Behavior

### While young / calm
- **Curious, not aggressive:** a young Lobber edges *closer* to its chosen player to watch them
  (the more it trusts you, the closer it dares to come) instead of fleeing.
- **Devious pranks (low trust):** while it doesn't trust you it plays tricks — **walling you into your
  mineshaft** while you dig, or **snatching the item out of your hand** and tossing it just out of reach.
- **Mischief:** pockets/steals blocks, smashes blocks, spirits away animals.

### Taming & Trust
A young Lobber can be **befriended**:

- **Right-click it with empty hand** to pet it (+small trust), or **with food** to feed it (+more trust).
  Hanging around it peacefully (especially while **sneaking**) also slowly builds trust.
- Reach **Trust 20+** and it becomes your **friend** — pranks and mischief stop while it's young.
- Press **R** while looking at (or standing next to) a trusted Lobber to open an **info screen**
  showing its **Health, Age, and Trust**.
- **Trust is a safety net:** when it matures, high trust grants a **grace period** where it stays
  friendly (no harassment, won't aggro on your gaze) — the higher the trust, the longer the grace.
  Trust slowly decays once mature, so eventually its true nature returns. **Hitting it costs trust.**

### Provoked
- **Looking directly at a grown Lobber** (enderman-style stare) or **hitting it** turns it hostile.
- It then keeps its distance, **grabs blocks** and **throws them at you** — damage scales with the
  block (an **iron block hits far harder than wood**).

### Mature — the harassment campaign
Once fully grown it runs **time-of-day-dependent events** against your home (which it learns by spotting
your doors/beds/chests while stalking):

- **Knocks on your door** to taunt you.
- **Shatters your windows** to frighten you — or to crawl in.
- **Breaks in**, smashing a door open.
- **Stares at you through a window while you sleep.**
- **Kills pets/animals** left outside alone.
- **Burns your base down** while you are away exploring (never while you're watching).
- **Hunts villagers** you live near, out of jealousy.

## Underground lore shrines
Cramped tombs of cracked deepslate and cobwebs generate throughout the **mines**, guarded by a
**skeleton spawner** and holding **bones, skulls, ender pearls**, and a **journal page** documenting
the creature.

## Configuration

A config file is written to `config/lobber.json` on first run:

```json
{
  "enableGriefing": true,
  "enableArson": true,
  "enablePetKilling": true,
  "enableVillagerHunting": true,
  "generateShrines": true,
  "daysToMature": 6
}
```

Turn off any of the destructive habits, or change how long it takes to mature. Changes apply on
startup, or live via `/lobber reload`.

## Test / debug commands

All require op (permission level 2) and act on the **nearest Lobber within 64 blocks**:

| Command | Effect |
|---------|--------|
| `/lobber age <0-100>` | Set its age/growth % (also fast-forwards the maturity timer). |
| `/lobber trust <0-100>` | Set its trust toward you. |
| `/lobber event <type>` | Force an event: `knock`, `shatter`, `breakin`, `stare`, `killpet`, `arson`, `villager`. |
| `/lobber spawn` | Spawn a fresh baby Lobber in front of you. |
| `/lobber info` | Print its health/age/trust/state in chat. |
| `/lobber reload` | Reload `config/lobber.json`. |

## Building

Requirements: a JDK (17+). Network access for the first build (downloads Minecraft, mappings, Fabric).

```bash
./gradlew build
```

The finished mod jar is written to `build/libs/lobber-1.2.1.jar` (ignore the `*-sources.jar`).

## Installing

1. Install [Fabric Loader](https://fabricmc.net/use/) for Minecraft 1.20.1.
2. Put [Fabric API](https://modrinth.com/mod/fabric-api) (0.92.x for 1.20.1) in your `mods` folder.
3. Put `lobber-1.2.1.jar` in your `mods` folder.
