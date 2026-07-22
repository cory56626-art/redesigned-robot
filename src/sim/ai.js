// Player AI. Produces an "intent" for each player each decision tick:
//   { tx, ty, speed, sprint, kick? }
// The engine moves the player toward (tx,ty) and, for the ball owner, executes any kick.
import { PITCH, targetGoalY, ownGoalY, goalCenterX, attackDir } from './const.js';
import { clamp, dist2, lerp } from '../core/util.js';
import { combinedBias } from '../data/playstyles.js';

// ---------- geometry helpers ----------
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-6;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

function teammates(engine, p) {
  return engine.players.filter((q) => q.team === p.team && q !== p && !q.isGK);
}
function opponents(engine, p) {
  return engine.players.filter((q) => q.team !== p.team);
}

function nearestOpp(engine, p) {
  let best = null, bd = Infinity;
  for (const q of engine.players) {
    if (q.team === p.team) continue;
    const d = dist2(p.pos.x, p.pos.y, q.pos.x, q.pos.y);
    if (d < bd) { bd = d; best = q; }
  }
  return { player: best, dist: bd };
}

/** Openness of a passing lane 0..1 (1 = clear). */
function laneOpenness(engine, ax, ay, bx, by, team) {
  let worst = 1;
  for (const q of engine.players) {
    if (q.team === team) continue;
    const { d, t } = pointSegDist(q.pos.x, q.pos.y, ax, ay, bx, by);
    if (t < 0.04 || t > 0.98) continue;
    const block = clamp(d / 4.5, 0, 1); // within ~4.5m of the lane = threat
    worst = Math.min(worst, block);
  }
  return worst;
}

function pressure(engine, x, y, team) {
  let nd = Infinity;
  for (const q of engine.players) {
    if (q.team === team) continue;
    nd = Math.min(nd, dist2(x, y, q.pos.x, q.pos.y));
  }
  return clamp(1 - nd / 9, 0, 1); // 0 = free, 1 = tightly marked
}

function shotAngleFactor(x, y, team) {
  // Fraction of the goal mouth visible; central + close = better.
  const gy = targetGoalY(team);
  const half = PITCH.GOAL_W / 2;
  const distX = Math.abs(x - goalCenterX);
  const distY = Math.abs(gy - y) + 1;
  const spread = Math.atan2(half + distX, distY) - Math.atan2(-half + distX, distY);
  return clamp(spread / 0.5, 0.05, 1);
}

