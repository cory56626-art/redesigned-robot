// Summoner Realms — weather.
//
// Sibling to systems/daynight.js: that exposes one global `brightness` scalar
// the renderer and lighting read, this exposes one global signed `wind` scalar
// read by leaf/plant sway, particle drift, player movement and the ambient
// audio bed.
//
// Wind blows from exactly one side at a time. That is enforced structurally
// rather than by clamping: the strength eases toward a target, and the
// direction may only flip while the strength is passing through calm — so it
// always dies down before it picks up the other way, and never blows both ways
// at once.
//
// Deterministic given (seed, elapsed time) so a networked client that misses a
// snapshot still lands on the same weather the host has.
import { DAY_LENGTH } from '../config.js?v=realms-difficulty-22';
import { mulberry32 } from '../utils.js?v=realms-difficulty-22';

// A new target is picked this often (seconds). DAY_LENGTH is 180s, so this is
// roughly "every few hours" in game time.
const GUST_INTERVAL = 22;
// Below this magnitude the wind counts as calm and may change direction.
const CALM = 0.08;
// How fast the current strength chases its target.
const EASE = 0.55;

export class Weather {
  constructor(seed = 1) {
    this._rand = mulberry32((seed ^ 0x5eeded) >>> 0);
    this.dir = this._rand() < 0.5 ? -1 : 1;
    this.strength = 0.15;
    this.target = 0.15;
    this._timer = GUST_INTERVAL * this._rand();
    // Fast, small-amplitude flutter layered on the slow strength, so leaves
    // never look like they are being moved by a single sine wave.
    this._flutter = 0;
  }

  update(dt) {
    this._timer -= dt;
    if (this._timer <= 0) {
      this._timer = GUST_INTERVAL * (0.6 + this._rand() * 0.8);
      this._pickTarget();
    }
    // Ease toward the target rather than snapping, so gusts build and fade.
    const k = 1 - Math.pow(1 - EASE, dt);
    this.strength += (this.target - this.strength) * k;
    this._flutter += dt * (1.4 + this.strength * 2.6);
  }

  _pickTarget() {
    const r = this._rand();
    // Mostly gentle, occasionally a real gale. Calm spells are common enough
    // that the direction gets regular opportunities to flip.
    if (r < 0.22) this.target = this._rand() * 0.10;        // calm
    else if (r < 0.75) this.target = 0.15 + this._rand() * 0.35; // breeze
    else this.target = 0.55 + this._rand() * 0.45;          // gale

    // Direction may only change while the wind is actually calm. This is what
    // guarantees it never blows both ways at once.
    if (this.strength < CALM && this._rand() < 0.5) this.dir = -this.dir;
  }

  // Signed wind, -1 (from the right, blowing left) .. +1 (blowing right).
  get wind() { return this.dir * this.strength; }

  // Sway offset for decor at a given world position and time. Each tile gets a
  // phase offset from its coordinates so a hillside of grass ripples rather
  // than moving as one block.
  swayAt(tx, ty) {
    const phase = ((tx * 0.7 + ty * 0.31) % (Math.PI * 2));
    return this.wind * (0.6 + 0.4 * Math.sin(this._flutter + phase));
  }

  get label() {
    const s = this.strength;
    const arrow = this.dir > 0 ? '→' : '←';
    if (s < CALM) return 'Calm';
    if (s < 0.3) return arrow + ' Breeze';
    if (s < 0.6) return arrow + ' Windy';
    return arrow + ' Gale';
  }

  serialize() {
    return { dir: this.dir, strength: this.strength, target: this.target, timer: this._timer };
  }
  deserialize(d) {
    if (!d) return;
    this.dir = d.dir === -1 ? -1 : 1;
    this.strength = Math.max(0, Math.min(1, Number(d.strength) || 0));
    this.target = Math.max(0, Math.min(1, Number(d.target) || 0));
    this._timer = Number(d.timer) || GUST_INTERVAL;
  }
}

// How strongly wind pushes the player, in px/s^2 at full strength. Deliberately
// small: it should make running into a gale feel like work, never like losing
// control of the character.
export const WIND_PLAYER_ACCEL = 46;
