// Summoner Realms — PeerJS transport (host-authoritative). Cross-platform PC/mobile.
import { MSG, ROOM_PREFIX } from './protocol.js';
import { shortId } from '../utils.js';

// Peer options. Defaults to the public PeerJS cloud broker. To use the optional
// self-hosted server in /server, add URL params: ?peerhost=HOST&peerport=9000
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const host = q.get('peerhost');
  const opts = { debug: 1 };
  if (host) {
    opts.host = host;
    opts.port = parseInt(q.get('peerport') || '9000', 10);
    opts.path = q.get('peerpath') || '/';
    opts.secure = q.get('peersecure') === '1';
  }
  return opts;
}

export class Net {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.isHost = false;
    this.hostId = null;      // player id of the host
    this.selfId = null;      // this peer's player id
    this.roomCode = null;
    this.conns = new Map();  // host: peerId -> conn
    this.hostConn = null;    // client: connection to host
    this.status = 'offline'; // offline|connecting|connected|error
    this.statusMsg = '';
  }

  available() { return typeof window.Peer === 'function'; }

  // ---------- Host ----------
  host(onReady, attempt = 0) {
    if (!this.available()) { this.game.onJoinError('Multiplayer library failed to load. Check your connection.'); return; }
    this.isHost = true;
    this.status = 'connecting';
    const code = shortId(5);
    const peer = new window.Peer(ROOM_PREFIX + code, peerOptions());
    this.peer = peer;
    peer.on('open', (id) => {
      this.selfId = id;
      this.hostId = id;
      this.roomCode = code;
      this.status = 'connected';
      onReady(code);
    });
    peer.on('connection', (conn) => this._onIncoming(conn));
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && attempt < 5) { peer.destroy(); this.host(onReady, attempt + 1); return; }
      this.status = 'error'; this.statusMsg = err.type;
      this.game.onJoinError('Host error: ' + err.type);
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  }

  _onIncoming(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
    });
    conn.on('data', (msg) => this.game.handleNetMessage(conn.peer, msg, conn));
    conn.on('close', () => { this.conns.delete(conn.peer); this.game.onClientLeave(conn.peer); });
    conn.on('error', () => { this.conns.delete(conn.peer); this.game.onClientLeave(conn.peer); });
  }

  // ---------- Client ----------
  join(code, onReady) {
    if (!this.available()) { this.game.onJoinError('Multiplayer library failed to load. Check your connection.'); return; }
    this.isHost = false;
    this.status = 'connecting';
    this.roomCode = code;
    const peer = new window.Peer(null, peerOptions());
    this.peer = peer;
    let opened = false;
    peer.on('open', (id) => {
      this.selfId = id;
      const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
      this.hostConn = conn;
      const timeout = setTimeout(() => { if (!opened) { this.status = 'error'; this.game.onJoinError('Could not reach room ' + code + '. Check the code.'); this.leave(); } }, 12000);
      conn.on('open', () => {
        opened = true; clearTimeout(timeout);
        this.status = 'connected';
        this.hostId = conn.peer;
        conn.send({ t: MSG.HELLO, name: this.game.playerName, color: this.game.playerColor });
        onReady();
      });
      conn.on('data', (msg) => this.game.handleNetMessage(conn.peer, msg, conn));
      conn.on('close', () => { this.status = 'error'; this.game.onHostLost(); });
      conn.on('error', () => { this.status = 'error'; });
    });
    peer.on('error', (err) => {
      this.status = 'error';
      if (err.type === 'peer-unavailable') this.game.onJoinError('Room "' + code + '" not found.');
      else this.game.onJoinError('Connection error: ' + err.type);
    });
  }

  // ---------- Send helpers ----------
  toHost(msg) { if (this.hostConn && this.hostConn.open) this.hostConn.send(msg); }
  toPeer(peerId, msg) { const c = this.conns.get(peerId); if (c && c.open) c.send(msg); }
  broadcast(msg, exceptId) {
    for (const [pid, c] of this.conns) { if (pid === exceptId) continue; if (c.open) c.send(msg); }
  }
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
    try {
      if (this.hostConn) this.hostConn.close();
      for (const c of this.conns.values()) { try { c.send({ t: MSG.BYE }); c.close(); } catch {} }
      if (this.peer) this.peer.destroy();
    } catch {}
    this.conns.clear();
    this.hostConn = null;
    this.peer = null;
    this.status = 'offline';
  }
}
