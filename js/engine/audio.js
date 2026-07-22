// Summoner Realms — procedural game audio.
// Uses Web Audio so the game ships with no external audio files. The sounds are
// intentionally short and layered, with throttles on repeated mining/combat hits.
const AudioContextCtor = () => window.AudioContext || window.webkitAudioContext;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.ambientStarted = false;
    this.last = Object.create(null);
    this.ambientTimer = 2;
    this.enabled = true;
  }

  attach() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });

    // One consistent click sound for menus, hotbar slots, and mobile action buttons.
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
  }

  _create() {
    if (this.ctx) return true;
    const Ctor = AudioContextCtor();
    if (!Ctor) { this.enabled = false; return false; }
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  _ready() {
    if (!this.enabled) return false;
    if (!this.ctx && !this._create()) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  _throttle(key, ms) {
    const now = performance.now();
    if ((this.last[key] || 0) + ms > now) return false;
    this.last[key] = now;
    return true;
  }

  _tone(freq, duration, opts = {}) {
    if (!this._ready()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startFreq = Math.max(20, freq);
    const endFreq = Math.max(20, opts.endFreq == null ? startFreq : opts.endFreq);
    const volume = opts.volume == null ? 0.16 : opts.volume;
    const attack = opts.attack == null ? 0.004 : opts.attack;
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + Math.max(0.01, duration));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  _noise(duration, volume = 0.1, filterFreq = 1400) {
    if (!this._ready()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      // Slightly smoothed noise is less harsh on mobile speakers.
      const white = Math.random() * 2 - 1;
      previous = previous * 0.65 + white * 0.35;
      data[i] = previous;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  _ambientNoise(filterType, frequency) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const length = Math.floor(ctx.sampleRate * 3);
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
      cave: this._ambientNoise('lowpass', 420),
      wind: this._ambientNoise('lowpass', 1200),
    };
    this.ambientStarted = true;
  }

  update(game, dt) {
    if (!this.ambientStarted || !this.ctx || this.ctx.state === 'suspended') return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 0.25;

    const p = game.localPlayer;
    const world = game.world;
    if (!p || !world) return;

    const tx = Math.floor((p.x + p.w / 2) / 16);
    const ty = Math.floor((p.y + p.h / 2) / 16);
    const biome = world.biomeAt(tx, ty);
    const cave = biome === 'underground' || biome === 'cavern';
    const forest = biome === 'forest' && !cave;
    const wind = !cave;
    const now = this.ctx.currentTime;

    this.ambient.forest.gain.setTargetAtTime(forest ? 0.055 : 0, now, 0.8);
    this.ambient.cave.gain.setTargetAtTime(cave ? 0.075 : 0, now, 0.8);
    this.ambient.wind.gain.setTargetAtTime(wind ? 0.035 : 0, now, 0.8);

    this.ambientTimer = 4 + Math.random() * 5;
    if (forest && Math.random() < 0.72) this._tone(1050 + Math.random() * 500, 0.08, { endFreq: 760, volume: 0.018, type: 'sine' });
    else if (cave && Math.random() < 0.7) this._tone(260 + Math.random() * 80, 0.18, { endFreq: 120, volume: 0.025, type: 'sine' });
    else if (wind) this._noise(0.45, 0.025, 900);
  }

  pickaxeHit() {
    if (!this._throttle('pickaxe', 75)) return;
    this._tone(145, 0.09, { endFreq: 70, volume: 0.2, type: 'triangle' });
    this._noise(0.035, 0.11, 1800);
  }

  axeHit() {
    if (!this._throttle('axe', 90)) return;
    this._tone(105, 0.12, { endFreq: 58, volume: 0.18, type: 'triangle' });
    this._noise(0.045, 0.13, 1000);
  }

  swordSwing() {
    if (!this._throttle('sword', 90)) return;
    this._tone(920, 0.16, { endFreq: 250, volume: 0.12, type: 'sawtooth' });
    this._noise(0.08, 0.045, 2400);
  }

  bowShot() {
    if (!this._throttle('bow', 90)) return;
    this._tone(480, 0.09, { endFreq: 190, volume: 0.09, type: 'triangle' });
    this._noise(0.035, 0.045, 2600);
  }

  magicCast() {
    if (!this._throttle('magic', 90)) return;
    this._tone(680, 0.2, { endFreq: 1100, volume: 0.09, type: 'sine' });
    this._tone(980, 0.14, { endFreq: 1450, volume: 0.04, type: 'sine' });
  }

  enemyHurt() {
    if (!this._throttle('enemyHurt', 55)) return;
    this._tone(185, 0.1, { endFreq: 95, volume: 0.13, type: 'square' });
  }

  enemyDeath() {
    this._tone(240, 0.13, { endFreq: 110, volume: 0.14, type: 'triangle' });
    this._tone(120, 0.22, { endFreq: 48, volume: 0.1, type: 'sine' });
  }

  playerHurt() {
    if (!this._throttle('playerHurt', 220)) return;
    this._tone(180, 0.18, { endFreq: 72, volume: 0.2, type: 'sawtooth' });
    this._noise(0.08, 0.06, 900);
  }

  jump() {
    if (!this._throttle('jump', 90)) return;
    this._tone(260, 0.18, { endFreq: 520, volume: 0.11, type: 'square' });
  }

  itemPickup() {
    if (!this._throttle('pickup', 55)) return;
    this._tone(650, 0.08, { endFreq: 900, volume: 0.1, type: 'sine' });
  }

  coin() {
    this._tone(920, 0.07, { endFreq: 1280, volume: 0.12, type: 'square' });
    this._tone(1280, 0.1, { endFreq: 1700, volume: 0.1, type: 'square' });
  }

  uiClick() {
    if (!this._throttle('ui', 35)) return;
    this._tone(520, 0.045, { endFreq: 380, volume: 0.06, type: 'square' });
  }

  blockPlace() {
    if (!this._throttle('place', 70)) return;
    this._tone(210, 0.1, { endFreq: 120, volume: 0.13, type: 'triangle' });
    this._tone(480, 0.06, { endFreq: 350, volume: 0.05, type: 'sine' });
  }

  blockBreak() {
    if (!this._throttle('break', 55)) return;
    this._noise(0.12, 0.12, 1500);
    this._tone(115, 0.12, { endFreq: 58, volume: 0.1, type: 'triangle' });
  }
}
