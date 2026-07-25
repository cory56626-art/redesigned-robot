// Summoner Realms — network message types (relayed as JSON over Socket.IO).
export const MSG = {
  HELLO: 'hello',       // client -> host : {name, color}
  WELCOME: 'welcome',   // host -> client : full world + assigned id
  SNAPSHOT: 'snap',     // host -> clients: players/enemies/bosses/drops/time
  PSTATE: 'pstate',     // client -> host : own player state + minions
  TILE_EDIT: 'tile',    // any -> host -> all : {tx,ty,id}
  WALL_EDIT: 'wall',    // any -> host -> all : {tx,ty,id} background wall change
  THROW: 'throw',       // any -> all : a thrown item spawned (visual + sim)
  BOOM: 'boom',         // host -> all : {x,y,power,radius} explosion happened
  HIT_ENEMY: 'hitE',    // client -> host : {netId, dmg, kbx, effect, crit}
  HIT_BOSS: 'hitB',     // client -> host : {dmg, crit}
  HURT: 'hurt',         // host -> client : {dmg, kbx} apply to your player
  GRANT: 'grant',       // host -> client : {item, count} loot granted
  PICKUP: 'pickup',     // client -> host : {netId} request pickup
  PROJFX: 'fx',         // any -> all : visual projectile spawn
  CHAT: 'chat',         // any -> all : {name, color, text}
  EVENT: 'event',       // host -> clients: {kind, ...} (toast/bossDefeat/etc.)
  CMD: 'cmd',           // client -> host : demo command relay {cmd, args}
  BYE: 'bye',
};
