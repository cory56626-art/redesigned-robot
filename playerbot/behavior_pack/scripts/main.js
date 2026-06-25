import {
  world,
  system,
  BlockPermutation,
  EntityDamageCause,
} from "@minecraft/server";

/*
 * PlayerBot — a fake-player entity driven ENTIRELY by /scriptevent commands.
 *
 * Supported events (all under the "playerbot:" namespace):
 *   playerbot:mine_tree                       -> chop the nearest tree
 *   playerbot:mine_block                      -> break the block it looks at
 *   playerbot:goto         <x> <y> <z>        -> walk to coordinates
 *   playerbot:attack                          -> attack the nearest mob
 *   playerbot:place_block  [block_id]         -> place a block in front
 *   playerbot:stop                            -> cancel everything
 *
 * Every event may also carry "name=<botName>" to target a single named bot,
 * otherwise the action is applied to all PlayerBots in the world.
 */

const BOT_TYPE = "playerbot:bot";
const WALK_SPEED = 0.18; // blocks moved per tick while walking
const ARRIVE_DIST = 1.2; // how close counts as "arrived"
const SWING_TICKS = 8; // how long an arm swing lasts
const REACH = 4; // interaction reach in blocks

const LOG_BLOCKS = new Set([
  "minecraft:oak_log",
  "minecraft:birch_log",
  "minecraft:spruce_log",
  "minecraft:jungle_log",
  "minecraft:acacia_log",
  "minecraft:dark_oak_log",
  "minecraft:mangrove_log",
  "minecraft:cherry_log",
  "minecraft:pale_oak_log",
]);

// botId -> { x, y, z } walk target
const walkTargets = new Map();

/* ----------------------------- helpers ----------------------------- */

function passable(block) {
  return !block || block.isAir || block.isLiquid;
}

function setProp(bot, prop, value) {
  try {
    bot.setProperty(prop, value);
  } catch (e) {
    /* property not present — ignore */
  }
}

// Briefly raise the "work" arm-swing animation flag.
function swing(bot, flag = "playerbot:is_mining") {
  setProp(bot, flag, true);
  system.runTimeout(() => setProp(bot, flag, false), SWING_TICKS);
}

// Resolve which bots an event applies to.
function resolveBots(message) {
  const dim = world.getDimension("overworld");
  let bots = [];
  for (const d of [dim, world.getDimension("nether"), world.getDimension("the_end")]) {
    try {
      bots = bots.concat(d.getEntities({ type: BOT_TYPE }));
    } catch (e) {
      /* dimension may be unloaded */
    }
  }
  const nameToken = (message || "")
    .split(/\s+/)
    .find((t) => t.startsWith("name="));
  if (nameToken) {
    const wanted = nameToken.slice("name=".length);
    bots = bots.filter((b) => b.nameTag === wanted);
  }
  return bots;
}

// Drop the natural item form of a block, then clear it to air.
function breakBlock(bot, block) {
  if (!block || block.isAir) return;
  try {
    const stack = block.getItemStack(1, true);
    block.setType("minecraft:air");
    if (stack) {
      block.dimension.spawnItem(stack, {
        x: block.location.x + 0.5,
        y: block.location.y + 0.5,
        z: block.location.z + 0.5,
      });
    }
  } catch (e) {
    /* protected / unbreakable block — skip */
  }
}

/* ----------------------------- actions ----------------------------- */

function actionMineBlock(bot) {
  const hit = bot.getBlockFromViewDirection({ maxDistance: REACH });
  if (!hit || !hit.block) return;
  swing(bot);
  system.runTimeout(() => breakBlock(bot, hit.block), SWING_TICKS);
}

function actionMineTree(bot) {
  // Find a log: prefer the one being looked at, else scan nearby.
  let start = null;
  const hit = bot.getBlockFromViewDirection({ maxDistance: REACH + 2 });
  if (hit && hit.block && LOG_BLOCKS.has(hit.block.typeId)) {
    start = hit.block;
  } else {
    const o = bot.location;
    outer: for (let r = 0; r <= 4 && !start; r++) {
      for (let x = -r; x <= r; x++) {
        for (let y = -1; y <= 4; y++) {
          for (let z = -r; z <= r; z++) {
            const b = bot.dimension.getBlock({
              x: Math.floor(o.x) + x,
              y: Math.floor(o.y) + y,
              z: Math.floor(o.z) + z,
            });
            if (b && LOG_BLOCKS.has(b.typeId)) {
              start = b;
              break outer;
            }
          }
        }
      }
    }
  }
  if (!start) return;

  // Walk the trunk upward, breaking each log with a swing, one per few ticks.
  let { x, y, z } = start.location;
  let delay = 0;
  for (let i = 0; i < 24; i++) {
    const here = bot.dimension.getBlock({ x, y: y + i, z });
    if (!here || !LOG_BLOCKS.has(here.typeId)) break;
    const target = here;
    swing(bot);
    system.runTimeout(() => breakBlock(bot, target), delay + SWING_TICKS);
    delay += SWING_TICKS;
  }
}

function actionGoto(bot, message) {
  const nums = (message || "")
    .split(/\s+/)
    .filter((t) => t !== "" && !t.startsWith("name="))
    .map(Number);
  if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) return;
  walkTargets.set(bot.id, { x: nums[0], y: nums[1], z: nums[2] });
  setProp(bot, "playerbot:is_moving", true);
}

