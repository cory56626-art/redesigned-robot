// storms.js — environmental effects: fog, vanilla weather, lightning, banners.
import { isExposedToSky } from "./util.js";

const FOG_USER_ID = "aw_storm";

// Map a storm's flavour weather to a vanilla weather command keyword.
// Bedrock only knows clear/rain/thunder; "snow" renders as rain in cold biomes.
function vanillaWeather(def) {
  return def.weather === "thunder" ? "thunder" : "rain";
}

// Push the level's fog onto every player and set vanilla weather once.
export function applyEnvironment(players, storm, dimension) {
  const cmd = vanillaWeather(storm.def);
  try { dimension.runCommand(`weather ${cmd} 600`); } catch { /* ignore */ }

  for (const player of players) {
    try {
      player.runCommand(`fog @s remove ${FOG_USER_ID}`);
      player.runCommand(`fog @s push ${storm.def.fog} ${FOG_USER_ID}`);
    } catch { /* fog def missing or player gone */ }
  }
}

// Remove storm fog and restore clear skies for everyone.
export function clearEnvironment(players, dimension) {
  try { dimension.runCommand("weather clear"); } catch { /* ignore */ }
  for (const player of players) {
    try { player.runCommand(`fog @s remove ${FOG_USER_ID}`); } catch { /* gone */ }
  }
}

// Occasionally strike lightning near exposed players during violent storms.
export function maybeLightning(players, storm) {
  if (!storm.def.lightning) return;
  // ~12% chance per affected player per second.
  for (const player of players) {
    if (Math.random() > 0.12) continue;
    if (!isExposedToSky(player)) continue;
    const loc = player.location;
    const ox = (Math.random() - 0.5) * 16;
    const oz = (Math.random() - 0.5) * 16;
    try {
      player.dimension.spawnEntity("minecraft:lightning_bolt", {
        x: Math.floor(loc.x + ox),
        y: loc.y + 6,
        z: Math.floor(loc.z + oz),
      });
    } catch { /* unloaded / invalid spot */ }
  }
}

// Announce a storm change with a title + subtitle to all players.
export function announce(label, level) {
  return { title: `§b${label}`, subtitle: `§7Level ${level} / 4` };
}
