// Summoner Realms — authored procedural game audio.
// Uses authored OGG sample assets for the primary sound, with the procedural
// layers kept as a graceful fallback if a browser blocks asset loading.
import { Music } from './music.js?v=hivewrought-1';

const AudioContextCtor = () => window.AudioContext || window.webkitAudioContext;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.ambientStarted = false;
    this.last = Object.create(null);
    this.ambientTimer = 1.5;
    this.musicStep = 0;
    this.enabled = true;
    this.samples = Object.create(null);
    this.samplesLoading = false;
    this.sampleAmbient = null;
    // Volumes may be set from saved settings before the context exists.
    this._pendingVolumes = null;
    // Drop-in soundtrack. Does nothing at all until files appear in
    // assets/music/ — see that folder's README.
    this.music = new Music(this);
    this.sampleFiles = {
      pickaxe: 'pickaxe', axe: 'axe', sword: 'sword', bow: 'bow', magic: 'magic',
      enemyHurt: 'enemy-hurt', enemyDeath: 'enemy-death',
      playerHurt: 'player-hurt', jump: 'jump', pickup: 'pickup',
      coin: 'coin', ui: 'ui-click', place: 'block-place',
      break: 'block-break', forest: 'forest', cave: 'cave', wind: 'wind',
    };
  }

  attach() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });

    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (target && target.closest && target.closest('button, .btn, .seg-btn, [role="button"]')) {
        this.uiClick();
      }
    }, true);
  }

  unlock() {
    if (!this.enabled) return;
    this._create();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this._startAmbience();
    this._loadSamples();
    // The first interaction is also when browsers will let music start.
    if (this._pendingMusicContext) this.music.play(this._pendingMusicContext);
  }

  _create() {
    if (this.ctx) return true;
    const Ctor = AudioContextCtor();
    if (!Ctor) { this.enabled = false; return false; }
    try {
      this.ctx = new Ctor();
      // master -> { sfx, ambient, music }: one place to mix, and the settings
      // sliders map onto the buses directly.
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 1;
      this.musicBus.connect(this.master);
      this.applyVolumes(this._pendingVolumes);
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  // Apply the player's volume settings to the mix buses. Safe to call before
  // the audio context exists; the values are stashed and applied on creation.
  applyVolumes(settings) {
    if (!settings) return;
    this._pendingVolumes = settings;
    if (!this.ctx) return;
    const master = settings.masterVolume != null ? settings.masterVolume : 0.8;
    const sfx = settings.sfxVolume != null ? settings.sfxVolume : 0.9;
    const music = settings.musicVolume != null ? settings.musicVolume : 0.55;
    this.master.gain.value = 0.4 * master;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.musicBus) this.musicBus.gain.value = music;
    if (this.music) this.music.setVolume(music * master);
  }

  _ready() {
    if (!this.enabled) return false;
    if (!this.ctx && !this._create()) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  async _loadSamples() {
    if (this.samplesLoading || !this._ready()) return;
    this.samplesLoading = true;
    const jobs = Object.entries(this.sampleFiles).map(async ([key, file]) => {
      try {
        const response = await fetch(`./assets/audio/${file}.ogg`);
        if (!response.ok) return;
        const data = await response.arrayBuffer();
        this.samples[key] = await this.ctx.decodeAudioData(data);
      } catch (_) {
        // Keep the procedural fallback for offline/dev builds.
      }
    });
    await Promise.all(jobs);
    this.samplesLoading = false;
    this._startSampleAmbience();
  }

  _sample(key, volume = 1, delay = 0, rate = 1) {
    if (!this._ready()) return false;
    const buffer = this.samples[key];
    if (!buffer) return false;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain).connect(this.sfxBus || this.master);
    source.start(this.ctx.currentTime + delay);
    return true;
  }

  _throttle(key, ms) {
    const now = performance.now();
    if ((this.last[key] || 0) + ms > now) return false;
    this.last[key] = now;
    return true;
  }

  _envelope(gain, now, peak, duration, attack = 0.004, release = 0.06) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.01, duration - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  }

  _osc(freq, duration, opts = {}) {
    if (!this._ready()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = Math.max(20, freq);
    const end = Math.max(20, opts.endFreq == null ? start : opts.endFreq);
    osc.type = opts.type || 'sine';
    osc.detune.value = opts.detune || 0;
    osc.frequency.setValueAtTime(start, now);
    if (opts.curve === 'linear') osc.frequency.linearRampToValueAtTime(end, now + duration);
    else osc.frequency.exponentialRampToValueAtTime(end, now + Math.max(0.01, duration));
    this._envelope(gain, now, opts.volume == null ? 0.12 : opts.volume, duration, opts.attack || 0.004, opts.release || 0.06);
    osc.connect(gain).connect(this.sfxBus || this.master);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  _noise(duration, volume = 0.1, filterFreq = 1400, opts = {}) {
    if (!this._ready()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + (opts.delay || 0);
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      previous = previous * (opts.smooth == null ? 0.72 : opts.smooth) + white * (1 - (opts.smooth == null ? 0.72 : opts.smooth));
      data[i] = previous;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = opts.filterType || 'lowpass';
    filter.frequency.setValueAtTime(Math.max(60, filterFreq), now);
    if (opts.endFilter) filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.endFilter), now + duration);
    this._envelope(gain, now, volume, duration, opts.attack || 0.002, opts.release || 0.04);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.sfxBus || this.master);
    source.start(now);
    source.stop(now + duration + 0.03);
  }

  _kick(volume = 0.12, delay = 0) {
    this._osc(125, 0.16, { endFreq: 42, volume, type: 'sine', delay, attack: 0.002, release: 0.08 });
  }

  _pluck(freq, volume = 0.08, delay = 0) {
    this._osc(freq, 0.18, { endFreq: freq * 0.72, volume, type: 'triangle', delay, attack: 0.002, release: 0.08 });
    this._osc(freq * 2.01, 0.12, { endFreq: freq * 1.7, volume: volume * 0.22, type: 'sine', delay: delay + 0.005, attack: 0.002 });
  }

  _ambientNoise(filterType, frequency) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const length = Math.floor(ctx.sampleRate * 4);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.985 + white * 0.015;
      data[i] = previous;
    }
    source.buffer = buffer;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.value = frequency;
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    return gain;
  }

  _startAmbience() {
    if (!this._ready() || this.ambientStarted) return;
    this.ambient = {
      forest: this._ambientNoise('bandpass', 900),
      cave: this._ambientNoise('lowpass', 330),
      wind: this._ambientNoise('lowpass', 850),
    };
    this.ambientStarted = true;
  }

  _startSampleAmbience() {
    if (!this._ready() || this.sampleAmbient) return;
    if (!['forest', 'cave', 'wind'].every((key) => this.samples[key])) return;
    this.sampleAmbient = {};
    for (const key of ['forest', 'cave', 'wind']) {
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = this.samples[key];
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      source.start();
      this.sampleAmbient[key] = gain;
    }
  }

  _forestMotif() {
    const notes = [196, 233, 262, 294, 349, 294, 262];
    const root = notes[this.musicStep % notes.length];
    this._osc(root, 0.52, { endFreq: root * 0.995, volume: 0.055, type: 'sine', attack: 0.08, release: 0.2 });
    this._osc(root * 2, 0.28, { endFreq: root * 1.98, volume: 0.025, type: 'triangle', delay: 0.16, attack: 0.04, release: 0.12 });
    this._pluck(root * 1.5, 0.035, 0.36);
  }

  _caveMotif() {
    const roots = [73.4, 82.4, 65.4, 61.7];
    const root = roots[this.musicStep % roots.length];
    this._osc(root, 1.3, { endFreq: root * 0.98, volume: 0.065, type: 'sine', attack: 0.18, release: 0.35 });
    this._osc(root * 1.5, 0.9, { endFreq: root * 1.47, volume: 0.028, type: 'triangle', delay: 0.22, attack: 0.14, release: 0.25 });
    this._pluck(root * 3, 0.024, 0.8);
  }

  update(game, dt) {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    this.music.update(game, dt);
    if (!this.ambientStarted) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 4.8 + Math.random() * 3.5;
    this.musicStep++;

    const p = game.localPlayer;
    const world = game.world;
    if (!p || !world) return;

    const tx = Math.floor((p.x + p.w / 2) / 16);
    const ty = Math.floor((p.y + p.h / 2) / 16);
    const biome = world.biomeAt(tx, ty);
    const cave = biome === 'underground' || biome === 'cavern';
    const forest = biome === 'forest' && !cave;
    // Wind ambience follows the actual weather rather than being a constant
    // above-ground hiss: a calm day is quiet and a gale is loud, so the sound
    // and the swaying foliage agree with each other.
    const strength = game.weather ? game.weather.strength() : 0.35;
    const wind = cave ? 0 : 0.03 + strength * 0.20;
    const now = this.ctx.currentTime;

    // A real soundtrack takes the foreground; the ambient beds duck under it
    // rather than competing with it.
    const duck = this.music && this.music.current ? 0.4 : 1;
    const bed = this.sampleAmbient || this.ambient;
    bed.forest.gain.setTargetAtTime(forest ? 0.16 * duck : 0, now, 0.9);
    bed.cave.gain.setTargetAtTime(cave ? 0.18 * duck : 0, now, 0.9);
    bed.wind.gain.setTargetAtTime(wind * duck, now, 0.9);
    if (this.sampleAmbient) {
      this.ambient.forest.gain.setTargetAtTime(0, now, 0.9);
      this.ambient.cave.gain.setTargetAtTime(0, now, 0.9);
      this.ambient.wind.gain.setTargetAtTime(0, now, 0.9);
    }

    if (this.music && this.music.current) return; // a track is playing; no motifs
    if (forest) {
      this._forestMotif();
      if (Math.random() < 0.6) this._noise(0.8, 0.018, 1200, { filterType: 'bandpass', endFilter: 500, smooth: 0.9 });
    } else if (cave) {
      this._caveMotif();
      if (Math.random() < 0.55) this._noise(0.6, 0.014, 420, { filterType: 'lowpass', endFilter: 170, smooth: 0.95 });
    } else if (wind) {
      this._noise(0.9, 0.02, 950, { filterType: 'bandpass', endFilter: 240, smooth: 0.88 });
    }
  }

  pickaxeHit() {
    if (!this._throttle('pickaxe', 75)) return;
    if (this._sample('pickaxe', 0.75, 0, 0.94 + Math.random() * 0.12)) return;
    this._kick(0.13);
    this._noise(0.055, 0.12, 2400, { endFilter: 620, smooth: 0.45 });
    this._osc(310, 0.12, { endFreq: 170, volume: 0.06, type: 'triangle', attack: 0.002 });
    this._osc(470, 0.08, { endFreq: 300, volume: 0.03, type: 'sine', delay: 0.014 });
  }

  axeHit() {
    if (!this._throttle('axe', 90)) return;
    if (this._sample('axe', 0.8, 0, 0.94 + Math.random() * 0.1)) return;
    this._kick(0.16);
    this._noise(0.09, 0.1, 860, { endFilter: 250, smooth: 0.42 });
    this._osc(150, 0.16, { endFreq: 62, volume: 0.09, type: 'triangle' });
    this._pluck(250, 0.035, 0.025);
  }

  swordSwing() {
    if (!this._throttle('sword', 90)) return;
    if (this._sample('sword', 0.7, 0, 0.96 + Math.random() * 0.12)) return;
    this._noise(0.18, 0.07, 3200, { filterType: 'bandpass', endFilter: 650, smooth: 0.35 });
    this._osc(980, 0.2, { endFreq: 310, volume: 0.08, type: 'sawtooth', attack: 0.002 });
    this._osc(740, 0.13, { endFreq: 420, volume: 0.045, type: 'triangle', delay: 0.02 });
  }

  bowShot() {
    if (!this._throttle('bow', 90)) return;
    if (this._sample('bow', 0.72, 0, 0.96 + Math.random() * 0.1)) return;
    this._noise(0.08, 0.055, 2600, { filterType: 'bandpass', endFilter: 850, smooth: 0.28 });
    this._osc(320, 0.12, { endFreq: 180, volume: 0.06, type: 'triangle' });
    this._pluck(640, 0.025, 0.035);
  }

  magicCast() {
    if (!this._throttle('magic', 90)) return;
    if (this._sample('magic', 0.68, 0, 0.96 + Math.random() * 0.08)) return;
    this._osc(392, 0.34, { endFreq: 784, volume: 0.055, type: 'sine', attack: 0.025, release: 0.14 });
    this._osc(523, 0.28, { endFreq: 1046, volume: 0.035, type: 'triangle', delay: 0.04, attack: 0.02, release: 0.12 });
    this._pluck(784, 0.03, 0.16);
    this._noise(0.12, 0.025, 1800, { filterType: 'bandpass', endFilter: 600, smooth: 0.72 });
  }

  enemyHurt() {
    if (!this._throttle('enemyHurt', 55)) return;
    if (this._sample('enemyHurt', 0.72, 0, 0.95 + Math.random() * 0.1)) return;
    this._osc(220, 0.11, { endFreq: 105, volume: 0.09, type: 'square', attack: 0.002 });
    this._osc(330, 0.07, { endFreq: 180, volume: 0.035, type: 'triangle', delay: 0.012 });
    this._noise(0.045, 0.03, 1100, { endFilter: 420, smooth: 0.35 });
  }

  enemyDeath() {
    if (!this._throttle('enemyDeath', 40)) return;
    if (this._sample('enemyDeath', 0.78, 0, 0.96 + Math.random() * 0.08)) return;
    this._osc(294, 0.22, { endFreq: 196, volume: 0.09, type: 'triangle' });
    this._osc(233, 0.25, { endFreq: 147, volume: 0.08, type: 'triangle', delay: 0.08 });
    this._osc(175, 0.32, { endFreq: 82, volume: 0.07, type: 'sine', delay: 0.16 });
    this._noise(0.16, 0.06, 1000, { endFilter: 220, smooth: 0.5, delay: 0.08 });
  }

  playerHurt() {
    if (!this._throttle('playerHurt', 220)) return;
    if (this._sample('playerHurt', 0.8, 0, 0.94 + Math.random() * 0.08)) return;
    this._kick(0.18);
    this._osc(190, 0.24, { endFreq: 78, volume: 0.12, type: 'sawtooth' });
    this._osc(247, 0.16, { endFreq: 110, volume: 0.05, type: 'square', delay: 0.02 });
    this._noise(0.1, 0.07, 850, { endFilter: 260, smooth: 0.45 });
  }

  jump() {
    if (!this._throttle('jump', 90)) return;
    if (this._sample('jump', 0.64, 0, 0.96 + Math.random() * 0.08)) return;
    this._osc(220, 0.24, { endFreq: 440, volume: 0.07, type: 'square', attack: 0.006 });
    this._osc(330, 0.19, { endFreq: 660, volume: 0.035, type: 'triangle', delay: 0.035 });
    this._pluck(550, 0.025, 0.08);
  }

  itemPickup() {
    if (!this._throttle('pickup', 55)) return;
    if (this._sample('pickup', 0.72, 0, 0.97 + Math.random() * 0.08)) return;
    this._pluck(523, 0.07);
    this._pluck(659, 0.06, 0.07);
    this._pluck(784, 0.05, 0.14);
  }

  coin() {
    if (!this._throttle('coin', 40)) return;
    if (this._sample('coin', 0.72, 0, 0.96 + Math.random() * 0.1)) return;
    this._pluck(988, 0.07);
    this._pluck(1319, 0.06, 0.07);
    this._pluck(1760, 0.04, 0.15);
  }

  uiClick() {
    if (!this._throttle('ui', 35)) return;
    if (this._sample('ui', 0.68, 0, 0.98 + Math.random() * 0.06)) return;
    this._pluck(392, 0.035);
    this._osc(523, 0.035, { endFreq: 440, volume: 0.018, type: 'sine', delay: 0.01 });
  }

  blockPlace() {
    if (!this._throttle('place', 70)) return;
    if (this._sample('place', 0.72, 0, 0.95 + Math.random() * 0.1)) return;
    this._kick(0.12);
    this._noise(0.06, 0.08, 720, { endFilter: 260, smooth: 0.45 });
    this._pluck(180, 0.04, 0.025);
  }

  // Called from the menu, before a world exists, so the menu theme can start as
  // soon as the browser allows audio at all.
  playMenuMusic() {
    if (!this.ctx) { this._pendingMusicContext = 'menu'; return; }
    this.music.play('menu');
  }

  // A boss winding up: a rising tone that tells you something is coming.
  bossTelegraph() {
    if (!this._throttle('bossTel', 250)) return;
    this._osc(140, 0.5, { endFreq: 320, volume: 0.06, type: 'sawtooth', attack: 0.08, release: 0.2 });
    this._osc(210, 0.42, { endFreq: 470, volume: 0.03, type: 'triangle', delay: 0.05, attack: 0.06 });
  }

  // Vespera's close dives advertise themselves with a dry, double mandible
  // click. It is intentionally brief and high enough to cut through the fight
  // mix without becoming another alarm tone.
  mandibleClick() {
    if (!this._throttle('mandibleClick', 180)) return;
    this._noise(0.025, 0.045, 4100, { filterType: 'highpass', endFilter: 2400, smooth: 0.22 });
    this._osc(1260, 0.045, { endFreq: 980, volume: 0.035, type: 'square', attack: 0.001, release: 0.018 });
    this._noise(0.024, 0.035, 3900, { filterType: 'highpass', endFilter: 2300, smooth: 0.24, delay: 0.095 });
    this._osc(1180, 0.04, { endFreq: 900, volume: 0.028, type: 'square', attack: 0.001, release: 0.016, delay: 0.095 });
  }

  // The phase break is a swarm scream rather than a generic impact: a rising
  // high-frequency layer over a noisy chitin rattle makes the transition clear
  // even when the arena is visually busy.
  vesperaScream() {
    if (!this._throttle('vesperaScream', 850)) return;
    this._osc(520, 0.68, { endFreq: 1860, volume: 0.075, type: 'sawtooth', attack: 0.035, release: 0.16 });
    this._osc(780, 0.58, { endFreq: 2140, volume: 0.032, type: 'triangle', attack: 0.05, release: 0.15, delay: 0.03 });
    this._noise(0.58, 0.045, 2500, { filterType: 'bandpass', endFilter: 5200, smooth: 0.30, attack: 0.02, release: 0.13 });
  }

  bossAttack(type) {
    if (!this._throttle('bossAtk', 90)) return;
    if (type === 'shockwave' || type === 'leap' || type === 'burrow') {
      this._kick(0.2);
      this._noise(0.22, 0.1, 700, { endFilter: 180, smooth: 0.5 });
    } else {
      this._osc(300, 0.24, { endFreq: 140, volume: 0.08, type: 'sawtooth' });
      this._noise(0.14, 0.05, 1600, { filterType: 'bandpass', endFilter: 500, smooth: 0.5 });
    }
  }

  throwItem() {
    if (!this._throttle('throw', 90)) return;
    this._noise(0.12, 0.05, 2200, { filterType: 'bandpass', endFilter: 700, smooth: 0.3 });
    this._osc(420, 0.14, { endFreq: 240, volume: 0.045, type: 'triangle' });
  }

  thrownBounce() {
    if (!this._throttle('bounce', 70)) return;
    this._osc(220, 0.07, { endFreq: 150, volume: 0.04, type: 'square', attack: 0.002 });
    this._noise(0.04, 0.03, 1500, { endFilter: 500, smooth: 0.4 });
  }

  // A blast: low body, mid crack, long debris tail.
  explosion() {
    if (!this._throttle('boom', 60)) return;
    this._osc(90, 0.55, { endFreq: 28, volume: 0.24, type: 'sine', attack: 0.003, release: 0.25 });
    this._osc(170, 0.3, { endFreq: 50, volume: 0.14, type: 'sawtooth', attack: 0.002 });
    this._noise(0.42, 0.2, 2600, { endFilter: 160, smooth: 0.32 });
    this._noise(0.7, 0.06, 900, { endFilter: 120, smooth: 0.7, delay: 0.12 });
  }

  blockBreak() {
    if (!this._throttle('break', 55)) return;
    if (this._sample('break', 0.72, 0, 0.95 + Math.random() * 0.1)) return;
    this._noise(0.11, 0.11, 1600, { endFilter: 420, smooth: 0.45 });
    this._osc(150, 0.15, { endFreq: 64, volume: 0.08, type: 'triangle' });
    this._noise(0.055, 0.045, 2400, { endFilter: 700, smooth: 0.3, delay: 0.045 });
  }
}