function actionAttack(bot) {
  const candidates = bot.dimension
    .getEntities({
      location: bot.location,
      maxDistance: REACH + 1,
      excludeTypes: [BOT_TYPE, "minecraft:player", "minecraft:item", "minecraft:xp_orb"],
    })
    .filter((e) => e.id !== bot.id && e.isValid());
  if (candidates.length === 0) return;

  let nearest = candidates[0];
  let best = Infinity;
  for (const e of candidates) {
    const dx = e.location.x - bot.location.x;
    const dz = e.location.z - bot.location.z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      nearest = e;
    }
  }

  setProp(bot, "playerbot:is_attacking", true);
  system.runTimeout(() => setProp(bot, "playerbot:is_attacking", false), SWING_TICKS);

  try {
    bot.teleport(bot.location, { facingLocation: nearest.location });
    nearest.applyDamage(4, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: bot,
    });
    const dx = nearest.location.x - bot.location.x;
    const dz = nearest.location.z - bot.location.z;
    const len = Math.hypot(dx, dz) || 1;
    nearest.applyKnockback(dx / len, dz / len, 0.6, 0.3);
  } catch (e) {
    /* target became invalid */
  }
}

function actionPlaceBlock(bot, message) {
  const idToken = (message || "")
    .split(/\s+/)
    .find((t) => t.includes(":") && !t.startsWith("name="));
  const blockId = idToken || "minecraft:cobblestone";

  // Place into the first passable cell in front of the bot at foot level.
  const dir = bot.getViewDirection();
  const o = bot.location;
  const fx = Math.floor(o.x + dir.x * 1.2);
  const fy = Math.floor(o.y);
  const fz = Math.floor(o.z + dir.z * 1.2);
  const target = bot.dimension.getBlock({ x: fx, y: fy, z: fz });
  if (!target || !passable(target)) return;

  swing(bot);
  system.runTimeout(() => {
    try {
      target.setPermutation(BlockPermutation.resolve(blockId));
    } catch (e) {
      /* invalid block id — ignore */
    }
  }, SWING_TICKS);
}

function actionStop(bot) {
  walkTargets.delete(bot.id);
  setProp(bot, "playerbot:is_moving", false);
  setProp(bot, "playerbot:is_mining", false);
  setProp(bot, "playerbot:is_attacking", false);
  setProp(bot, "playerbot:is_jumping", false);
}

/* --------------------------- walk loop ----------------------------- */

system.runInterval(() => {
  for (const [id, dest] of walkTargets) {
    const bot = world.getEntity(id);
    if (!bot || !bot.isValid()) {
      walkTargets.delete(id);
      continue;
    }
    const loc = bot.location;
    const dx = dest.x - loc.x;
    const dz = dest.z - loc.z;
    const flat = Math.hypot(dx, dz);
    if (flat <= ARRIVE_DIST) {
      setProp(bot, "playerbot:is_moving", false);
      setProp(bot, "playerbot:is_jumping", false);
      walkTargets.delete(id);
      continue;
    }

    const step = Math.min(WALK_SPEED, flat);
    const nx = loc.x + (dx / flat) * step;
    const nz = loc.z + (dz / flat) * step;
    let ny = loc.y;

    const dim = bot.dimension;
    const ahead = dim.getBlock({ x: Math.floor(nx), y: Math.floor(loc.y), z: Math.floor(nz) });
    if (!passable(ahead)) {
      // Try to step/jump up one block.
      const aboveAhead = dim.getBlock({ x: Math.floor(nx), y: Math.floor(loc.y) + 1, z: Math.floor(nz) });
      const aboveHead = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y) + 2, z: Math.floor(loc.z) });
      if (passable(aboveAhead) && passable(aboveHead)) {
        ny = loc.y + 1;
        setProp(bot, "playerbot:is_jumping", true);
      } else {
        // Blocked solid wall — give up on this target.
        setProp(bot, "playerbot:is_moving", false);
        walkTargets.delete(id);
        continue;
      }
    } else {
      setProp(bot, "playerbot:is_jumping", false);
      // Step down toward the ground if there is a gap.
      const below = dim.getBlock({ x: Math.floor(nx), y: Math.floor(loc.y) - 1, z: Math.floor(nz) });
      if (passable(below) && loc.y - dest.y > 0.5) {
        ny = loc.y - 1;
      }
    }

    setProp(bot, "playerbot:is_moving", true);
    try {
      bot.teleport(
        { x: nx, y: ny, z: nz },
        { facingLocation: { x: dest.x, y: ny + 1.6, z: dest.z } }
      );
    } catch (e) {
      walkTargets.delete(id);
    }
  }
}, 1);

/* ----------------------- scriptevent router ------------------------ */

system.afterEvents.scriptEventReceived.subscribe(
  (ev) => {
    if (!ev.id.startsWith("playerbot:")) return;
    const bots = resolveBots(ev.message);
    for (const bot of bots) {
      switch (ev.id) {
        case "playerbot:mine_tree":
          actionMineTree(bot);
          break;
        case "playerbot:mine_block":
          actionMineBlock(bot);
          break;
        case "playerbot:goto":
          actionGoto(bot, ev.message);
          break;
        case "playerbot:attack":
          actionAttack(bot);
          break;
        case "playerbot:place_block":
          actionPlaceBlock(bot, ev.message);
          break;
        case "playerbot:stop":
          actionStop(bot);
          break;
        default:
          break;
      }
    }
  },
  { namespaces: ["playerbot"] }
);

world.afterEvents.worldInitialize?.subscribe?.(() => {});
