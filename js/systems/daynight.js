// Summoner Realms — day / night cycle.
import { DAY_LENGTH } from '../config.js?v=snowy-taiga-npc-2';

export class DayNight {
  constructor(t = DAY_LENGTH * 0.15, day = 1) {
    this.t = Math.max(0, Number(t) || 0) % DAY_LENGTH;
    this.day = Math.max(1, Math.floor(Number(day) || 1));
  }

  // Returns true when the clock rolls into a new world day. The day counter is
  // deliberately separate from the visual phase so NPC respawn rules survive
  // save/load and network clock synchronisation.
  update(dt) {
    let rolled = false;
    this.t += Math.max(0, dt || 0);
    while (this.t >= DAY_LENGTH) {
      this.t -= DAY_LENGTH;
      this.day++;
      rolled = true;
    }
    return rolled;
  }

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
