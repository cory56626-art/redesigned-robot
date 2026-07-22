// Boot: load settings + save, run the new-career flow if needed, then mount the app.
import { el } from './core/util.js';
import { loadSettings, hasSave, loadSave, setState, save as persist } from './core/store.js';
import { createNewCareer } from './game/newgame-wc.js';
import { app } from './ui/app-wc5.js';
import { runPackOpening } from './ui/pack-open.js';

function boot() {
  loadSettings();
  const root = document.getElementById('app');
  const existing = hasSave() ? loadSave() : null;
  if (existing) {
    setState(existing);
    app.mount(root);
  } else {
    showNewGame(root);
  }
}

function showNewGame(root) {
  root.innerHTML = '';
  const nameInput = el('input', {
    type: 'text', value: 'Your Club FC', maxlength: '22',
    style: {
      width: '100%', padding: '14px 16px', fontSize: '16px', fontWeight: '800', textAlign: 'center',
      background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: '12px',
    },
  });
  nameInput.addEventListener('focus', () => nameInput.select());

  const start = () => {
    const name = (nameInput.value || '').trim() || 'Your Club FC';
    const s = createNewCareer(name);
    setState(s);
    persist(true);
    app.mount(root);
    // Welcome starter pack after a beat.
    setTimeout(() => runPackOpening(app, 'gold'), 500);
  };

  const screen = el('div', { class: 'screen' }, [
    el('div', { class: 'screen-inner', style: { maxWidth: '440px', paddingTop: '8vh' } }, [
      el('div', { class: 'hero' }, [
        el('div', { class: 'logo', text: 'GOALVERSE' }),
        el('div', { class: 'tag', text: 'Build a club. Collect superstars. Win the World Cup.' }),
      ]),
      el('div', { class: 'panel', style: { padding: '20px', marginTop: '24px' } }, [
        el('div', { class: 'section-title', style: { margin: '0 0 10px' }, text: 'Name Your Club' }),
        nameInput,
        el('button', { class: 'btn primary block lg', style: { marginTop: '16px' }, onclick: start, text: '⚽ Start Career' }),
      ]),
      el('div', { style: { marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, [
        feature('📦', 'Open packs'), feature('🧠', 'Watch AI matches'),
        feature('👕', 'Build your squad'), feature('🏆', 'Climb to the World Cup'),
      ]),
    ]),
  ]);
  root.append(screen);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
}

function feature(ico, text) {
  return el('div', { class: 'tile', style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px' } }, [
    el('span', { style: { fontSize: '20px' }, text: ico }),
    el('span', { style: { fontSize: '13px', fontWeight: '700' }, text }),
  ]);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
