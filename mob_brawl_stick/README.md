# 🥊 Brawl Stick — make mobs fight each other (Bedrock)

The classic Java "dueling stick" for Minecraft Bedrock 1.21+. Tag two
mobs with the stick and they turn on each other.

## Install

Open `BrawlStick.mcaddon` with Minecraft and enable **both** packs on your
world (uses the stable Script API — no experimental toggles needed).

## How to use

1. Craft it: **redstone on top of a stick**.
2. **Whack (or right-click) mob #1** — it gets tagged (crit sparkle + action bar message).
3. **Whack mob #2** — angry particles, "FIGHT!", and they go at each other.
4. Sneak + use the stick to clear your tag. Using it on air shows your current tag.

Details:

- Works across species: zombie vs skeleton, iron golem vs creeper, wolf vs
  pillager, two villager-farm iron golems, whatever you like.
- The grudge is kept alive for 60 seconds — if a mob tries to calm down or
  retarget, the stick re-angers them at each other every few seconds until
  one wins, they separate over 40 blocks, or the timer ends.
- Tags expire after 30 seconds if you don't pick an opponent.
- The stick itself hits like a wet noodle (0 attack damage), so tagging
  barely tickles them (1 HP per poke).

## Limitation (Bedrock quirk)

The stick starts fights by making each mob believe the other one attacked
it, which triggers their retaliation AI. Mobs with **no attack AI at all**
(cows, sheep, chickens…) can't throw a punch on Bedrock — tag them and
they'll just panic and run while the other mob chases them down. Anything
that can fight back — zombies, skeletons, golems, wolves, bees, piglins,
spiders, illagers — brawls properly.

## Repo layout

- `BrawlStick_BP/` — behavior pack (item, recipe, script)
- `BrawlStick_RP/` — resource pack (icon textures)
- `tools/generate_textures.py` — regenerates textures (needs Pillow)
- `tools/build_mcaddon.sh` — rebuilds `BrawlStick.mcaddon`
