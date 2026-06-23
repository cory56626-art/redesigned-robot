// Mythic Morsels - on-eat effects
// Targets @minecraft/server 1.14.0 (Minecraft Bedrock 1.21+)
import { world } from "@minecraft/server";

world.afterEvents.itemCompleteUse.subscribe((event) => {
  const player = event.source;
  const typeId = event.itemStack?.typeId;
  if (!player || !typeId) return;

  if (typeId === "mm:mythic_cookie") {
    // Night-vision "glow" for 30 seconds
    player.addEffect("night_vision", 30 * 20, { amplifier: 0, showParticles: false });
  } else if (typeId === "mm:mooncheese") {
    // Speed II for 20s + a short regeneration burst
    player.addEffect("speed", 20 * 20, { amplifier: 1, showParticles: true });
    player.addEffect("regeneration", 4 * 20, { amplifier: 0, showParticles: true });
  }
});