// ---------- on-ball decision ----------
export function decideOnBall(engine, p) {
  const team = p.team;
  const gx = goalCenterX, gy = targetGoalY(team);
  const dGoal = dist2(p.pos.x, p.pos.y, gx, gy);
  const prof = engine.profiles[team];
  const bias = p.bias;
  const press = pressure(engine, p.pos.x, p.pos.y, team);
  const prog = p.team === 0 ? p.pos.y / PITCH.L : 1 - p.pos.y / PITCH.L;
  const a = p.ref.isGK ? null : p.ref.attributes;
  const rnd = engine.rng;
  // Attacking urgency ramps up near the opponent goal: circulate less, shoot/penetrate more.
  const urgency = clamp((prog - 0.45) * 2.2, 0, 1);

  // --- SHOOT --- (mostly close range; elite long-shooters stretch it a little)
  let shoot = -1, shootAim = null;
  const shootRange = 16 + (a ? clamp(a.longShots - 60, 0, 35) * 0.2 : 0);
  const shotReady = !(engine._shotCd && engine._shotCd[team] > 0);
  if (a && dGoal < shootRange && shotReady) {
    const ang = shotAngleFactor(p.pos.x, p.pos.y, team);        // 0..1 goal openness
    const closeness = clamp(1 - dGoal / shootRange, 0, 1);
    const isLong = dGoal > 17;
    const skill = (isLong ? a.longShots : a.finishing) / 99;
    let q = (0.32 + 0.68 * closeness) * (0.32 + 0.68 * ang) * (0.55 + 0.5 * skill);
    q *= isLong ? (bias.longshot || 1) * 0.85 : (bias.shoot || 1);
    q *= 1 - press * 0.2;
    q *= 1 + urgency * 0.45;                                     // increasingly willing near goal
    var shootQuality = clamp((0.3 + 0.7 * closeness) * (0.35 + 0.65 * ang) * (1 - press * 0.4), 0.04, 1); // chance quality for the GK
    // scaled so a real chance in the box outranks passing / dribbling
    // World Cup matches should feel competitive without turning every attack into a
    // goalfest. Scale shot selection only for national-team fixtures.
    shoot = q * 1.7 * (0.9 + prof.attack * 0.2) * (engine.worldCup ? 0.2 : 1);
    if (shootQuality < 0.42) shoot *= 0.18;                      // only take genuine chances
    if (press > 0.68) shoot *= 0.35;                             // can't get it away when swarmed
    const side = rnd.chance(0.5) ? -1 : 1;
    const spread = (1 - a.composure / 99) * 4.5 + press * 3.4 + (isLong ? 2.4 : 0.6);
    shootAim = { x: clamp(gx + side * (PITCH.GOAL_W / 2 - 0.5) + rnd.gaussian(0, spread), gx - 6, gx + 6), y: gy, z: clamp(rnd.range(0.1, 1.6) + (isLong ? 0.5 : 0), 0.05, 2.4) };
  }

  // --- PASS ---
  let bestPass = -1, passTarget = null, passReceiver = null, through = false;
  for (const t of teammates(engine, p)) {
    const lead = leadPoint(t, 0.4);
    const dt = dist2(p.pos.x, p.pos.y, lead.x, lead.y);
    if (dt < 4) continue;
    const open = laneOpenness(engine, p.pos.x, p.pos.y, lead.x, lead.y, team);
    if (open < 0.38) continue;                                   // filter risky passes into traffic
    const tProg = t.team === 0 ? lead.y / PITCH.L : 1 - lead.y / PITCH.L;
    const adv = tProg - prog;                                    // forward progress fraction
    let score = 0.42 - urgency * 0.22;                           // circulate less near the box
    score += Math.max(0, adv) * (1.95 + prof.directness * 1.3);  // reward forward passes
    if (adv < -0.02) score -= 0.28 - prof.patience * 0.12 + urgency * 0.2; // don't go backward near goal
    score += clamp(tProg, 0, 1) * 0.6 * (t.group === 'ST' || t.group === 'W' || t.group === 'AM' ? 1 : 0.5);
    const runner = adv > 0.08 && isBeyondLastDefender(engine, t);
    if (runner) score += (0.7 + prof.directness * 0.4) * (1 + urgency * 0.5); // through-ball to a runner
    score *= 0.72 + 0.28 * open;                                 // openness matters, but attack anyway
    score -= clamp((dt - 30) / 45, 0, 0.5);                      // long-pass penalty
    score *= (0.7 + (a ? a.passing / 99 : 0.7) * 0.5) * (bias.pass || 1);
    if (score > bestPass) { bestPass = score; passTarget = lead; passReceiver = t; through = runner; }
  }
  if (press > 0.5 && bestPass > 0) bestPass += 0.3;             // urgency to release under pressure

  // --- CROSS ---
  let cross = -1, crossTarget = null;
  const wide = p.pos.x < 18 || p.pos.x > PITCH.W - 18;
  if (wide && prog > 0.6 && a) {
    const boxY = lerp(gy, p.pos.y, 0.25);
    const targetsInBox = teammates(engine, p).filter((t) => {
      const tp = t.team === 0 ? t.pos.y / PITCH.L : 1 - t.pos.y / PITCH.L;
      return tp > 0.78 && Math.abs(t.pos.x - goalCenterX) < 16;
    });
    if (targetsInBox.length) {
      const best = targetsInBox.sort((m, n) => Math.abs(m.pos.x - goalCenterX) - Math.abs(n.pos.x - goalCenterX))[0];
      crossTarget = { x: clamp(best.pos.x + rnd.gaussian(0, 3), 12, PITCH.W - 12), y: lerp(gy, boxY, 0.4), z: 3 };
      cross = (0.55 + targetsInBox.length * 0.16) * (a.crossing / 99) * (bias.cross || 1) * (0.8 + prof.width * 0.5);
    }
  }

  // --- CLEAR (defensive get-out) ---
  let clear = -1, clearTarget = null;
  if (prog < 0.32 && press > 0.5 && bestPass < 0.5) {
    clear = press * (0.6 + (1 - prog) * 0.6);
    const dirY = attackDir(team);
    clearTarget = { x: clamp(p.pos.x + rnd.gaussian(0, 12), 5, PITCH.W - 5), y: p.pos.y + dirY * 40, z: 4 };
  }

  // --- DRIBBLE (carry) ---
  const aheadY = clampY(p.pos.y + attackDir(team) * 7);
  const spaceAhead = 1 - pressure(engine, p.pos.x, aheadY, team);
  let dribble = -1, dribbleTarget = null;
  if (a) {
    const dribSkill = a.dribbling / 99;
    dribble = (0.5 + 0.5 * spaceAhead) * (0.5 + 0.55 * dribSkill) * (bias.dribble || 1) * (0.8 + 0.35 * (1 - press));
    if (dGoal < 15) dribble *= 0.72;                            // near goal, favour the shot
    if (prof.patience > 0.6) dribble *= 1.03;
    const opp = nearestOpp(engine, p);
    let dx = gx - p.pos.x, dy = gy - p.pos.y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    if (opp.player && opp.dist < 6) {
      let ax = p.pos.x - opp.player.pos.x, ay = p.pos.y - opp.player.pos.y;
      const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
      dx += ax * 1.1; dy += ay * 0.7;
    }
    const nl = Math.hypot(dx, dy) || 1;
    dribbleTarget = { x: clampX(p.pos.x + (dx / nl) * 9), y: clampY(p.pos.y + (dy / nl) * 9) };
  }

  // Take a touch first: after gaining the ball, shield / carry rather than immediately
  // releasing. Only heavy pressure forces a quick release. This paces the game to realistic
  // pass and shot volumes instead of hot-potato football.
  if (p.ballHold > 0 && press < 0.7) {
    bestPass *= 0.35; cross *= 0.35; shoot *= 0.7;
  }

  // choose best
  const opts = [
    { k: 'shoot', v: shoot },
    { k: 'pass', v: bestPass },
    { k: 'cross', v: cross },
    { k: 'clear', v: clear },
    { k: 'dribble', v: dribble },
  ].sort((x, y) => y.v - x.v);
  const choice = opts[0];

  if (choice.k === 'shoot') {
    return { kick: { type: 'shot', aim: shootAim, quality: shootQuality, power: lerp(22, 30, a.shooting / 99) }, tx: p.pos.x, ty: p.pos.y, speed: 0 };
  }
  if (choice.k === 'pass' && passReceiver) {
    const dt = dist2(p.pos.x, p.pos.y, passTarget.x, passTarget.y);
    return { kick: { type: 'pass', aim: { ...passTarget, z: dt > 26 ? 2.2 : 0.15 }, receiver: passReceiver, through, power: clamp(dt * 0.9 + 6, 9, 26) }, tx: p.pos.x, ty: p.pos.y, speed: 0 };
  }
  if (choice.k === 'cross' && crossTarget) {
    return { kick: { type: 'cross', aim: crossTarget, power: 20 }, tx: p.pos.x, ty: p.pos.y, speed: 0 };
  }
  if (choice.k === 'clear' && clearTarget) {
    return { kick: { type: 'clear', aim: clearTarget, power: 26 }, tx: p.pos.x, ty: p.pos.y, speed: 0 };
  }
  // No dribble target (goalkeepers / no space) → distribute or clear rather than hold.
  if (!dribbleTarget) {
    if (passReceiver) {
      const dt = dist2(p.pos.x, p.pos.y, passTarget.x, passTarget.y);
      return { kick: { type: 'pass', aim: { ...passTarget, z: dt > 26 ? 2.2 : 0.15 }, receiver: passReceiver, through, power: clamp(dt * 0.9 + 6, 9, 26) }, tx: p.pos.x, ty: p.pos.y, speed: 0 };
    }
    const dirY = attackDir(team);
    return { kick: { type: 'clear', aim: { x: clamp(p.pos.x + rnd.gaussian(0, 10), 5, PITCH.W - 5), y: clampY(p.pos.y + dirY * 45), z: 4 }, power: 26 }, tx: p.pos.x, ty: p.pos.y, speed: 0 };
  }
  // dribble / carry
  return { tx: dribbleTarget.x, ty: dribbleTarget.y, speed: clamp(0.72 + spaceAhead * 0.3, 0.6, 1), sprint: spaceAhead > 0.6 && press < 0.3, carry: true };
}

