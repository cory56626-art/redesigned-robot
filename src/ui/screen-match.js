// Match viewer: runs the simulation, renders it in 3D, and drives the live HUD (scoreboard,
// pause / speed / camera / skip controls, event feed, live stats, goal replays) and the
// post-match rewards + progression flow.
import { el, fmtClock, fmtCoins, clamp } from '../core/util.js';
import { state, settings } from '../core/store.js';
import { RNG } from '../core/rng.js';
import { MatchEngine } from '../sim/match-engine.js?build=d9e11ec5';
import { SIM_RATE } from '../sim/const.js';
import { Scene3D } from '../render/scene3d.js';
import { Scene2D } from '../render/scene2d.js';
import { generatePlayer } from '../game/player-gen.js';
import { formation } from '../data/formations.js';
import { starterSlots, collectionMap } from '../game/squad.js';
import { addCoins, addXp, matchReward } from '../game/economy.js';
import { recordPlayerResult, currentCompetition, CAMPAIGN } from '../game/progression.js';

const SPEEDS = [0.5, 1, 2, 4];
const CAMERAS = ['broadcast', 'high', 'end'];

export function launchMatchFlow(app, { fixture }) {
  const s = state();
  const home = buildPlayerLineup(s);
  const away = buildOpponentLineup(fixture.opponent, home);
  avoidKitClash(home, away);
  const engine = new MatchEngine(home, away, { worldCup: !!fixture.opponent.flag });

  // DOM
  const canvas = el('canvas', { id: 'matchCanvas' });
  const hud = el('div', { class: 'match-hud' });
  const wrap = el('div', { class: 'match-wrap' }, [canvas, hud]);
  document.body.appendChild(wrap);

  // Renderer (3D with 2D fallback)
  let renderer;
  try { renderer = new Scene3D(canvas); }
  catch (e) { console.warn('WebGL failed, using 2D', e); renderer = new Scene2D(canvas); }

  // HUD elements
  const cfg = settings();
  let speed = cfg.defaultSpeed || 1;
  let paused = false;
  let camIdx = 0;
  let statsOpen = false;
  let skipReplays = false;
  let ended = false;
  const replay = { active: false, frames: null, t: 0, frameDur: 0.06 };

  const scHome = el('span', { class: 'sc', text: '0' });
  const scAway = el('span', { class: 'sc', text: '0' });
  const clockEl = el('span', { class: 'clock', text: '0:00' });
  const scorebar = el('div', { class: 'scorebar' }, [
    el('div', { class: 'tm' }, [kitDot(home.colors), el('span', { text: shortName(home.name) })]),
    scHome, clockEl, scAway,
    el('div', { class: 'tm' }, [el('span', { text: shortName(away.name) }), kitDot(away.colors)]),
  ]);

  const feed = el('div', { class: 'feed' });
  const statsPanel = el('div', { class: 'match-stats-panel', style: { display: 'none' } });

  const playBtn = ctrl('⏸', () => { paused = !paused; playBtn.textContent = paused ? '▶' : '⏸'; });
  const speedInd = el('div', { class: 'speed-ind', text: speed + '×' });
  const slowBtn = ctrl('«', () => { setSpeed(-1); });
  const fastBtn = ctrl('»', () => { setSpeed(1); });
  const camBtn = ctrl('🎥', () => { camIdx = (camIdx + 1) % CAMERAS.length; renderer.setMode(CAMERAS[camIdx]); });
  const statsBtn = ctrl('📊', () => { statsOpen = !statsOpen; statsPanel.style.display = statsOpen ? 'block' : 'none'; feed.style.display = statsOpen ? 'none' : 'flex'; statsBtn.classList.toggle('active', statsOpen); });
  const skipBtn = el('button', { class: 'cbtn wide', onclick: () => skipToEnd(), text: '⏭ Skip' });
  const exitBtn = el('button', { class: 'cbtn wide', onclick: () => confirmExit(), text: '✕' });

  const controls = el('div', { class: 'match-controls' }, [exitBtn, slowBtn, playBtn, fastBtn, speedInd, camBtn, statsBtn, skipBtn]);
  const banner = el('div', { style: { position: 'absolute', top: '38%', left: '0', right: '0', textAlign: 'center', zIndex: '5', pointerEvents: 'none', display: 'none' } });

  hud.append(scorebar, feed, statsPanel, banner, controls);
  renderer.setMode(CAMERAS[camIdx]);

  function setSpeed(dir) {
    let i = SPEEDS.indexOf(speed);
    i = clamp(i + dir, 0, SPEEDS.length - 1);
    speed = SPEEDS[i];
    speedInd.textContent = speed + '×';
  }

  // ---- event handling ----
  function processEvents() {
    for (const ev of engine.drainEvents()) {
      const line = commentaryLine(ev, home, away);
      if (line) pushFeed(line, ev.type === 'goal');
      if (ev.type === 'goal') onGoal(ev);
    }
  }
  function pushFeed(text, big) {
    const node = el('div', { class: 'ev' + (big ? ' big' : ''), text });
    feed.prepend(node);
    while (feed.children.length > 6) feed.lastChild.remove();
  }
  function onGoal(ev) {
    const scorer = ev.scorer ? ev.scorer.name : 'Goal';
    showBanner(`⚽ GOAL!`, scorer);
    if (!settings().reducedMotion) flash();
    scHome.textContent = engine.teams[0].score;
    scAway.textContent = engine.teams[1].score;
    if (!skipReplays && engine.replay && engine.replay.frames && engine.replay.frames.length > 4) startReplay();
    else setTimeout(hideBanner, 2200);
  }
  function showBanner(title, sub) {
    banner.innerHTML = '';
    banner.append(
      el('div', { style: { fontSize: '38px', fontWeight: '900', textShadow: '0 3px 12px #000' }, text: title }),
      el('div', { style: { fontSize: '17px', fontWeight: '800', color: 'var(--accent)', textShadow: '0 2px 8px #000' }, text: sub }),
    );
    banner.style.display = 'block';
  }
  function hideBanner() { banner.style.display = 'none'; }

  // ---- replay ----
  function startReplay() {
    replay.active = true; replay.frames = engine.replay.frames; replay.t = 0;
    renderer.setMode('end');
    const skip = el('button', { class: 'cbtn wide', style: { marginTop: '10px', pointerEvents: 'auto' }, onclick: endReplay, text: '⏭ Skip Replay' });
    banner.append(el('div', { style: { fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }, text: 'REPLAY' }), skip);
  }
  function endReplay() {
    replay.active = false; renderer.setMode(CAMERAS[camIdx]); hideBanner();
  }
  function reconstruct(frame) {
    return {
      ball: { x: frame.b.x, y: frame.b.y, z: frame.b.z, vx: 0, vy: 0, vz: 0 },
      players: frame.p.map((q, i) => ({ pos: { x: q.x, y: q.y }, vel: { x: 0, y: 0 }, facing: q.f, team: q.t, isGK: engine.players[i]?.isGK, action: q.a, _stride: 0 })),
      teams: engine.teams,
    };
  }

  // ---- loop ----
  let raf, last = performance.now();
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    if (replay.active) {
      replay.t += dt;
      const fi = Math.floor(replay.t / replay.frameDur);
      if (fi >= replay.frames.length) return endReplay();
      renderer.render(reconstruct(replay.frames[fi]), dt);
      return;
    }
    if (!paused && !engine.finished) {
      engine.step(dt * SIM_RATE * speed);
      processEvents();
    }
    renderer.render(engine.state(), dt);
    updateHud();
    if (engine.finished && !ended) { ended = true; setTimeout(() => postMatch(app, engine, fixture, cleanup), 700); }
  }

  function updateHud() {
    scHome.textContent = engine.teams[0].score;
    scAway.textContent = engine.teams[1].score;
    clockEl.textContent = fmtClock(engine.clock) + (engine.phase === 'halftime' ? ' HT' : '');
    if (statsOpen) renderStats();
  }

  function renderStats() {
    const st = engine.stats;
    const pt = st[0].possTicks + st[1].possTicks || 1;
    const rows = [
      ['Possession', Math.round(st[0].possTicks / pt * 100) + '%', Math.round(st[1].possTicks / pt * 100) + '%', st[0].possTicks / pt * 100],
      ['Shots', st[0].shots, st[1].shots, ratio(st[0].shots, st[1].shots)],
      ['On Target', st[0].onTarget, st[1].onTarget, ratio(st[0].onTarget, st[1].onTarget)],
      ['Passes', st[0].passes, st[1].passes, ratio(st[0].passes, st[1].passes)],
      ['Tackles', st[0].tackles, st[1].tackles, ratio(st[0].tackles, st[1].tackles)],
      ['Corners', st[0].corners, st[1].corners, ratio(st[0].corners, st[1].corners)],
      ['Saves', st[0].saves, st[1].saves, ratio(st[0].saves, st[1].saves)],
    ];
    statsPanel.innerHTML = '';
    statsPanel.append(el('div', { style: { fontWeight: '800', fontSize: '13px', marginBottom: '8px', textAlign: 'center' }, text: 'Match Stats' }));
    for (const [label, a, b, pct] of rows) {
      statsPanel.append(el('div', { class: 'r' }, [
        el('span', { style: { fontWeight: '800' }, text: a }),
        el('div', {}, [el('div', { class: 'mid', text: label }), el('div', { class: 'mini-track' }, [
          el('div', { style: { width: pct + '%', background: home.colors[0] } }),
          el('div', { style: { width: (100 - pct) + '%', background: away.colors[0] } }),
        ])]),
        el('span', { style: { fontWeight: '800', textAlign: 'right' }, text: b }),
      ]));
    }
  }

  function skipToEnd() {
    if (engine.finished) return;
    paused = true;
    banner.innerHTML = ''; banner.append(el('div', { style: { fontSize: '20px', fontWeight: '800' }, text: 'Simulating…' })); banner.style.display = 'block';
    // fast-forward the engine to full time (step(1.0) stays under the substep cap so each
    // call advances a full game-second; many per frame keeps the UI responsive).
    let guard = 0;
    const chunk = () => {
      for (let i = 0; i < 180 && !engine.finished; i++) engine.step(1.0);
      engine.drainEvents();
      scHome.textContent = engine.teams[0].score; scAway.textContent = engine.teams[1].score;
      clockEl.textContent = fmtClock(engine.clock);
      if (!engine.finished && guard++ < 400) requestAnimationFrame(chunk);
      else { hideBanner(); if (!ended) { ended = true; postMatch(app, engine, fixture, cleanup); } }
    };
    chunk();
  }

  function confirmExit() {
    app.confirm('Leave Match?', 'The result will not be saved and this fixture will be replayable.', () => cleanup());
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    try { renderer.dispose(); } catch {}
    wrap.remove();
    app.closeModal();
    app.go('menu');
  }

  const onResize = () => { try { renderer.resize(); } catch {} };
  window.addEventListener('resize', onResize);
  const _origCleanup = cleanup;
  cleanup = () => { window.removeEventListener('resize', onResize); _origCleanup(); };

  raf = requestAnimationFrame(frame);
}

