// Summoner Realms — Socket.IO transport (host-authoritative). Cross-platform PC/mobile.
//
// The game stays host-authoritative exactly as before: whoever presses "Create
// Server" runs the world and broadcasts snapshots; others join and send their
// own player state. Only the transport changed — previously peer-to-peer WebRTC
// (PeerJS), now a Render-hosted Socket.IO relay over HTTPS + WebSockets. The
// message protocol (protocol.js) and sync logic (sync.js) are untouched, so all
// gameplay, saves, inventory, combat and controls behave the same.
//
// The backend URL is configured in index.html (window.SUMMONER_SERVER_URL) and
// can be overridden per-visit with ?server=https://your-service.onrender.com
import { MSG } from './protocol.js?v=worm-pathing-1';

// Resolve the multiplayer backend URL, trailing slashes trimmed:
//   1. ?server= query param (handy for testing without editing files)
//   2. window.SUMMONER_SERVER_URL set in index.html (paste your Render URL here)
//   3. dev convenience: a page opened from localhost falls back to :10000
//   4. otherwise '' (not configured) — the UI explains how to set it
export function backendUrl() {
  const trim = (u) => String(u || '').trim().replace(/\/+$/, '');
  const q = new URLSearchParams(location.search);
  const override = trim(q.get('server'));
  if (override) return override;
  const configured = trim(window.SUMMONER_SERVER_URL);
  if (configured) return configured;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'http://localhost:10000';
  return '';
}

export class Net {
  constructor(game) {
    this.game = game;
    this.socket = null;
    this.isHost = false;
    this.hostId = null;      // player id (socket id) of the host
    this.selfId = null;      // this connection's player id (socket id)
    this.roomCode = null;
    this.conns = new Map();  // host: clientId -> true (drives the online count)
    this.status = 'offline'; // offline|connecting|connected|error
    this.statusMsg = '';
    this.url = backendUrl();
    this._announced = false;
    this._leaving = false;
  }

  // The Socket.IO client is loaded via a <script> tag in index.html.
  available() { return typeof window.io === 'function'; }

