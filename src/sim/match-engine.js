// Full match simulation: player movement, ball physics, possession, tackling, shooting,
// goalkeeping, set pieces, fouls, clock, live stats and replay snapshots. Renderer-agnostic.
import {
  PITCH, TICK, HALF_SECONDS, MATCH_SECONDS, BALL, PLAYER,
  goalCenterX, goalMinX, goalMaxX, attackDir, ownGoalY, targetGoalY,
} from './const.js';
import { RNG } from '../core/rng.js';
import { clamp, lerp, dist2 } from '../core/util.js';
import { formation, POS_GROUP } from '../data/formations.js';
import { buildProfile, formationHome, computeAnchor } from './tactics.js';
import { decideOnBall, offBallIntent, defendIntent, gkIntent, attachBias } from './ai.js?build=d9e11ec6';

const DECISION_INTERVAL = 0.1; // game-seconds between AI re-decisions
const MAX_SUBSTEPS = 34;

export class MatchEngine {
  constructor(home, away, opts = {}) {
    this.rng = new RNG(opts.seed ?? (Date.now() ^ (Math.random() * 1e9)));
    this.worldCup = !!opts.worldCup;
    this.teams = [this._prepTeam(home, 0), this._prepTeam(away, 1)];
    this.profiles = [buildProfile(home.tactics), buildProfile(away.tactics)];
    this.players = [...this.teams[0].players, ...this.teams[1].players];
    this.ball = { x: PITCH.W / 2, y: PITCH.L / 2, z: 0, vx: 0, vy: 0, vz: 0 };
    this.owner = null;
    this.lastTouchTeam = 0;
    this.lastKick = null;      // {passer, receiver, team, type}
    this.possessionTeam = 0;
    this.clock = 0;
    this.half = 1;
    this.phase = 'kickoff';
    this.restartTimer = 1.0;
    this.events = [];
    this.commentary = [];
    this.snapshots = [];
    this._snapT = 0;
    this._decisionT = 0;
    this._accum = 0;
    this.kickLock = 0;         // brief lock preventing the kicker re-controlling the ball
    this._transTimer = 0;
    this._shotCd = [0, 0];     // per-team shot-rate limiter
    this.finished = false;
    this.replay = null;
    this.stats = [this._blankStats(), this._blankStats()];
    this._setupKickoff(this.rng.chance(0.5) ? 0 : 1);
  }

  _blankStats() {
    return { possTicks: 0, shots: 0, onTarget: 0, goals: 0, passes: 0, passesOk: 0, tackles: 0, interceptions: 0, corners: 0, fouls: 0, offsides: 0, saves: 0 };
  }

  _worldCupPlayer(player) {
    // Compress the club-vs-country rating gap for tournament fixtures only.
    // Keep individual differences, but prevent an elite club XI from making the
    // national opponent effectively non-competitive.
    const compressStats = (stats) => {
      if (!stats) return stats;
      return Object.fromEntries(Object.entries(stats).map(([key, value]) => [
        key,
        typeof value === 'number' ? Math.round(clamp(78 + (value - 78) * 0.68, 68, 94)) : value,
      ]));
    };
    return {
      ...player,
      attributes: compressStats(player.attributes),
      gk: compressStats(player.gk),
    };
  }

  _prepTeam(spec, teamIndex) {
    const f = formation(spec.formation || '442');
    const widthFactor = 0.9 + ((spec.tactics?.width ?? 55) / 100) * 0.3;
    const players = spec.players.map((slotEntry, i) => {
      const slot = f.slots[slotEntry.slotIndex ?? i];
      const ref = this.worldCup ? this._worldCupPlayer(slotEntry.player) : slotEntry.player;
      const group = POS_GROUP[slot.pos] || 'CM';
      const home = formationHome(slot, teamIndex, widthFactor);
      const p = {
        team: teamIndex, dir: attackDir(teamIndex), group, slotPos: slot.pos,
        ref, isGK: !!ref.isGK, number: i === 0 ? 1 : i + 1, name: ref.name,
        pos: { x: home.x, y: home.y }, vel: { x: 0, y: 0 }, facing: teamIndex === 0 ? Math.PI / 2 : -Math.PI / 2,
        home, stamina: 100, action: 'idle', actionT: 0,
        intent: { tx: home.x, ty: home.y, speed: 0, sprint: false },
        runTimer: 0, runChannel: home.x, tackleCd: 0, ballHold: 0,
        stats: { goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, passesOk: 0, tackles: 0, interceptions: 0, distance: 0 },
        ...deriveAttrs(ref),
      };
      attachBias(p);
      return p;
    });
    return { spec, name: spec.name, colors: spec.colors || ['#2d7dd2', '#ffffff'], kit: spec.kit, players, score: 0 };
  }