function leadPoint(t, k) {
  return { x: t.pos.x + t.vel.x * k, y: t.pos.y + t.vel.y * k };
}

function isBeyondLastDefender(engine, t) {
  const defTeam = t.team === 0 ? 1 : 0;
  const gy = ownGoalY(defTeam);
  const defenders = engine.players.filter((q) => q.team === defTeam && !q.isGK);
  // last defender = the one closest to their own goal line
  let lastY = gy;
  let found = false;
  for (const d of defenders) {
    if (!found) { lastY = d.pos.y; found = true; continue; }
    if (defTeam === 0 ? d.pos.y < lastY : d.pos.y > lastY) lastY = d.pos.y;
  }
  return defTeam === 0 ? t.pos.y < lastY - 0.5 : t.pos.y > lastY + 0.5;
}

const clampX = (x) => clamp(x, 1.5, PITCH.W - 1.5);
const clampY = (y) => clamp(y, 1.5, PITCH.L - 1.5);

// ---------- off-ball (attacking) ----------
export function offBallIntent(engine, p, anchor) {
  const ball = engine.ball;
  let tx = anchor.x, ty = anchor.y, speed = 0.62, sprint = false;

  // Attackers make runs in behind when the ball is with a teammate ahead of the play.
  if ((p.group === 'ST' || p.group === 'W' || p.group === 'AM') && engine.possessionTeam === p.team) {
    if (p.runTimer > 0) {
      const gy = targetGoalY(p.team);
      tx = clamp(p.runChannel, 6, PITCH.W - 6);
      ty = lerp(p.pos.y, gy, 0.24); // stay near the line, time the run onside
      speed = 0.96; sprint = true;
    }
  }

  // Avoid crowding a nearby teammate.
  for (const q of engine.players) {
    if (q === p || q.team !== p.team) continue;
    const d = dist2(p.pos.x, p.pos.y, q.pos.x, q.pos.y);
    if (d < 5) {
      tx += (p.pos.x - q.pos.x) * 0.4;
      ty += (p.pos.y - q.pos.y) * 0.2;
    }
  }
  return { tx: clampX(tx), ty: clampY(ty), speed, sprint };
}

