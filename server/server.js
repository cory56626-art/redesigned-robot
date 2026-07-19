// ============================================================================
// Summoner Realms — Multiplayer Backend (Express + CORS + Socket.IO)
// ----------------------------------------------------------------------------
// A room-aware relay hub for the host-authoritative Summoner Realms game.
//
// The game itself stays host-authoritative: whichever browser presses
// "Create Server" runs the authoritative world simulation. This backend does
// NOT simulate the game — it manages rooms and relays the game's existing
// message protocol between the host and the joined clients. That keeps every
// bit of gameplay logic (physics, combat, world gen, saves, inventory) exactly
// as it already is, and only swaps the transport (previously WebRTC/PeerJS)
// for HTTPS + WebSockets through Render.
//
// Supported end to end (relayed through the game protocol + tracked in the
// per-room roster): 5-character room codes, many simultaneous rooms, player
// names, positions, health, movement updates, join/leave, world & block
// edits, inventory grants, selected items, and chat. Empty rooms are cleaned
// up automatically. A /health endpoint reports live status.
//
// Render deployment (Root Directory: server):
//   Build Command:  npm install
//   Start Command:  npm start
// The server reads process.env.PORT (Render injects it) and binds 0.0.0.0.
// ============================================================================

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

// ---- Config -----------------------------------------------------------------
const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0'; // Render requires binding all interfaces, not just localhost.

// CORS: allow the GitHub Pages frontend (and anything else) by default. There
// is no authentication yet, so a wildcard is fine for this game. To lock it
// down later, set ALLOWED_ORIGINS to a comma-separated list of origins, e.g.
//   ALLOWED_ORIGINS=https://youruser.github.io,https://summonerrealms.example
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const corsOrigin = ALLOWED.length === 1 && ALLOWED[0] === '*' ? '*' : ALLOWED;

// Room codes: 5 uppercase chars, skipping ambiguous glyphs (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;
const EMPTY_ROOM_GRACE_MS = 60 * 1000; // keep a briefly-empty room alive this long

// ---- Express (HTTP surface: health + friendly root) -------------------------
const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const startedAt = Date.now();

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'Summoner Realms multiplayer backend is running.\n' +
      'Health:   GET /health\n' +
      'Realtime: Socket.IO on this same origin.'
  );
});

app.get('/health', (_req, res) => {
  let players = 0;
  for (const room of rooms.values()) players += room.players.size;
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    rooms: rooms.size,
    players,
    time: new Date().toISOString(),
  });
});

// ---- HTTP + Socket.IO server ------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  // Allow long-poll fallback then upgrade to WebSocket — resilient behind
  // proxies and on mobile networks.
  transports: ['polling', 'websocket'],
});

// ---- Room registry ----------------------------------------------------------
// rooms: code -> { code, hostId, createdAt, players: Map(socketId -> player) }
// player: { id, name, color, x, y, hp, selected, isHost, joinedAt }
const rooms = new Map();

function makeRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LEN; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function newPlayer(socket, { name, color, isHost }) {
  return {
    id: socket.id,
    name: (name || 'Summoner').slice(0, 24),
    color: color || '#7ee0c0',
    x: 0,
    y: 0,
    hp: null,
    selected: null,
    isHost: !!isHost,
    joinedAt: Date.now(),
  };
}

function roster(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    x: p.x,
    y: p.y,
    hp: p.hp,
    selected: p.selected,
    isHost: p.isHost,
  }));
}

// Best-effort roster enrichment: the game's own PSTATE/SNAPSHOT messages carry
// position, health and the selected item, so we peek at them (defensively) to
// keep a live roster the /health endpoint and late joiners can read. Unknown
// shapes are ignored — the relay never depends on these fields.
function observeState(room, fromId, msg) {
  if (!msg || typeof msg !== 'object') return;
  try {
    if (msg.t === 'pstate' && msg.s) {
      const p = room.players.get(fromId);
      if (p) applyState(p, msg.s);
    } else if (msg.t === 'snap' && Array.isArray(msg.players)) {
      for (const s of msg.players) {
        const p = room.players.get(s.id);
        if (p) applyState(p, s);
      }
    }
  } catch (_e) {
    /* never let roster bookkeeping break the relay */
  }
}
function applyState(p, s) {
  if (typeof s.x === 'number') p.x = Math.round(s.x);
  if (typeof s.y === 'number') p.y = Math.round(s.y);
  if (typeof s.hp === 'number') p.hp = s.hp;
  if ('selectedId' in s) p.selected = s.selectedId;
}

function closeRoom(code, reason) {
  const room = rooms.get(code);
  if (!room) return;
  rooms.delete(code);
  console.log(`[room ${code}] closed (${reason || 'empty'})`);
}