  // ---- public API ----
  step(realDtOrGameDt, isGameDt = true) {
    if (this.finished) return;
    let gameDt = isGameDt ? realDtOrGameDt : realDtOrGameDt;
    this._accum += gameDt;
    let steps = 0;
    while (this._accum >= TICK && steps < MAX_SUBSTEPS) {
      this._tick(TICK);
      this._accum -= TICK;
      steps++;
    }
    if (steps >= MAX_SUBSTEPS) this._accum = 0; // avoid spiral
  }

  state() {
    return {
      ball: this.ball,
      players: this.players,
      teams: this.teams,
      score: [this.teams[0].score, this.teams[1].score],
      clock: this.clock, half: this.half, phase: this.phase,
      possessionTeam: this.possessionTeam,
      stats: this.stats,
    };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---- core tick ----
  _tick(dt) {
    // Restart / celebration handling pauses live play but still advances timers.
    if (this.phase === 'goal' || this.phase === 'halftime' || this.phase === 'kickoff' || this.phase === 'setpiece') {
      this.restartTimer -= dt;
      this._movePlayers(dt, true);
      if (this.restartTimer <= 0) this._resumePlay();
      this._snap(dt);
      return;
    }
    if (this.phase === 'fulltime') return;

    this.kickLock = Math.max(0, this.kickLock - dt);
    this._transTimer = Math.max(0, (this._transTimer || 0) - dt);
    this._shotCd[0] = Math.max(0, this._shotCd[0] - dt);
    this._shotCd[1] = Math.max(0, this._shotCd[1] - dt);
    this._decisionT -= dt;
    if (this._decisionT <= 0) { this._decide(); this._decisionT = DECISION_INTERVAL; }

    this._movePlayers(dt, false);
    this._updateBall(dt);
    this._controlAndTackle(dt);
    this._advanceClock(dt);
    this._snap(dt);

    this.possessionTeam = this.owner ? this.owner.team : this.lastTouchTeam;
    if (this.owner) this.stats[this.owner.team].possTicks++;
    else this.stats[this.lastTouchTeam].possTicks += 0.5;
  }

  _decide() {
    const ball = this.ball;
    const loose = !this.owner;
    // When loose: the two closest of each team contest the ball.
    const chasers = [new Set(), new Set()];
    if (loose) {
      const lead = { x: ball.x + ball.vx * 0.28, y: ball.y + ball.vy * 0.28 };
      for (const t of [0, 1]) {
        for (const p of this._closest(t, lead.x, lead.y, 2, false)) chasers[t].add(p);
      }
    }
    // When owned: the defending team commits pressers (more under a high press).
    const pressers = new Set();
    if (this.owner) {
      const defTeam = this.owner.team === 0 ? 1 : 0;
      // During the transition window the team that just lost the ball backs off.
      const paused = this._transTimer > 0 && this._transPausedTeam === defTeam;
      const n = paused ? 0 : 1 + Math.round(this.profiles[defTeam].press * 1.3); // 1..2
      if (n > 0) for (const p of this._closest(defTeam, ball.x, ball.y, n, false)) pressers.add(p);
    }

    for (const p of this.players) {
      // Owner decides first — including goalkeepers, who must distribute the ball.
      if (p === this.owner) {
        const decision = decideOnBall(this, p);
        if (decision.kick) this._executeKick(p, decision.kick);
        else p.intent = decision;
        continue;
      }

      if (p.isGK) { p.intent = gkIntent(this, p); continue; }

      if (loose && chasers[p.team].has(p)) {
        const lead = { x: ball.x + ball.vx * 0.3, y: ball.y + ball.vy * 0.3 };
        p.intent = { tx: clamp(lead.x, 2, PITCH.W - 2), ty: clamp(lead.y, 2, PITCH.L - 2), speed: 1, sprint: true };
        continue;
      }

      const anchor = computeAnchor(this, p);
      const inPoss = this.possessionTeam === p.team;
      if (inPoss) {
        if ((p.group === 'ST' || p.group === 'W' || p.group === 'AM') && p.runTimer <= 0 && this.rng.chance(0.16)) {
          p.runTimer = this.rng.range(0.8, 1.6);
          p.runChannel = clamp(p.pos.x + this.rng.gaussian(0, 10), 6, PITCH.W - 6);
        }
        p.intent = offBallIntent(this, p, anchor);
      } else {
        p.intent = defendIntent(this, p, anchor, pressers.has(p));
      }
    }
  }

  _closest(team, x, y, n, includeGK) {
    const arr = [];
    for (const p of this.players) {
      if (p.team !== team) continue;
      if (!includeGK && p.isGK) continue;
      arr.push([dist2(p.pos.x, p.pos.y, x, y), p]);
    }
    arr.sort((a, b) => a[0] - b[0]);
    return arr.slice(0, n).map((e) => e[1]);
  }

  _movePlayers(dt, restart) {
    for (const p of this.players) {
      p.runTimer = Math.max(0, p.runTimer - dt);
      p.tackleCd = Math.max(0, p.tackleCd - dt);
      p.ballHold = Math.max(0, p.ballHold - dt);
      if (p.actionT > 0) { p.actionT -= dt; if (p.actionT <= 0) p.action = 'idle'; }

      const it = p.intent;
      let dx = it.tx - p.pos.x, dy = it.ty - p.pos.y;
      const d = Math.hypot(dx, dy);
      const stamF = lerp(0.82, 1, p.stamina / 100);
      let desiredSpeed = (it.sprint ? p.maxSpeed : p.maxSpeed * clamp(it.speed, 0, 1)) * stamF;
      if (restart) desiredSpeed *= 0.7;
      if (d < 0.4) desiredSpeed *= d / 0.4; // ease into target

      let dvx = 0, dvy = 0;
      if (d > 1e-3) { dvx = (dx / d) * desiredSpeed; dvy = (dy / d) * desiredSpeed; }
      // accelerate toward desired velocity
      const ax = dvx - p.vel.x, ay = dvy - p.vel.y;
      const am = Math.hypot(ax, ay);
      const maxA = p.accel * dt;
      if (am > maxA && am > 0) { p.vel.x += (ax / am) * maxA; p.vel.y += (ay / am) * maxA; }
      else { p.vel.x = dvx; p.vel.y = dvy; }

      const sp = Math.hypot(p.vel.x, p.vel.y);
      p.pos.x += p.vel.x * dt; p.pos.y += p.vel.y * dt;
      // bounds
      if (p.pos.x < 1) { p.pos.x = 1; p.vel.x = Math.max(0, p.vel.x); }
      if (p.pos.x > PITCH.W - 1) { p.pos.x = PITCH.W - 1; p.vel.x = Math.min(0, p.vel.x); }
      if (p.pos.y < 0.5) { p.pos.y = 0.5; p.vel.y = Math.max(0, p.vel.y); }
      if (p.pos.y > PITCH.L - 0.5) { p.pos.y = PITCH.L - 0.5; p.vel.y = Math.min(0, p.vel.y); }

      p.stats.distance += sp * dt;
      p.stamina = clamp(p.stamina - sp * dt * 0.0065 * (2 - this._medical), 20, 100);
      if (sp > 0.4) { p.facing = Math.atan2(p.vel.y, p.vel.x); p.action = p.action === 'kick' ? p.action : (sp > p.maxSpeed * 0.7 ? 'sprint' : 'run'); }
      else if (p.action !== 'kick') p.action = 'idle';
    }
  }

  _updateBall(dt) {
    const b = this.ball;
    if (this.owner) {
      // dribble: ball sits just ahead of the owner's feet
      const o = this.owner;
      const fx = Math.cos(o.facing), fy = Math.sin(o.facing);
      const tx = o.pos.x + fx * 0.9, ty = o.pos.y + fy * 0.9;
      b.x = lerp(b.x, tx, 0.5); b.y = lerp(b.y, ty, 0.5);
      b.z = lerp(b.z, 0.18, 0.4);
      b.vx = o.vel.x; b.vy = o.vel.y; b.vz = 0;
      return;
    }
    // free ball integration
    const prevY = b.y, prevX = b.x;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.vz -= BALL.gravity * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -0.5) { b.vz = -b.vz * BALL.bounce; b.vx *= 0.82; b.vy *= 0.82; }
      else b.vz = 0;
    }
    const f = Math.pow(BALL.friction, dt);
    if (b.z < 0.05) { b.vx *= f; b.vy *= f; }
    if (Math.hypot(b.vx, b.vy) < 0.05 && b.z < 0.05) { b.vx = 0; b.vy = 0; }
    if (this._shotLive) { this._shotLive.t += dt; if (this._shotLive.t > 2.5) this._shotLive = null; }