// ---------- defending ----------
export function defendIntent(engine, p, anchor, isPresser) {
  const ball = engine.ball;
  if (isPresser) {
    // Close down the ball / carrier, staying slightly goal-side.
    const gy = ownGoalY(p.team);
    const bx = ball.x, by = ball.y;
    const gsx = bx + (goalCenterX - bx) * 0.12;
    const gsy = by + (gy - by) * 0.12;
    return { tx: clampX(gsx), ty: clampY(gsy), speed: 1, sprint: true };
  }
  // Loosely mark a dangerous nearby opponent, otherwise hold zonal shape. Leaving pockets
  // of space is intentional — it lets attacks develop into shooting chances.
  let mark = null, md = Infinity;
  for (const q of engine.players) {
    if (q.team === p.team || q.isGK) continue;
    const d = dist2(anchor.x, anchor.y, q.pos.x, q.pos.y);
    if (d < md && d < 11) { md = d; mark = q; }
  }
  if (mark) {
    const gy = ownGoalY(p.team);
    const tx = mark.pos.x + (goalCenterX - mark.pos.x) * 0.15;
    const ty = mark.pos.y + (gy - mark.pos.y) * 0.14;
    return { tx: clampX(lerp(anchor.x, tx, 0.55)), ty: clampY(lerp(anchor.y, ty, 0.55)), speed: 0.78 };
  }
  return { tx: anchor.x, ty: anchor.y, speed: 0.62 };
}

// ---------- goalkeeper ----------
export function gkIntent(engine, p) {
  const ball = engine.ball;
  const gy = ownGoalY(p.team);
  const gx = goalCenterX;
  // Position on the line between ball and goal, a little off the line.
  const dToGoal = Math.abs(ball.y - gy);
  let off = clamp(6 - dToGoal * 0.05, 0.6, 6); // come out more when ball is far? actually inverse
  off = clamp(dToGoal < 30 ? 2.5 : 4.5, 1.5, 5);
  const dir = attackDir(p.team === 0 ? 1 : 0); // toward opponent = up the pitch from own goal
  const t = clamp((ball.x - gx) / (PITCH.W / 2), -1, 1);
  const tx = gx + t * (PITCH.GOAL_W / 2 + 3.5);
  let ty = gy + (p.team === 0 ? off : -off);

  // Only rush out for a genuine close-range 1v1 with an opponent, otherwise stay and set for
  // the shot. Over-rushing leaves the goal open and inflates scoring.
  const ownerIsOpp = engine.owner && engine.owner.team !== p.team;
  const close = Math.abs(ball.y - gy) < 8 && Math.abs(ball.x - gx) < 12;
  if (close && ownerIsOpp) {
    return { tx: clampX(lerp(tx, ball.x, 0.5)), ty: clampY(lerp(ty, ball.y, 0.4)), speed: 1, sprint: true, gkRush: true };
  }
  return { tx: clampX(tx), ty: clampY(ty), speed: 0.75 };
}

export function attachBias(p) {
  p.bias = combinedBias(p.ref);
  return p;
}
