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
| **Young** (shy goblin) | small, quiet, high-pitched | avoidant — keeps its distance, bolts/teleports if you look at it, only playfully pockets the odd block |
| **Growing** | larger, louder | bolder mischief — steals, smashes blocks, snatches animals; meeting its gaze now **provokes** it |
| **Mature** (stalker) | full-size, deep-voiced | a sadistic harassment campaign (see below) |

### Spawning rules
Custom spawner (it is **not** added to normal mob spawning). It appears only when **all** are true:

- It is **night** (from the very first night on).
- A player is **completely alone** (no other players within 48 blocks).
- A valid **low-light** spot exists 24–40 blocks away.
- **No Lobber already exists** — only ever **one** at a time.

## Behavior

### While young / calm
- **Stalking:** shadows the lone player from a wary distance, slipping away (teleporting) if you get
  too close — far more skittish when young.
- **Mischief:** pockets/steals blocks, smashes blocks, spirits away animals (rarer & gentler when young).

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

Turn off any of the destructive habits, or change how long it takes to mature.

## Building

Requirements: a JDK (17+). Network access for the first build (downloads Minecraft, mappings, Fabric).

```bash
./gradlew build
```

The finished mod jar is written to `build/libs/lobber-1.2.0.jar` (ignore the `*-sources.jar`).

## Installing

1. Install [Fabric Loader](https://fabricmc.net/use/) for Minecraft 1.20.1.
2. Put [Fabric API](https://modrinth.com/mod/fabric-api) (0.92.x for 1.20.1) in your `mods` folder.
3. Put `lobber-1.2.0.jar` in your `mods` folder.
