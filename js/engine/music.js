// Summoner Realms — music.
//
// Tracks are ordinary media files dropped into `assets/music/`. They play
// through <audio> elements routed into the Web Audio graph, which is what makes
// crossfading and the volume slider work; the files are same-origin on GitHub
// Pages, so createMediaElementSource is CORS-clean.
//
// Everything here is optional. Missing files are probed once, remembered as
// missing, and never asked for again — so with an empty assets/music/ directory
// the whole system silently does nothing and the procedural ambience carries
// the game exactly as it did before.
//
// See assets/music/README.md for the filenames.

// Context -> filename base. Any of these may be absent.
export const TRACKS = {
  menu: 'menu',
  'forest-day': 'forest-day',
  'forest-night': 'forest-night',
  dunes: 'dunes',
  frostpine: 'frostpine',
  corruption: 'corruption',
  underground: 'underground',
  cavern: 'cavern',
  'boss-grovekeeper': 'boss-grovekeeper',
  'boss-gravemaw': 'boss-gravemaw',
  'boss-sovereign': 'boss-sovereign',
  boss: 'boss',
};

// Extensions tried in order. mp4/m4a is AAC, which every current browser
// decodes; ogg and mp3 are there so existing files keep working too.
const EXTS = ['mp4', 'm4a', 'ogg', 'mp3'];

const FADE = 1.6; // seconds to crossfade between tracks
// Contexts that may come back empty before we conclude the folder has no music
// at all. Generous enough that a partial soundtrack is never given up on.
const GIVE_UP_AFTER = 5;

export class Music {
  constructor(audio) {
    this.audio = audio;          // the AudioManager, for ctx + musicBus
    this.enabled = true;
    this.volume = 0.55;
    this.current = null;         // { key, el, gain, src }
    this.previous = null;
    this.missing = new Set();    // contexts already known to have no file
    this.found = new Map();      // context -> resolved URL
    this._probes = new Map();    // context -> in-flight probe, so we ask once
    this._emptyStreak = 0;       // consecutive contexts with no file behind them
    this._switchCooldown = 0;
    this._desired = null;
  }