    this._checkGoalAndBounds(prevX, prevY);
    this._gkSave(dt);
  }

  _checkGoalAndBounds(prevX, prevY) {
    const b = this.ball;
    // Goals
    if (b.y >= PITCH.L && prevY < PITCH.L + 0.01 && b.z < PITCH.GOAL_H && b.x > goalMinX && b.x < goalMaxX) return this._goal(0);
    if (b.y <= 0 && prevY > -0.01 && b.z < PITCH.GOAL_H && b.x > goalMinX && b.x < goalMaxX) return this._goal(1);

    // Out over goal lines (not a goal)
    if (b.y > PITCH.L) return this._goalLineOut(0);
    if (b.y < 0) return this._goalLineOut(1);
    // Sidelines
    if (b.x < 0 || b.x > PITCH.W) return this._throwIn();
  }

  _gkSave(dt) {
    if (!this._shotLive) return; // only real shots produce saves
    const b = this.ball;
    for (const gk of this.players) {
      if (!gk.isGK) continue;
      const gy = ownGoalY(gk.team);
      const towardGoal = gk.team === 0 ? b.vy < -2 : b.vy > 2;
      const near = Math.abs(b.y - gy) < 16;
      if (!near || !towardGoal || b.z > PITCH.GOAL_H + 0.4) continue;
      const reach = (3.0 + (gk.gk.reflexes / 99) * 2.4 + (gk.gk.diving / 99) * 1.7)
        * (this.worldCup ? 1.38 : 1);
      const d = dist2(gk.pos.x, gk.pos.y, b.x, b.y);
      if (d > reach) continue;
      const skill = 0.5 * gk.gk.reflexes / 99 + 0.28 * gk.gk.positioning / 99 + 0.22 * gk.gk.diving / 99;
      const q = this._shotLive.quality ?? 0.3;
      // Better chances beat the keeper; better keepers save more. Reach edge also matters.
      const saveP = clamp(0.9 + skill * 0.24 - q * 0.38 - (d / reach) * 0.05, 0.4, 0.995);
      if (this.rng.chance(saveP)) {
        this.stats[gk.team].saves++;
        gk.stats.tackles += 0; // handled as save
        if (this.rng.chance(0.55)) { // catch
          this._giveBall(gk); gk.action = 'save'; gk.actionT = 0.8;
          this._event('save', { by: gk, catch: true });
        } else { // parry
          const a = this.rng.range(0, Math.PI * 2);
          b.vx = Math.cos(a) * 8; b.vy = (gk.team === 0 ? 1 : -1) * Math.abs(Math.sin(a) * 8) + (gk.team === 0 ? 4 : -4);
          b.vz = 3; this.lastTouchTeam = gk.team; this.kickLock = 0.25;
          gk.action = 'save'; gk.actionT = 0.6;
          this._event('save', { by: gk, catch: false });
        }
        return;
      }
    }
  }

  _controlAndTackle(dt) {
    const b = this.ball;
    // Tackle: opponent near the owner may win the ball.
    if (this.owner) {
      const o = this.owner;
      const paused = this._transTimer > 0 ? this._transPausedTeam : -1;
      for (const p of this.players) {
        if (p.team === o.team || p.isGK) continue;
        if (p.team === paused) continue; // recovering shape during transition
        if (p.tackleCd > 0) continue;
        const d = dist2(p.pos.x, p.pos.y, o.pos.x, o.pos.y);
        if (d > PLAYER.reach + 0.4) continue;
        p.tackleCd = 0.5;
        const prob = clamp(p.tackle * 0.5 + p.reactions * 0.2 - o.dribble * 0.52 - o.strength * 0.13 + 0.18, 0.03, 0.85);
        if (this.rng.chance(prob)) {
          p.stats.tackles++; this.stats[p.team].tackles++;
          p.action = 'tackle'; p.actionT = 0.5;
          if (this.rng.chance(0.6)) { this._giveBall(p); this._event('tackle', { by: p, on: o }); }
          else { this._looseFrom(o, 0.4); this._event('tackle', { by: p, on: o, loose: true }); }
          return;
        } else if (this.rng.chance(0.06)) {
          // foul
          this._foul(p, o);
          return;
        }
      }
    }

    if (this.owner || this.kickLock > 0) return;
    if (b.z > 1.4) return; // too high to control
    // Control: nearest reachable player claims a slow-enough ball.
    let best = null, bd = Infinity;
    for (const p of this.players) {
      const d = dist2(p.pos.x, p.pos.y, b.x, b.y);
      const r = BALL.controlRadius + (p.isGK ? 0.8 : 0) + Math.min(1.2, Math.hypot(p.vel.x, p.vel.y) * 0.12);
      if (d < r && d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    const ballSpeed = Math.hypot(b.vx, b.vy);
    const controlCap = 9 + best.control * 16 + best.reactions * 6;
    if (ballSpeed > controlCap) {
      // deflection: nudge the ball, small chance to still trap
      if (this.rng.chance(0.25 + best.control * 0.3)) this._giveBall(best);
      else { b.vx *= 0.6; b.vy *= 0.6; this.lastTouchTeam = best.team; }
      return;
    }
    // interception credit if opponent cuts out a pass/cross
    if (this.lastKick && this.lastKick.team !== best.team && (this.lastKick.type === 'pass' || this.lastKick.type === 'cross')) {
      best.stats.interceptions++; this.stats[best.team].interceptions++;
      this._event('intercept', { by: best });
    } else if (this.lastKick && this.lastKick.receiver === best && this.lastKick.type === 'pass') {
      // completed pass
      this.stats[best.team].passesOk++;
      const passer = this.lastKick.passer;
      if (passer) passer.stats.passesOk++;
    }
    this._giveBall(best);
  }

  _giveBall(p) {
    // offside check on through balls
    if (this.lastKick && this.lastKick.through && this.lastKick.receiver === p && this.lastKick.offside) {
      this.stats[p.team].offsides++;
      this._event('offside', { on: p });
      const defTeam = p.team === 0 ? 1 : 0;
      this._setRestart('freekick', defTeam, p.pos.x, p.pos.y);
      this.lastKick = null;
      return;
    }
    // Possession change → brief transition: the team that lost the ball can't instantly
    // swarm to re-win it (this restoring force prevents runaway one-sided possession).
    if (this.owner === null && this.possessionTeam !== p.team) {
      this._transTimer = 0.2;
      this._transPausedTeam = p.team === 0 ? 1 : 0;
    }
    this.owner = p;
    this._shotLive = null;
    p.ballHold = this.rng.range(1.2, 2.5); // hold the ball a realistic beat before releasing
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.lastTouchTeam = p.team;
    if (this.lastKick && this.lastKick.receiver === p) {
      this.lastPass = this.lastKick;
    } else if (!this.lastKick || this.lastKick.passer !== p) {
      this.lastPass = null; // controlled outside of a designed pass -> no assist
    }
    p.action = 'idle';
    // force a quick re-decision
    this._decisionT = Math.min(this._decisionT, 0.03);
  }

  _looseFrom(o, speed) {
    this.owner = null;
    const a = this.rng.range(0, Math.PI * 2);
    this.ball.vx = Math.cos(a) * speed * 6; this.ball.vy = Math.sin(a) * speed * 6; this.ball.vz = 1;
    this.kickLock = 0.15;
  }

  _executeKick(p, kick) {
    const b = this.ball;
    this.owner = null;
    p.action = 'kick'; p.actionT = 0.35;
    const aim = kick.aim;
    let dx = aim.x - p.pos.x, dy = aim.y - p.pos.y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    // accuracy error
    const acc = p.ref.isGK ? 0.75 : (p.ref.attributes.passing + p.ref.attributes.composure) / 198;
    const errAng = this.rng.gaussian(0, (kick.type === 'shot' ? 0.02 : 0.03) * (1.2 - acc));
    const cos = Math.cos(errAng), sin = Math.sin(errAng);
    const ndx = dx * cos - dy * sin, ndy = dx * sin + dy * cos;
    b.vx = ndx * kick.power; b.vy = ndy * kick.power;
    b.vz = clamp((aim.z || 0) * 3.0, 0, 12);
    b.x = p.pos.x + ndx * 0.9; b.y = p.pos.y + ndy * 0.9; b.z = Math.max(b.z, 0.1);
    this.lastTouchTeam = p.team;
    this.kickLock = 0.22;
    p.facing = Math.atan2(ndy, ndx);

    const offside = kick.through && kick.receiver ? this._isOffside(kick.receiver) : false;
    this.lastKick = { passer: p, receiver: kick.receiver || null, team: p.team, type: kick.type, through: !!kick.through, offside };

    if (kick.type === 'shot') {
      p.stats.shots++; this.stats[p.team].shots++;
      this._shotCd[p.team] = this.worldCup ? 3.8 : 1.8;
      if (this._shotBlocked(p, ndx, ndy)) {
        const defTeam = p.team === 0 ? 1 : 0;
        b.vx = -ndx * 4 + this.rng.gaussian(0, 3); b.vy = -ndy * 4 + this.rng.gaussian(0, 3); b.vz = 2;
        this.lastTouchTeam = defTeam; this._shotLive = null;
        this._event('block', { by: p });
      } else {
        const onT = Math.abs(aim.x - goalCenterX) < PITCH.GOAL_W / 2 + 0.5;
        if (onT) { p.stats.onTarget++; this.stats[p.team].onTarget++; }
        this._shotLive = { team: p.team, t: 0, quality: kick.quality ?? 0.3 };
        this._event('shot', { by: p, onTarget: onT });
      }
    } else {
      this._shotLive = null;
      if (kick.type === 'pass' || kick.type === 'cross') {
        p.stats.passes++; this.stats[p.team].passes++;
        if (kick.type === 'cross') this._event('cross', { by: p });
      } else if (kick.type === 'clear') {
        this._event('clear', { by: p });
      }
    }
  }

  _shotBlocked(p, ndx, ndy) {
    const defTeam = p.team === 0 ? 1 : 0;
    for (const d of this.players) {
      if (d.team !== defTeam || d.isGK) continue;
      const rx = d.pos.x - p.pos.x, ry = d.pos.y - p.pos.y;
      const along = rx * ndx + ry * ndy;         // distance along the shot line
      if (along < 0.5 || along > 9) continue;     // only bodies just in front of the shot
      const perp = Math.abs(rx * -ndy + ry * ndx); // lateral offset from the shot line
      if (perp < 1.7 && this.rng.chance(clamp(0.82 - along * 0.05, 0.25, 0.82))) return true;
    }
    return false;
  }

  _isOffside(receiver) {
    const defTeam = receiver.team === 0 ? 1 : 0;
    const defenders = this.players.filter((q) => q.team === defTeam && !q.isGK);
    // Offside line = deepest outfield defender (GK sits behind). Generous 2m tolerance.
    let ys = defenders.map((d) => d.pos.y);
    ys.sort((a, c) => (defTeam === 0 ? a - c : c - a));
    const lastY = ys[0] ?? ownGoalY(defTeam);
    const beyond = defTeam === 0 ? receiver.pos.y < lastY - 2 : receiver.pos.y > lastY + 2;
    const prog = receiver.team === 0 ? receiver.pos.y / PITCH.L : 1 - receiver.pos.y / PITCH.L;
    return beyond && prog > 0.68; // only genuine attacking-third through-runs
  }

  // ---- events: goals, out of play, fouls ----
  _goal(team) {
    const scorer = this.owner || this.lastKick?.passer || this._nearestAttacker(team);
    this.teams[team].score++;
    this.stats[team].goals++;
    if (scorer) { scorer.stats.goals++; scorer.action = 'celebrate'; scorer.actionT = 2; }
    // assist
    if (this.lastPass && this.lastPass.team === team && this.lastPass.passer && this.lastPass.passer !== scorer) {
      this.lastPass.passer.stats.assists++;
    }
    const assist = this.lastPass && this.lastPass.team === team && this.lastPass.passer !== scorer ? this.lastPass.passer : null;
    this._event('goal', { team, scorer, assist, score: [this.teams[0].score, this.teams[1].score], clock: this.clock });
    this.owner = null;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.phase = 'goal';
    this.restartTimer = 2.6;
    this._pendingKickoff = team === 0 ? 1 : 0;
    this._buildReplay();
    this.lastKick = null; this.lastPass = null;
    this._resetIntents();
    if (scorer) scorer.intent = { tx: clamp(scorer.pos.x, 6, PITCH.W - 6), ty: scorer.pos.y + scorer.dir * 4, speed: 0.9 };
  }

  _nearestAttacker(team) {
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (p.team !== team) continue;
      const d = dist2(p.pos.x, p.pos.y, this.ball.x, this.ball.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  _goalLineOut(lineTeam) {
    // ball crossed goal line at lineTeam's end (lineTeam defends that goal)
    const attackerOut = this.lastTouchTeam !== lineTeam;
    const b = this.ball;
    if (attackerOut) {
      // goal kick for lineTeam
      this._setRestart('goalkick', lineTeam, PITCH.W / 2 + (b.x < PITCH.W / 2 ? -8 : 8), ownGoalY(lineTeam) + (lineTeam === 0 ? 5.5 : -5.5));
    } else {
      // corner for the attacking team
      const attTeam = lineTeam === 0 ? 1 : 0;
      this.stats[attTeam].corners++;
      const cornerX = b.x < PITCH.W / 2 ? 0.6 : PITCH.W - 0.6;
      this._setRestart('corner', attTeam, cornerX, ownGoalY(lineTeam) + (lineTeam === 0 ? 0.6 : -0.6));
      this._event('corner', { team: attTeam });
    }
  }

  _throwIn() {
    const b = this.ball;
    const team = this.lastTouchTeam === 0 ? 1 : 0;
    const x = b.x < PITCH.W / 2 ? 0.5 : PITCH.W - 0.5;
    this._setRestart('throwin', team, x, clamp(b.y, 2, PITCH.L - 2));
  }

  _foul(fouler, victim) {
    this.stats[fouler.team].fouls++;
    fouler.tackleCd = 1.2;
    const inBox = this._inPenaltyBox(victim);
    if (inBox) {
      this._event('penalty', { team: victim.team, on: victim, by: fouler });
      this._setupPenalty(victim.team);
    } else {
      this._event('foul', { by: fouler, on: victim });
      this._setRestart('freekick', victim.team, victim.pos.x, victim.pos.y);
    }
  }

  _inPenaltyBox(p) {
    const gy = targetGoalY(p.team); // attacking toward
    return Math.abs(p.pos.y - gy) < 16.5 && Math.abs(p.pos.x - PITCH.W / 2) < 20.15;
  }

  // ---- restarts ----
  _setRestart(type, team, x, y) {
    this.owner = null;
    const b = this.ball;
    b.x = clamp(x, 0.5, PITCH.W - 0.5); b.y = clamp(y, 0.5, PITCH.L - 0.5); b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0;
    this.phase = 'setpiece';
    this.restartTimer = type === 'corner' ? 1.1 : 0.8;
    this._restartTeam = team;
    this._restartType = type;
    this.lastTouchTeam = team;
    this.lastKick = null;
    this._resetIntents();
    if (type === 'corner') this._positionCorner(team);
  }

  _resetIntents() {
    for (const p of this.players) {
      p.intent = { tx: p.home.x, ty: p.home.y, speed: 0.55, sprint: false };
    }
  }

  _positionCorner(team) {
    const defTeam = team === 0 ? 1 : 0;
    const gy = targetGoalY(team);
    const boxY = gy + (team === 0 ? -8 : 8);
    // attackers flood the box
    const att = this.players.filter((p) => p.team === team && !p.isGK).sort((a, b) => b.ref.attributes.heading + b.ref.attributes.finishing - (a.ref.attributes.heading + a.ref.attributes.finishing));
    att.slice(0, 5).forEach((p, i) => {
      p.intent = { tx: clamp(PITCH.W / 2 + (i - 2) * 5, 12, PITCH.W - 12), ty: boxY + (i % 2) * 3 * (team === 0 ? -1 : 1), speed: 0.8 };
    });
    // defenders drop into their box
    const def = this.players.filter((p) => p.team === defTeam && !p.isGK);
    def.slice(0, 6).forEach((p, i) => {
      p.intent = { tx: clamp(PITCH.W / 2 + (i - 3) * 4, 10, PITCH.W - 10), ty: gy + (team === 0 ? -5 : 5), speed: 0.85 };
    });
  }

  _resumePlay() {
    if (this.phase === 'goal') {
      this._setupKickoff(this._pendingKickoff);
      return;
    }
    if (this.phase === 'halftime') {
      this._setupKickoff(this._pendingKickoff);
      return;
    }
    if (this.phase === 'kickoff') {
      // give ball to a central player of the kickoff team
      const p = this._centralPlayer(this._restartTeam ?? this.possessionTeam);
      if (p) { this._giveBall(p); }
      this.phase = 'play';
      return;
    }
    // set piece: award ball to nearest suitable player of the restart team
    const team = this._restartTeam;
    let target = null;
    if (this._restartType === 'goalkick') target = this.players.find((p) => p.isGK && p.team === team);
    if (!target) {
      let bd = Infinity;
      for (const p of this.players) {
        if (p.team !== team || p.isGK) continue;
        const d = dist2(p.pos.x, p.pos.y, this.ball.x, this.ball.y);
        if (d < bd) { bd = d; target = p; }
      }
    }
    if (target) { target.pos.x = this.ball.x; target.pos.y = this.ball.y + (target.dir) * -1.0; this._giveBall(target); }
    this.phase = 'play';
  }

  _centralPlayer(team) {
    const cands = this.players.filter((p) => p.team === team && (p.group === 'ST' || p.group === 'CM' || p.group === 'AM'));
    return cands.sort((a, b) => Math.abs(a.pos.x - PITCH.W / 2) - Math.abs(b.pos.x - PITCH.W / 2))[0] || this.players.find((p) => p.team === team && !p.isGK);
  }

  _setupKickoff(team) {
    // reset everyone to their own half around formation home
    for (const p of this.players) {
      p.vel.x = 0; p.vel.y = 0;
      p.pos.x = p.home.x;
      // ensure players are in their own half at kickoff
      p.pos.y = p.team === 0 ? Math.min(p.home.y, PITCH.L / 2 - 1) : Math.max(p.home.y, PITCH.L / 2 + 1);
      p.action = 'idle';
    }
    this.ball.x = PITCH.W / 2; this.ball.y = PITCH.L / 2; this.ball.z = 0; this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.owner = null;
    this.possessionTeam = team;
    this._restartTeam = team;
    this.phase = 'kickoff';
    this.restartTimer = 1.0;
    this._resetIntents();
    this._event('kickoff', { team, half: this.half });
  }

  _setupPenalty(team) {
    const gy = targetGoalY(team);
    const spotY = gy + (team === 0 ? -11 : 11);
    this.ball.x = PITCH.W / 2; this.ball.y = spotY; this.ball.z = 0; this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.owner = null;
    this.phase = 'setpiece';
    this.restartTimer = 1.0;
    this._restartTeam = team;
    this._restartType = 'penalty';
    // position taker
    const taker = this.players.filter((p) => p.team === team && !p.isGK).sort((a, b) => b.ref.attributes.finishing - a.ref.attributes.finishing)[0];
    if (taker) { taker.pos.x = PITCH.W / 2; taker.pos.y = spotY + (team === 0 ? -2 : 2); this._penaltyTaker = taker; }
  }

  // ---- clock ----
  _advanceClock(dt) {
    this.clock += dt;
    if (this.half === 1 && this.clock >= HALF_SECONDS) {
      this.clock = HALF_SECONDS;
      this.half = 2;
      this.phase = 'halftime';
      this.restartTimer = 2.0;
      this._pendingKickoff = 1; // other team kicks off 2nd half
      this._event('halftime', { score: [this.teams[0].score, this.teams[1].score] });
    } else if (this.half === 2 && this.clock >= MATCH_SECONDS) {
      this.clock = MATCH_SECONDS;
      this.phase = 'fulltime';
      this.finished = true;
      this._event('fulltime', { score: [this.teams[0].score, this.teams[1].score] });
    }
  }

  // ---- snapshots / replay ----
  _snap(dt) {
    this._snapT -= dt;
    if (this._snapT > 0) return;
    this._snapT = 0.06;
    this.snapshots.push({
      b: { x: this.ball.x, y: this.ball.y, z: this.ball.z },
      p: this.players.map((p) => ({ x: p.pos.x, y: p.pos.y, t: p.team, a: p.action, f: p.facing })),
    });
    if (this.snapshots.length > 110) this.snapshots.shift();
  }

  _buildReplay() {
    this.replay = { frames: this.snapshots.slice(-70).map((s) => ({ b: { ...s.b }, p: s.p.map((q) => ({ ...q })) })) };
    this._event('replay', {});
  }

  // ---- helpers ----
  _event(type, data) {
    const ev = { type, ...data, clock: this.clock, half: this.half, id: this.events.length + this.commentary.length };
    this.events.push(ev);
    this.commentary.push(ev);
    if (this.commentary.length > 60) this.commentary.shift();
  }

  get _medical() { return this._med ?? 1; }
  set medicalLevel(v) { this._med = 1 + (v - 1) * 0.05; }
}

function deriveAttrs(ref) {
  if (ref.isGK) {
    const g = ref.gk;
    return {
      maxSpeed: lerp(4.9, 6.6, g.reactions / 99),
      accel: lerp(20, 34, g.reactions / 99),
      control: 0.5 + g.handling / 198,
      dribble: 0.4, tackle: 0.4, reactions: g.reactions / 99, strength: 0.6, intercept: 0.5,
      gk: g,
    };
  }
  const a = ref.attributes;
  return {
    maxSpeed: lerp(5.6, 8.7, a.pace / 99),
    accel: lerp(22, 43, a.acceleration / 99),
    control: a.ballControl / 99,
    dribble: a.dribbling / 99,
    tackle: a.tackling / 99,
    reactions: a.reactions / 99,
    strength: a.strength / 99,
    intercept: a.interceptions / 99,
  };
}
