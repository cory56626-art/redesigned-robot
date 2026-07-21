// Home screen: hero, next fixture with Play button, quick actions, and navigation cards.
import { el } from '../core/util.js';
import { state } from '../core/store.js';
import { playerFixture, currentCompetition, leagueStandings } from '../game/progression.js';
import { validateSquad, teamRating } from '../game/squad.js';

export function renderMenu(app) {
  const s = state();
  const comp = currentCompetition(s);
  const fixture = playerFixture(s);
  const valid = validateSquad(s);

  const wrap = el('div', { class: 'screen-inner' });
  wrap.append(
    el('div', { class: 'hero' }, [
      el('div', { class: 'logo', text: 'GOALVERSE' }),
      el('div', { class: 'tag', text: '3D Football Management & Simulation' }),
    ])
  );

  // Next match card
  const matchCard = el('div', { class: 'panel', style: { padding: '18px', marginTop: '10px' } });
  if (fixture) {
    matchCard.append(
      el('div', { style: { fontSize: '12px', color: 'var(--muted)', fontWeight: '800', letterSpacing: '.06em', textTransform: 'uppercase' }, text: `${comp.name} · ${fixture.roundLabel}` }),
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0' } }, [
        teamBadge(s.club.name, s.club.colors, `OVR ${teamRating(s)}`),
        el('div', { style: { fontWeight: '900', color: 'var(--muted2)' }, text: 'VS' }),
        teamBadge(fixture.opponent.name, fixture.opponent.colors, fixture.opponent.flag || `OVR ~${fixture.opponent.rating}`),
      ])
    );
    if (valid.valid) {
      matchCard.append(el('button', { class: 'btn primary block lg', onclick: () => app.playMatch({ fixture }), text: '▶  Play Match' }));
    } else {
      matchCard.append(
        el('div', { style: { color: 'var(--danger)', fontSize: '13px', fontWeight: '700', marginBottom: '10px' }, text: '⚠ ' + valid.issues[0] }),
        el('button', { class: 'btn blue block', onclick: () => app.go('squad'), text: 'Fix Your Squad' })
      );
    }
  } else if (comp && comp.done) {
    matchCard.append(
      el('div', { style: { textAlign: 'center', padding: '10px' } }, [
        el('div', { style: { fontSize: '30px' }, text: comp.won ? '🏆' : '📋' }),
        el('div', { style: { fontWeight: '900', fontSize: '17px', margin: '6px 0' }, text: comp.won ? `${comp.name} — Success!` : `${comp.name} — Ended` }),
        el('button', { class: 'btn primary block lg', onclick: () => app.go('club'), text: 'Continue Career →' }),
      ])
    );
  }
  wrap.append(matchCard);

  // Mini league table preview
  if (comp && comp.type === 'league') {
    const table = leagueStandings(comp).slice(0, 4);
    const box = el('div', { class: 'panel', style: { padding: '14px', marginTop: '12px' } }, [
      el('div', { class: 'section-title', style: { margin: '0 0 8px' }, text: comp.name + ' — Table' }),
      ...table.map((row, i) => el('div', { class: 'kv', style: { padding: '7px 0', borderBottom: i === 3 ? 'none' : undefined } }, [
        el('span', { class: 'k', style: { color: row.isPlayer ? 'var(--accent)' : undefined, fontWeight: row.isPlayer ? 800 : 400 }, text: `${i + 1}. ${row.name}` }),
        el('span', { class: 'v', text: `${row.pts} pts` }),
      ])),
    ]);
    wrap.append(box);
  }

  // Quick actions
  wrap.append(
    el('div', { class: 'section-title', text: 'Quick Actions' }),
    el('div', { style: { display: 'flex', gap: '10px' } }, [
      el('button', { class: 'btn gold grow', onclick: () => app.go('shop'), text: '📦 Open Packs' }),
      el('button', { class: 'btn grow', onclick: () => app.go('squad'), text: '👕 Squad' }),
    ])
  );

  // Navigation cards
  wrap.append(
    el('div', { class: 'section-title', text: 'Manage Club' }),
    el('div', { class: 'menu-grid', style: { maxWidth: 'none' } }, [
      navCard('⚽', 'Formation & Tactics', 'Shape, mentality & style', () => app.go('formation')),
      navCard('🗂️', 'Player Collection', 'View & train your players', () => app.go('collection')),
      navCard('📊', 'Statistics', 'Career & season records', () => app.go('stats')),
      navCard('⚙️', 'Settings', 'Audio, graphics & save', () => app.go('settings')),
    ])
  );

  return wrap;
}

function teamBadge(name, colors, sub) {
  return el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: '1', minWidth: '0' } }, [
    el('div', { class: 'kit-dot', style: { width: '34px', height: '34px', background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` } }),
    el('div', { style: { fontWeight: '800', fontSize: '13px', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }, text: name }),
    el('div', { style: { fontSize: '11px', color: 'var(--muted)' }, text: sub }),
  ]);
}

function navCard(ico, t, d, onClick) {
  return el('div', { class: 'menu-card', onclick: onClick }, [
    el('div', { class: 'ico', text: ico }),
    el('div', { class: 't', text: t }),
    el('div', { class: 'd', text: d }),
  ]);
}
