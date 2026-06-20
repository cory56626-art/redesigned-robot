SCREAM AUDIO
============

scream.ogg (in this folder) is the chase scream. It is a synthesized,
distorted, loopable human-style scream (Ogg Vorbis, mono, 5s).

It is wired up via:
  - resource_pack/sounds/sound_definitions.json -> "mob.entity_verity.scream"
  - resource_pack/sounds.json -> entity "ambient" event

"Louder as he gets closer": the scream is a positional 3D mono sound, so
Minecraft attenuates it by distance automatically (quiet far, loud near).
max_distance is 48 blocks in sound_definitions.json — raise/lower to taste.

Want a different scream? Just replace scream.ogg with any .ogg you like
(keep the same filename). Bedrock packs require Ogg Vorbis (.ogg).