// ---- lineups ----
function buildPlayerLineup(s) {
  const cmap = collectionMap(s);
  const slots = starterSlots(s, cmap);
  const players = slots.filter((x) => x.player).map((x) => ({ slotIndex: x.index, player: x.player }));
  return { name: s.club.name, colors: s.club.colors, formation: s.squad.formation, tactics: s.squad.tactics, players };
}

function buildOpponentLineup(opp, home) {
  const rng = new RNG((opp.name || 'AI') + '-' + Math.floor(Math.random() * 1e9));
  const fId = rng.pick(['442', '433', '4231', '352', '4231']);
  const f = formation(fId);
  const rating = opp.rating || 72;
  // World Cup nations are intentionally strong, but they must remain beatable by a
  // genuinely elite club. Previously national opponents were generated independently
  // at up to 96 OVR, which let a 98 OVR Prime Icon XI lose by absurd margins.
  const homeRating = home?.players?.length
    ? home.players.reduce((sum, entry) => sum + Number(entry.player?.ovr || 0), 0) / home.players.length
    : 68;
  const isNationalOpponent = !!opp.flag;
  // World Cup nations should be credible opponents without creating an impossible
  // rating cliff. Elite clubs should have only a small advantage, while developing clubs
  // still face a genuinely strong national side.
  const balancedRating = isNationalOpponent
    ? clamp(
        homeRating >= 90
          ? homeRating - 8
          : Math.max(rating, homeRating + 4),
                82,
        92,
      )
    : rating;
  const tier = clamp(Math.round((balancedRating - 55) / 8), 0, 5);
  const posAdj = { GK: 0, ST: 2, W: 1, CB: -1 };
  const players = f.slots.map((slot, i) => ({
    slotIndex: i,
    player: generatePlayer({
      rng, tier, isGK: slot.pos === 'GK', positionHint: slot.pos,
      targetOvr: clamp(Math.round(balancedRating + (posAdj[slot.group] || 0) + rng.gaussian(0, 1.5)), 40, 96),
    }),
  }));
  const styles = ['possession', 'balanced', 'counter', 'direct'];
  const mentalities = isNationalOpponent ? ['defensive', 'balanced'] : ['defensive', 'balanced', 'attacking'];
  return {
    name: opp.name, colors: opp.colors || ['#c0392b', '#ffffff'], formation: fId,
    tactics: { mentality: rng.pick(mentalities), style: rng.pick(styles), pressing: rng.int(40, 75), tempo: rng.int(40, 75), width: rng.int(40, 70), line: rng.int(40, 70) },
    players,
  };
}

