# Summoner Realms — Multiplayer Backend

A small **Node.js + Express + Socket.IO** server that powers online multiplayer
for Summoner Realms. It runs as a **Web Service on [Render](https://render.com)**
and the GitHub Pages frontend connects to it over **HTTPS + WebSockets**.

The game is **host-authoritative**: whichever browser presses *Create Server*
runs the authoritative world (physics, combat, world gen, saves). This backend
does **not** simulate the game — it manages **rooms** and **relays** the game's
existing message protocol between the host and joined clients. That means all
gameplay, saves, inventory, controls, and mobile support are untouched; only the
network transport changed (previously peer-to-peer WebRTC/PeerJS, now Render).

---

## Deploy on Render

1. Push this repository to GitHub (already connected).
2. In Render, create a **New → Web Service** from this repo.
3. Use these settings:

   | Setting | Value |
   | --- | --- |
   | **Root Directory** | `server` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | `Free` |

   You do **not** need to set `PORT` — Render injects it and the server reads
   `process.env.PORT` (falling back to `10000` for local runs). The server binds
   `0.0.0.0`, as Render requires.

4. Deploy. When it's live, Render gives you a URL like
   `https://summoner-realms.onrender.com`.
5. Open that URL — you should see a "backend is running" message. Add `/health`
   to confirm: `https://<your-service>.onrender.com/health` returns JSON.
6. **Paste that URL into the frontend.** Open `index.html` at the repo root and
   set:

   ```html
   <script>
     window.SUMMONER_SERVER_URL = 'https://your-service.onrender.com';
   </script>
   ```

   (You can also append `?server=https://your-service.onrender.com` to the game
   URL to test without editing files.)

> **Free instance note:** Render's free tier sleeps after ~15 minutes of
> inactivity. The first connection after a sleep can take ~30–60s to wake the
> service. That's expected on the free plan.

---

## Run locally

```bash
cd server
npm install
npm start
```

- Server: <http://localhost:10000>
- Health: <http://localhost:10000/health>

Then load the frontend with `?server=http://localhost:10000` (or set
`window.SUMMONER_SERVER_URL` in `index.html`).

---

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `10000` | Port to listen on. Render sets this automatically. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated allowlist of frontend origins for CORS. Leave unset to allow all (no auth yet). Example: `https://youruser.github.io`. |

---

## What the backend supports

- **Rooms** with **5-character codes** (e.g. `Q7K2M`), many at once.
- **Create / join** rooms; **player names** and colors.
- **Player positions, health, movement** updates (relayed + tracked per room).
- **Player join / leave** notifications.
- **World & block edits**, **inventory** grants, **selected items**.
- **Chat** messages.
- **Room cleanup** when empty (with a short grace period).
- A **`/health`** endpoint reporting uptime, room count, and player count.
- **No authentication yet** (intentionally, for now).

---

## Socket.IO API (reference)

The frontend uses `js/net/net.js`; you normally don't call these directly.

**Client → Server**

| Event | Payload | Ack | Meaning |
| --- | --- | --- | --- |
| `host` | `{ name, color }` | `{ ok, code, id }` | Create a room and become its host. |
| `join` | `{ code, name, color }` | `{ ok, id, hostId }` / `{ ok:false, error }` | Join an existing room. |
| `to-host` | `msg` | — | Relay a game message to the room host. |
| `to-peer` | `{ to, msg }` | — | Relay a game message to one peer. |
| `broadcast` | `{ msg, except }` | — | Relay a game message to everyone else in the room. |
| `state` | `{ x, y, hp, selected }` | — | Optional lightweight roster update. |
| `who` | — | `{ ok, players:[...] }` | Read the current room roster. |
| `leave` | — | — | Leave the current room. |

**Server → Client**

| Event | Payload | Meaning |
| --- | --- | --- |
| `net-msg` | `{ from, msg }` | An incoming relayed game message. |
| `peer-join` | `{ id, name, color }` | A client joined (sent to host). |
| `peer-leave` | `{ id }` | A client left (sent to host). |
| `host-gone` | `{ code }` | The host disconnected; the room is closing. |

`msg` bodies are the game's own protocol (see `js/net/protocol.js`): `hello`,
`welcome`, `snap`, `pstate`, `tile`, `chat`, and so on. The server treats them
as opaque payloads to route, except for a defensive peek at `pstate`/`snap` to
keep the per-room roster's position/health/selected fields current.