// Remove a socket from whatever room it was in, notifying the right peers.
function removeFromRoom(socket, reason) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.roomCode = null;
  if (!room) return;

  const wasHost = room.hostId === socket.id;
  room.players.delete(socket.id);
  socket.leave(code);

  if (wasHost) {
    // Host left: the authoritative world is gone. Tell everyone and close.
    io.to(code).emit('host-gone', { code });
    closeRoom(code, 'host left');
  } else {
    // A client left: tell the host so it drops that player + their minions.
    if (room.hostId) io.to(room.hostId).emit('peer-leave', { id: socket.id });
    console.log(`[room ${code}] client left: ${socket.id} (${reason || 'leave'})`);
    if (room.players.size === 0) scheduleEmptyCleanup(code);
  }
}

function scheduleEmptyCleanup(code) {
  setTimeout(() => {
    const room = rooms.get(code);
    if (room && room.players.size === 0) closeRoom(code, 'empty grace elapsed');
  }, EMPTY_ROOM_GRACE_MS);
}

// ---- Socket.IO wiring -------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.roomCode = null;
  console.log(`socket connected: ${socket.id}`);

  // Host creates a room. ack -> { ok, code, id }
  socket.on('host', (payload = {}, ack) => {
    if (socket.data.roomCode) removeFromRoom(socket, 'rehost');
    const code = makeRoomCode();
    const room = { code, hostId: socket.id, createdAt: Date.now(), players: new Map() };
    const player = newPlayer(socket, { ...payload, isHost: true });
    room.players.set(socket.id, player);
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    console.log(`[room ${code}] created by host ${socket.id} (${player.name})`);
    if (typeof ack === 'function') ack({ ok: true, code, id: socket.id });
  });

  // Client joins a room. ack -> { ok, id, hostId } | { ok:false, error }
  socket.on('join', (payload = {}, ack) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: `Room "${code}" not found.` });
      return;
    }
    if (socket.data.roomCode) removeFromRoom(socket, 'rejoin');
    const player = newPlayer(socket, { ...payload, isHost: false });
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;
    console.log(`[room ${code}] join: ${socket.id} (${player.name})`);
    // Tell the host a peer arrived so it can track the connection count. The
    // client will follow up with the game's own HELLO, which triggers the
    // host to send back the full world (WELCOME).
    io.to(room.hostId).emit('peer-join', { id: socket.id, name: player.name, color: player.color });
    if (typeof ack === 'function') ack({ ok: true, id: socket.id, hostId: room.hostId });
  });

  // ---- Message relay (carries the game's existing protocol untouched) ----

  // client -> host
  socket.on('to-host', (msg) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.hostId) return;
    observeState(room, socket.id, msg);
    io.to(room.hostId).emit('net-msg', { from: socket.id, msg });
  });

  // host (or anyone) -> a specific peer
  socket.on('to-peer', ({ to, msg } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !to || !room.players.has(to)) return;
    io.to(to).emit('net-msg', { from: socket.id, msg });
  });

  // host (or anyone) -> everyone else in the room
  socket.on('broadcast', ({ msg, except } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    observeState(room, socket.id, msg);
    // socket.to(room) already excludes the sender; also honor an explicit except.
    for (const pid of room.players.keys()) {
      if (pid === socket.id || pid === except) continue;
      io.to(pid).emit('net-msg', { from: socket.id, msg });
    }
  });

  // Optional first-class state push (game-agnostic). The frontend doesn't need
  // it — PSTATE/SNAPSHOT already feed the roster — but it's available for tools
  // or alternate clients that want to report position/health/selected item.
  socket.on('state', (s = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p) applyState(p, s);
  });

  // Read-only roster query. ack -> { ok, code, players: [...] }
  // The ack callback is always the last argument whether or not a payload was
  // sent, so pick it off the end rather than a fixed position.
  socket.on('who', (...args) => {
    const ack = args[args.length - 1];
    if (typeof ack !== 'function') return;
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack({ ok: false, error: 'not in a room' });
    ack({ ok: true, code: room.code, hostId: room.hostId, players: roster(room) });
  });

  socket.on('leave', () => removeFromRoom(socket, 'leave'));

  socket.on('disconnect', (reason) => {
    console.log(`socket disconnected: ${socket.id} (${reason})`);
    removeFromRoom(socket, 'disconnect');
  });
});

// ---- Start ------------------------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log(`Summoner Realms backend listening on http://${HOST}:${PORT}`);
  console.log(`Health check:  http://${HOST}:${PORT}/health`);
  console.log(`CORS origin:   ${corsOrigin === '*' ? '* (all)' : ALLOWED.join(', ')}`);
});

// Graceful shutdown so Render restarts/deploys are clean.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} received — shutting down.`);
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