// If the two kits are too similar, give the away side a contrasting change strip.
const ALT_KITS = [['#e03b3b', '#ffffff'], ['#ffffff', '#1a1f2e'], ['#f5c542', '#1a1f2e'], ['#7b3fe4', '#ffffff'], ['#e84393', '#1a1f2e'], ['#1a1f2e', '#e0e6f0']];
function colorDist(a, b) {
  const p = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}
function avoidKitClash(home, away) {
  if (colorDist(home.colors[0], away.colors[0]) > 120) return;
  let best = ALT_KITS[0], bestD = -1;
  for (const k of ALT_KITS) { const d = colorDist(home.colors[0], k[0]); if (d > bestD) { bestD = d; best = k; } }
  away.colors = best;
}

// ---- post match ----
function postMatch(app, engine, fixture, cleanup) {
  const s = state();
  const comp = currentCompetition(s);
  const pg = engine.teams[0].score, og = engine.teams[1].score;
  const won = pg > og, drew = pg === og;

  // stats
  s.stats.matches++; s.stats.goalsFor += pg; s.stats.goalsAgainst += og;
  if (won) s.stats.wins++; else if (drew) s.stats.draws++; else s.stats.losses++;
  if (og === 0) s.stats.cleanSheets = (s.stats.cleanSheets || 0) + 1;
  if (won && (pg - og) >= bestMargin(s.stats.bestWin)) s.stats.bestWin = `${pg}-${og} vs ${shortName(fixture.opponent.name)}`;

  // rewards
  const reward = matchReward(s, { won, drew, goalsFor: pg, goalsAgainst: og, oppRating: fixture.opponent.rating || 72, tier: comp?.tier || 1, knockout: comp && comp.type !== 'league' });
  addCoins(s, reward.coins);
  const leveled = addXp(s, reward.xp);

  // progression
  recordPlayerResult(s, pg, og, fixture.opponent.rating || 72);
  // trophies
  if (comp && comp.done && comp.won && comp.type !== 'league' && !(s.club.trophies || []).includes(comp.name)) {
    (s.club.trophies = s.club.trophies || []).push(comp.name);
  }
  app.save(); app.refreshChrome();

  // man of the match (best on player's team)
  const motm = [...engine.teams[0].players].sort((a, b) => matchRating(b) - matchRating(a))[0];

  const content = el('div', {});
  content.append(
    el('div', { style: { textAlign: 'center' } }, [
      el('div', { style: { fontSize: '13px', color: 'var(--muted)', fontWeight: '800', letterSpacing: '.06em', textTransform: 'uppercase' }, text: comp ? comp.name : 'Friendly' }),
      el('div', { style: { fontSize: '40px', fontWeight: '900', margin: '8px 0' }, text: `${pg} — ${og}` }),
      el('div', { style: { fontSize: '18px', fontWeight: '800', color: won ? 'var(--accent)' : drew ? 'var(--gold)' : 'var(--danger)' }, text: won ? 'Victory!' : drew ? 'Draw' : 'Defeat' }),
    ]),
    el('div', { class: 'panel', style: { padding: '12px 16px', margin: '16px 0' } }, [
      kv('Coins Earned', '🪙 ' + fmtCoins(reward.coins)),
      kv('XP Gained', '+' + reward.xp + (leveled ? `  (Level Up! →${s.club.level})` : '')),
      kv('Player of the Match', motm ? `${motm.name} (${matchRating(motm).toFixed(1)})` : '—'),
    ]),
  );

  if (comp && comp.done) {
    content.append(el('div', { style: { textAlign: 'center', padding: '6px 0 14px', fontWeight: '800', color: comp.won ? 'var(--accent)' : 'var(--muted)' },
      text: comp.won ? (comp.type === 'worldcup' ? '🌍 World Cup Winners!' : comp.type === 'cup' ? `🏆 ${comp.name} Champions!` : '⬆ Promotion secured!') : `${comp.name} campaign over.` }));
  }
  content.append(el('button', { class: 'btn primary block lg', onclick: () => { app.closeModal(); cleanup(); }, text: 'Continue' }));
  app.modal(content, { dismissable: false });
}