  // Where a context's audio lives, or null if we've already established there is
  // nothing there. Resolution is lazy — nothing is fetched until a context is
  // first requested — and each context is probed exactly once per session, even
  // if several callers ask for it at the same moment.
  _resolve(key) {
    if (this.found.has(key)) return Promise.resolve(this.found.get(key));
    if (this.missing.has(key)) return Promise.resolve(null);
    if (this._probes.has(key)) return this._probes.get(key);

    const base = TRACKS[key];
    if (!base) { this.missing.add(key); return Promise.resolve(null); }

    // If the folder is simply empty — the default state of a fresh checkout —
    // stop probing after a handful of misses rather than 404-ing once per
    // context for the whole session. The moment anything is found this never
    // trips again, so a partial soundtrack still resolves every track it has.
    if (!this.found.size && this._emptyStreak >= GIVE_UP_AFTER) {
      this.missing.add(key);
      return Promise.resolve(null);
    }

    const probe = (async () => {
      for (const ext of EXTS) {
        const url = `./assets/music/${base}.${ext}`;
        try {
          // HEAD keeps the probe cheap. A 404 here is the expected answer for a
          // context with no file, and the browser logs it — that noise is the
          // price of "just drop files in the folder" with no manifest to edit.
          const res = await fetch(url, { method: 'HEAD' });
          if (res.ok) { this.found.set(key, url); this._emptyStreak = 0; return url; }
        } catch (_) {
          // Network or file-protocol failure: treat as absent and move on.
        }
      }
      this.missing.add(key);
      this._emptyStreak++;
      return null;
    })();

    this._probes.set(key, probe);
    probe.finally(() => this._probes.delete(key));
    return probe;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.current && this.current.gain && this.audio.ctx) {
      this.current.gain.gain.setTargetAtTime(this.volume, this.audio.ctx.currentTime, 0.1);
    }
  }

  // Ask for a context. Repeated calls with the same context do nothing, so this
  // is safe to call every frame from the game loop.
  async play(key) {
    if (!this.enabled || !key) return;
    this._desired = key;
    if (this.current && this.current.key === key) return;
    const url = await this._resolve(key);
    if (!url) return;                      // no such track: leave what's playing
    if (this._desired !== key) return;     // context changed while we probed
    if (this.current && this.current.key === key) return;
    this._start(key, url);
  }

  _start(key, url) {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    const el = new Audio(url);
    el.loop = true;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';

    let src, gain;
    try {
      src = ctx.createMediaElementSource(el);
      gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.audio.musicBus || this.audio.master);
    } catch (_) {
      // A browser that refuses the media-element source still gets plain
      // playback, just without the crossfade.
      el.volume = this.volume;
    }

    const now = ctx.currentTime;
    if (gain) gain.gain.setTargetAtTime(this.volume, now, FADE / 3);
    // Autoplay can still be refused; that is not an error worth surfacing.
    const p = el.play();
    if (p && p.catch) p.catch(() => {});

    this._fadeOutCurrent();
    this.current = { key, el, gain, src };
  }

  _fadeOutCurrent() {
    const old = this.current;
    if (!old) return;
    const ctx = this.audio.ctx;
    if (old.gain && ctx) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, FADE / 3);
      setTimeout(() => { try { old.el.pause(); } catch (_) {} }, FADE * 1000 + 400);
    } else {
      try { old.el.pause(); } catch (_) {}
    }
  }

  stop() {
    this._fadeOutCurrent();
    this.current = null;
    this._desired = null;
  }

  /**
   * Decide what should be playing from the state of the world, and switch if it
   * differs. Boss fights win, then depth, then the surface biome and the clock.
   */
  update(game, dt) {
    if (!this.enabled || !this.audio.ctx) return;
    this._switchCooldown -= dt;
    if (this._switchCooldown > 0) return;
    this._switchCooldown = 1.0; // don't thrash at a biome boundary

    if (game.state !== 'playing') { this.play('menu'); return; }
    const p = game.localPlayer;
    if (!p || !game.world) return;

    if (game.bosses.length) {
      const key = game.bosses[0].key;
      const named = key === 'blightSovereign' ? 'boss-sovereign' : 'boss-' + key;
      // Prefer the boss's own theme, fall back to the generic one.
      this._playFirstAvailable([named, 'boss']);
      return;
    }

    const tx = Math.floor((p.x + p.w / 2) / 16);
    const ty = Math.floor((p.y + p.h / 2) / 16);
    const biome = game.world.biomeAt(tx, ty);
    if (biome === 'cavern') { this._playFirstAvailable(['cavern', 'underground']); return; }
    if (biome === 'underground') { this.play('underground'); return; }
    if (biome === 'corrupt') { this._playFirstAvailable(['corruption', 'forest-day']); return; }
    if (biome === 'dunes') { this._playFirstAvailable(['dunes', 'forest-day']); return; }
    if (biome === 'frostpine') { this._playFirstAvailable(['frostpine', 'forest-day']); return; }
    this._playFirstAvailable(game.time.isDay ? ['forest-day'] : ['forest-night', 'forest-day']);
  }

  async _playFirstAvailable(keys) {
    for (const k of keys) {
      const url = await this._resolve(k);
      if (url) { this.play(k); return; }
    }
  }

  // Shown in the Settings panel, so it is obvious whether any files were found.
  statusText() {
    if (this.current) return `Now playing: ${this.current.key}`;
    if (this.found.size) return `${this.found.size} track(s) found in assets/music/.`;
    return 'No music files found — drop tracks into assets/music/ (see its README).';
  }

  // Called when files may have appeared since the last look (e.g. from the
  // console), so a session doesn't have to be restarted to pick them up.
  rescan() {
    this.missing.clear();
    this._probes.clear();
    this._emptyStreak = 0;
  }
}
