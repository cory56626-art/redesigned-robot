# Cheat Feather Menu — Minecraft Bedrock Addon

A joke/prank addon. You get a **Cheat Feather**, and using it opens a **fake cheat menu**
(Aim Assist, Bow Aimbot, Kill Aura, ESP, Fly, etc.). The toggles flip a fancy `ON/OFF`
state and play a sound — but **none of them do anything real**. It's purely for fun/trolling.

## What it does
- Gives every player a **Cheat Feather** the first time they spawn in.
- **Use / long-press** the feather to open the fake cheat menu.
- Tap any cheat to toggle it `ON`/`OFF` (fake — no effect on gameplay).
- Lost your feather? Type `!feather` (or `!cheat`) in chat, or run
  `/give @s fcm:cheat_feather`.

## Install (Cheat Feather Menu.mcaddon)
1. On a device with Minecraft Bedrock installed, open **`Cheat Feather Menu.mcaddon`**.
   Minecraft imports it automatically.
2. Create/edit a world.
3. Under **Behavior Packs**, activate **Cheat Feather Menu**.
4. In world settings, turn **ON**:
   - **Beta APIs** (Experiments)  ← required, the menu uses the Script API.
5. Play the world. You'll be handed a Cheat Feather on spawn.

## Notes
- Requires Minecraft Bedrock **1.21.0+** with the **Beta APIs / Script API** experiment enabled.
- Uses script modules `@minecraft/server 1.11.0` and `@minecraft/server-ui 1.2.0`.
  If a much newer Minecraft version rejects these, bump the versions in
  `CheatFeatherBP/manifest.json` to the ones your version ships.