// ---- helpers ----
function matchRating(p) {
  const st = p.stats;
  let r = 6.0 + st.goals * 1.3 + st.assists * 0.8 + st.onTarget * 0.12 + st.passesOk * 0.006 + st.tackles * 0.06 + st.interceptions * 0.05;
  return clamp(r, 4.5, 10);
}
function bestMargin(bestWin) {
  if (!bestWin) return 1;
  const m = bestWin.match(/^(\d+)-(\d+)/);
  return m ? (+m[1] - +m[2]) : 1;
}
function ratio(a, b) { const t = a + b; return t ? Math.round((a / t) * 100) : 50; }
function kitDot(colors) { return el('span', { class: 'kit-dot', style: { background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` } }); }
function ctrl(txt, onClick) { return el('button', { class: 'cbtn', onclick: onClick, text: txt }); }
function shortName(n) { return n.length > 14 ? n.slice(0, 12) + '…' : n; }
function kv(k, v) { return el('div', { class: 'kv' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]); }

function commentaryLine(ev, home, away) {
  const tn = (t) => shortName(t === 0 ? home.name : away.name);
  const by = ev.by ? ev.by.name : '';
  switch (ev.type) {
    case 'goal': return `⚽ GOAL! ${ev.scorer ? ev.scorer.name : ''} scores${ev.assist ? ' (assist ' + ev.assist.name + ')' : ''}`;
    case 'shot': return ev.onTarget ? `🎯 ${by} shoots — on target!` : `${by} fires just wide`;
    case 'save': return `🧤 Great save!`;
    case 'block': return `🛡 Shot blocked`;
    case 'corner': return `🚩 Corner to ${tn(ev.team)}`;
    case 'foul': return `Foul by ${by}`;
    case 'penalty': return `⚠ PENALTY to ${tn(ev.team)}!`;
    case 'offside': return `🚩 Offside`;
    case 'halftime': return `⏸ Half Time: ${ev.score[0]}-${ev.score[1]}`;
    case 'fulltime': return `🏁 Full Time: ${ev.score[0]}-${ev.score[1]}`;
    case 'kickoff': return ev.half === 2 ? 'Second half underway' : null;
    default: return null;
  }
}

function flash() { const f = el('div', { class: 'flash' }); document.body.appendChild(f); setTimeout(() => f.remove(), 500); }
