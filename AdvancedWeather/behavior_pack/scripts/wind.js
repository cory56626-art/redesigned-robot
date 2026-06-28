// wind.js — hurricane/omega wind that shoves exposed entities around.
import { isExposedToSky } from "./util.js";

// A wind direction that slowly rotates so gusts feel alive instead of constant.
let windAngle = 0;

export function advanceWind() {
  windAngle += 0.35 + Math.random() * 0.25;
  if (windAngle > Math.PI * 2) windAngle -= Math.PI * 2;
}

// Apply wind knockback to an exposed player. `strength` comes from the storm
// level (config.wind). Gusts vary so the push isn't perfectly uniform.
export function applyWind(player, strength) {
  if (strength <= 0) return;
  if (!isExposedToSky(player)) return;

  const gust = strength * (0.6 + Math.random() * 0.8);
  const dx = Math.cos(windAngle);
  const dz = Math.sin(windAngle);
  // Slight upward lift at high strength so players get tossed, not just slid.
  const vertical = strength > 1.2 ? Math.min(0.45, strength * 0.18) : 0;
  try {
    // @minecraft/server 1.x signature: (dirX, dirZ, horizontalStrength, vertical)
    player.applyKnockback(dx, dz, gust, vertical);
  } catch {
    // @minecraft/server 2.x changed this to (horizontalForce: VectorXZ, vertical).
    try {
      player.applyKnockback({ x: dx * gust, z: dz * gust }, vertical);
    } catch {
      // Player left the world / is dead — nothing to push.
    }
  }
}
