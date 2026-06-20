REQUIRED AUDIO FILE
===================

Place an Ogg Vorbis file named:

    scream.ogg

in this folder (next to this note).

That path is already wired up:
  - resource_pack/sounds/sound_definitions.json  -> "mob.entity_verity.scream"
      references "sounds/mob/entity_verity/scream"
  - resource_pack/sounds.json -> maps the entity "ambient" event to that scream

Recommended audio:
  - A long, loud, distorted continuous human scream (loopable, ~3-6 seconds).
  - Format: .ogg (Ogg Vorbis). Bedrock resource packs do not support .wav/.mp3.

How the "gets louder as he gets closer" effect works:
  - The sound is a positional 3D sound. Minecraft attenuates it by distance
    automatically, so it is quiet from far away and loud up close.
  - max_distance is set to 48 blocks in sound_definitions.json. Increase it to
    make the scream audible from farther away, decrease it to tighten the range.

A real, copyrighted scream is intentionally NOT bundled here. Drop in any
scream you have the rights to use and the mob will scream while chasing.
