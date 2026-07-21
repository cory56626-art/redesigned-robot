// Settings: audio, graphics, motion, and save management.
import { el } from '../core/util.js';
import { state, settings, saveSettings, deleteSave, save as persist } from '../core/store.js';

export function renderSettings(app) {
  const cfg = settings();
  const wrap = el('div', { class: 'screen-inner' });
  wrap.append(el('h1', { text: 'Settings' }), el('div', { class: 'sub', text: 'Preferences are saved on this device.' }));

  const box = el('div', { class: 'panel', style: { padding: '6px 16px' } });
  box.append(
    toggle('Sound Effects', cfg.sound, (v) => saveSettings({ sound: v })),
    toggle('Crowd & Music', cfg.music, (v) => saveSettings({ music: v })),
    toggle('Particle Effects', cfg.showParticles, (v) => saveSettings({ showParticles: v })),
    toggle('Reduced Motion', cfg.reducedMotion, (v) => saveSettings({ reducedMotion: v })),
    selectRow('Graphics Quality', ['low', 'medium', 'high'], cfg.graphics, (v) => saveSettings({ graphics: v })),
    selectRow('Default Match Speed', ['0.5', '1', '2', '4'], String(cfg.defaultSpeed), (v) => saveSettings({ defaultSpeed: parseFloat(v) })),
  );
  wrap.append(box);

  wrap.append(el('div', { class: 'section-title', text: 'Save Data' }));
  wrap.append(el('div', { class: 'panel', style: { padding: '16px' } }, [
    el('div', { style: { fontSize: '13px', color: 'var(--muted)', marginBottom: '12px' }, text: 'Your career is saved automatically in this browser.' }),
    el('button', { class: 'btn block', onclick: () => { persist(true); app.toast('Progress saved', 'good'); }, text: '💾 Save Now' }),
    el('button', {
      class: 'btn danger block', style: { marginTop: '10px' },
      onclick: () => app.confirm('Reset Career', 'This deletes your club, players and progress permanently. Are you sure?', () => {
        deleteSave(); location.reload();
      }, 'Delete Everything'),
      text: '🗑 Reset Career',
    }),
  ]));

  wrap.append(el('div', { class: 'center-note', text: 'GOALVERSE · 3D Football Management · Built for the browser' }));
  return wrap;
}

function toggle(label, value, onChange) {
  const knob = el('div', { style: { width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'transform .18s', transform: value ? 'translateX(20px)' : 'translateX(0)' } });
  const track = el('button', {
    style: { width: '46px', height: '26px', borderRadius: '999px', padding: '3px', background: value ? 'var(--accent)' : 'var(--panel3)', transition: 'background .18s' },
    onclick: (e) => { value = !value; knob.style.transform = value ? 'translateX(20px)' : 'translateX(0)'; e.currentTarget.style.background = value ? 'var(--accent)' : 'var(--panel3)'; onChange(value); },
  }, [knob]);
  return el('div', { class: 'kv' }, [el('span', { class: 'k', style: { color: 'var(--txt)' }, text: label }), track]);
}

function selectRow(label, options, current, onChange) {
  const sel = el('select', {
    style: { background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: '8px', padding: '8px 12px', fontWeight: '700' },
    onchange: (e) => onChange(e.target.value),
  }, options.map((o) => { const opt = el('option', { value: o, text: o.charAt(0).toUpperCase() + o.slice(1) }); if (o === current) opt.selected = true; return opt; }));
  return el('div', { class: 'kv' }, [el('span', { class: 'k', style: { color: 'var(--txt)' }, text: label }), sel]);
}