  _makeSocket() {
    // websocket preferred, polling fallback. Generous timeout + retries so a
    // sleeping free-tier Render instance has time to wake on the first connect.
    return window.io(this.url, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
      reconnectionDelayMax: 4000,
      timeout: 20000,
      withCredentials: false,
    });
  }

  // Deliver relayed game messages to the game. A small conn shim lets sync.js's
  // HELLO handler reply straight to the sender via conn.send(...) unchanged.
  _wireCommon(socket) {
    socket.on('net-msg', ({ from, msg }) => {
      const conn = { peer: from, send: (m) => this.toPeer(from, m) };
      this.game.handleNetMessage(from, msg, conn);
    });
    socket.io.on('reconnect_failed', () => {
      if (this.status !== 'connected') {
        this.status = 'error';
        this.game.onJoinError('Cannot reach the multiplayer server. Check the backend URL in index.html — a free Render instance can take ~30–60s to wake, so try again.');
      }
    });
  }

  _preflight() {
    if (!this.available()) { this.game.onJoinError('Multiplayer library failed to load. Check your connection.'); return false; }
    if (!this.url) { this.game.onJoinError('No multiplayer backend is configured. Paste your Render URL into index.html (window.SUMMONER_SERVER_URL), or add ?server=… to the link.'); return false; }
    return true;
  }

  // ---------- Host ----------
  host(onReady) {
    if (!this._preflight()) return;
    this.isHost = true;
    this._leaving = false;
    this._announced = false;
    this.conns.clear();
    this.status = 'connecting';
    const socket = this._makeSocket();
    this.socket = socket;
    this._wireCommon(socket);

    socket.on('peer-join', ({ id }) => { this.conns.set(id, true); });
    socket.on('peer-leave', ({ id }) => { this.conns.delete(id); this.game.onClientLeave(id); });

    socket.on('connect', () => {
      if (this._leaving) return;
      this._announced = true;
      socket.emit('host', { name: this.game.playerName, color: this.game.playerColor }, (res) => {
        if (!res || !res.ok) { this.status = 'error'; this.game.onJoinError('Could not start the server room. Try again.'); this.leave(); return; }
        this.selfId = res.id;
        this.hostId = res.id;
        this.roomCode = res.code;
        this.status = 'connected';
        onReady(res.code);
      });
    });
    socket.on('disconnect', () => {
      if (this._leaving) return;
      // Socket.IO can recover from a transient disconnect. Re-announce the
      // host instead of leaving the game in a permanently disconnected state.
      this._announced = false;
      this.status = 'connecting';
      const peers = [...this.conns.keys()];
      this.conns.clear();
      for (const id of peers) this.game.onClientLeave(id);
    });
    socket.on('connect_error', () => { /* manager retries; reconnect_failed reports the give-up */ });
  }

  // ---------- Client ----------
  join(code, onReady) {
    if (!this._preflight()) return;
    this.isHost = false;
    this._leaving = false;
    this._announced = false;
    this.status = 'connecting';
    this.roomCode = code;
    const socket = this._makeSocket();
    this.socket = socket;
    this._wireCommon(socket);

    socket.on('host-gone', () => { if (!this._leaving) { this.status = 'error'; this.game.onHostLost(); } });

    socket.on('connect', () => {
      if (this._leaving) return;
      this._announced = true;
      socket.emit('join', { code, name: this.game.playerName, color: this.game.playerColor }, (res) => {
        if (!res || !res.ok) { this.status = 'error'; this.game.onJoinError(res && res.error ? res.error : ('Room "' + code + '" not found.')); this.leave(); return; }
        this.selfId = res.id;
        this.hostId = res.hostId;
        this.status = 'connected';
        // Kick off the game handshake: HELLO prompts the host to send WELCOME
        // (the full world snapshot). Same flow as the old WebRTC transport.
        this.toHost({ t: MSG.HELLO, name: this.game.playerName, color: this.game.playerColor });
        onReady();
      });
    });
    socket.on('disconnect', () => {
      if (this._leaving) return;
      // Keep the local simulation alive while Socket.IO retries. If the host
      // is truly gone, the server's host-gone event or reconnect_failed path
      // will finish the session cleanly.
      this._announced = false;
      this.status = 'connecting';
    });
    socket.on('connect_error', () => { /* manager retries; reconnect_failed reports the give-up */ });
  }

  // ---------- Send helpers ----------
  _live() { return this.socket && this.socket.connected; }
  toHost(msg) { if (this._live()) this.socket.emit('to-host', msg); }
  toPeer(peerId, msg) { if (this._live()) this.socket.emit('to-peer', { to: peerId, msg }); }
  broadcast(msg, exceptId) { if (this._live()) this.socket.emit('broadcast', { msg, except: exceptId }); }
  // Send to everyone appropriately (host -> all clients; client -> host).
  relay(msg, fromId) {
    if (this.isHost) this.broadcast(msg, fromId);
    else this.toHost(msg);
  }

  peerCount() { return this.isHost ? this.conns.size + 1 : (this.status === 'connected' ? 2 : 1); }

  statusText() {
    if (this.status === 'connected') return this.isHost ? `Hosting · ${this.conns.size + 1} online` : 'Connected';
    if (this.status === 'connecting') return 'Connecting…';
    if (this.status === 'error') return 'Disconnected';
    return 'Offline';
  }
  statusClass() { return this.status === 'connected' ? 'connected' : this.status === 'connecting' ? 'connecting' : 'error'; }

  leave() {
    this._leaving = true;
    this._announced = false;
    try {
      if (this.socket) { this.socket.emit('leave'); this.socket.disconnect(); }
    } catch {}
    this.conns.clear();
    this.socket = null;
    this.status = 'offline';
  }
}
