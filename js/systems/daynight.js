// Summoner Realms — day / night cycle.
import { DAY_LENGTH } from '../config.js?v=realms-2';

export class DayNight {
  constructor(t = DAY_LENGTH * 0.15) { this.t = t; }
  update(dt) { this.t = (this.t + dt) % DAY_LENGTH; }
  get phase() { return this.t / DAY_LENGTH; } // 0..1 (noon ~0.25, midnight ~0.75)
  get brightness() { return 0.56 + 0.44 * Math.cos((this.phase - 0.25) * Math.PI * 2); }
  get isDay() { return this.brightness > 0.5; }
  get label() {
    const p = this.phase;
    if (p < 0.12) return '☀ Morning';
    if (p < 0.42) return '☀ Day';
    if (p < 0.52) return '☀ Dusk';
    if (p < 0.92) return '☾ Night';
    return '☾ Dawn';
  }
  setDay() { this.t = DAY_LENGTH * 0.22; }
  setNight() { this.t = DAY_LENGTH * 0.72; }
}
