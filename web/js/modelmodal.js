// Model switcher: search + models grouped by provider, live switching at runtime.
import { store } from './store.js';
import { el, clear, esc } from './util.js';
import { selectModel } from './actions.js';

export function openModelModal() {
  const overlay = document.getElementById('overlay');
  clear(overlay); overlay.classList.add('open');
  const modal = el('div', { class: 'modal' });
  const search = el('input', { placeholder: 'Search 500+ models across providers…', autofocus: true });
  modal.append(el('div', { class: 'm-head' },
    el('span', { style: { fontSize: '15px' } }, '⌘'), search,
    el('button', { class: 'icon-btn', onclick: close, html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 6 6 18M6 6l12 12"/></svg>' })));
  const body = el('div', { class: 'm-body' });
  modal.append(body);
  overlay.append(modal);

  const providers = store.config?.models?.providers || [];
  let flatRows = [];
  let hiIdx = 0;

  function draw(filter = '') {
    clear(body); flatRows = [];
    const f = filter.toLowerCase();
    for (const p of providers) {
      const models = p.models.filter((m) => !f || m.name.toLowerCase().includes(f) || m.id.toLowerCase().includes(f) || p.label.toLowerCase().includes(f));
      if (!models.length) continue;
      const group = el('div', { class: 'prov-group' });
      group.append(el('div', { class: 'ph' },
        el('span', { class: 'dot', style: { background: p.accent } }),
        el('span', {}, p.label),
        el('span', { class: 'ct' }, models.length + ' models')));
      for (const m of models) {
        const selected = m.id === store.model && m.provider === store.provider;
        const row = el('div', { class: 'model-row' + (selected ? ' sel' : ''), onclick: () => choose(p.id, m.id) },
          el('div', { style: { minWidth: '0' } }, el('div', { class: 'nm' }, m.name), el('div', { class: 'id' }, m.id)),
          el('div', { class: 'meta' },
            m.context ? el('span', { class: 'badge-ctx' }, ctx(m.context)) : null,
            m.vision ? el('span', { class: 'tag' }, 'vision') : null,
            selected ? el('span', { style: { color: 'var(--accent)' } }, '✓') : null));
        group.append(row);
        flatRows.push({ el: row, provider: p.id, model: m.id });
      }
      body.append(group);
    }
    if (!flatRows.length) body.append(el('div', { class: 'empty' }, 'No models match "' + esc(filter) + '"'));
    hiIdx = Math.max(0, flatRows.findIndex((r) => r.provider === store.provider && r.model === store.model));
    highlight();
  }
  function highlight() { flatRows.forEach((r, i) => r.el.classList.toggle('hi', i === hiIdx)); flatRows[hiIdx]?.el.scrollIntoView({ block: 'nearest' }); }
  function choose(provider, model) { selectModel(provider, model); close(); }
  function close() { overlay.classList.remove('open'); clear(overlay); document.removeEventListener('keydown', onKey); }
  function onKey(e) {
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown') { e.preventDefault(); hiIdx = Math.min(flatRows.length - 1, hiIdx + 1); highlight(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); hiIdx = Math.max(0, hiIdx - 1); highlight(); }
    if (e.key === 'Enter') { e.preventDefault(); const r = flatRows[hiIdx]; if (r) choose(r.provider, r.model); }
  }
  search.addEventListener('input', () => draw(search.value));
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  draw('');
  setTimeout(() => search.focus(), 30);
}

function ctx(n) { return n >= 1000 ? Math.round(n / 1000) + 'K' : String(n); }
