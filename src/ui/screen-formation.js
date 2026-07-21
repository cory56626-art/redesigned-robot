// Formation selector + tactics editor (mentality, style, pressing, tempo, width, line).
import { el } from '../core/util.js';
import { state } from '../core/store.js';
import { FORMATION_LIST, formation } from '../data/formations.js';
import { setFormation } from '../game/squad.js';
import { pitchLines } from './screen-squad.js';

const MENTALITIES = [['defensive', 'Defensive'], ['balanced', 'Balanced'], ['attacking', 'Attacking']];
const STYLES = [['possession', 'Possession'], ['balanced', 'Balanced'], ['counter', 'Counter'], ['direct', 'Direct']];
const SLIDERS = [
  ['pressing', 'Pressing Intensity', 'Passive', 'Aggressive'],
  ['tempo', 'Tempo', 'Slow', 'Fast'],
  ['width', 'Width', 'Narrow', 'Wide'],
  ['line', 'Defensive Line', 'Deep', 'High'],
];

export function renderFormation(app) {
  const s = state();
  const t = s.squad.tactics;
  const wrap = el('div', { class: 'screen-inner' });
  wrap.append(el('h1', { text: 'Formation & Tactics' }), el('div', { class: 'sub', text: 'Your AI team plays exactly how you set it up here.' }));

  // preview
  const preview = el('div', { class: 'pitch-view', style: { marginBottom: '16px' } });
  preview.appendChild(pitchLines());
  const f = formation(s.squad.formation);
  for (const slot of f.slots) {
    preview.appendChild(el('div', { class: 'slot', style: { left: slot.x * 100 + '%', top: (1 - slot.y) * 86 + 7 + '%' } }, [
      el('div', { class: 'dot', style: { background: `linear-gradient(135deg, ${s.club.colors[0]}, ${s.club.colors[1]})`, width: '38px', height: '38px', fontSize: '11px' }, text: slot.pos }),
    ]));
  }
  wrap.appendChild(preview);

  // formation chips
  wrap.append(el('div', { class: 'section-title', text: 'Formation' }));
  wrap.append(el('div', { class: 'chip-row' }, FORMATION_LIST.map((fm) =>
    el('button', { class: 'chip' + (fm.id === s.squad.formation ? ' active' : ''), text: fm.name, onclick: () => { setFormation(s, fm.id); app.save(); app.render(); } })
  )));

  // mentality
  wrap.append(el('div', { class: 'section-title', text: 'Mentality' }));
  wrap.append(chipGroup(MENTALITIES, t.mentality, (v) => { t.mentality = v; app.save(); app.render(); }));

  // style
  wrap.append(el('div', { class: 'section-title', text: 'Style of Play' }));
  wrap.append(chipGroup(STYLES, t.style, (v) => { t.style = v; app.save(); app.render(); }));

  // sliders
  wrap.append(el('div', { class: 'section-title', text: 'Fine Tuning' }));
  const box = el('div', { class: 'panel', style: { padding: '16px' } });
  for (const [key, label, lo, hi] of SLIDERS) box.appendChild(slider(app, t, key, label, lo, hi));
  wrap.appendChild(box);

  wrap.append(el('button', { class: 'btn primary block', style: { marginTop: '16px' }, onclick: () => app.go('squad'), text: 'Done → Squad' }));
  return wrap;
}

function chipGroup(options, current, onPick) {
  return el('div', { class: 'chip-row' }, options.map(([v, label]) =>
    el('button', { class: 'chip' + (v === current ? ' active' : ''), text: label, onclick: () => onPick(v) })
  ));
}

function slider(app, tactics, key, label, lo, hi) {
  const valEl = el('span', { style: { fontWeight: '800', fontSize: '13px', color: 'var(--accent)' }, text: tactics[key] });
  const input = el('input', {
    type: 'range', min: '0', max: '100', value: String(tactics[key]),
    style: { width: '100%', accentColor: 'var(--accent)' },
    oninput: (e) => { tactics[key] = +e.target.value; valEl.textContent = e.target.value; },
    onchange: () => app.save(),
  });
  return el('div', { style: { marginBottom: '14px' } }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } }, [
      el('span', { style: { fontSize: '13px', fontWeight: '700' }, text: label }), valEl,
    ]),
    input,
    el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted2)', marginTop: '2px' } }, [
      el('span', { text: lo }), el('span', { text: hi }),
    ]),
  ]);
}
