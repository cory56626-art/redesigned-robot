// Bottom dock: integrated terminal (wired to the sandbox), live logs, and change feed.
import { store, setState, subscribe } from './store.js';
import { api } from './api.js';
import { el, clear, esc, icon, fmtTime, timeAgo } from './util.js';
import { runTerminal, termPush } from './actions.js';

let history = [];
let histIdx = -1;

export function mountDock() {
  const tabs = document.getElementById('dock-tabs');
  const body = document.getElementById('dock-body');
  const dock = document.getElementById('dock');
  tabs.querySelectorAll('.dock-tab').forEach((b) => b.addEventListener('click', () => setState({ dockTab: b.dataset.dock, dockOpen: true }, 'dock')));

  const actions = document.getElementById('dock-actions');
  clear(actions);
  actions.append(
    el('button', { class: 'icon-btn', title: 'Clear', onclick: clearCurrent, html: icon('trash') }),
    el('button', { class: 'icon-btn', title: 'Toggle panel', onclick: () => setState({ dockOpen: !store.dockOpen }, 'dock'), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m6 9 6 6 6-6"/></svg>' }));

  subscribe((evt) => { if (['terminal', 'dock', 'logs', 'changes', 'project-data'].includes(evt)) render(); });
  render();
  pollLogs();

  function render() {
    dock.classList.toggle('collapsed', !store.dockOpen);
    tabs.querySelectorAll('.dock-tab').forEach((b) => b.classList.toggle('active', b.dataset.dock === (store.dockTab || 'terminal')));
    if (!store.dockOpen) { clear(body); return; }
    clear(body);
    const tab = store.dockTab || 'terminal';
    if (tab === 'terminal') renderTerminal(body);
    else if (tab === 'logs') renderLogs(body);
    else renderChanges(body);
  }
}

function clearCurrent() {
  const tab = store.dockTab || 'terminal';
  if (tab === 'terminal') setState({ terminal: [] }, 'terminal');
  else if (tab === 'logs') setState({ logs: [] }, 'logs');
}

function renderTerminal(body) {
  const term = el('div', { class: 'term' });
  const entries = store.terminal || [];
  if (!entries.length) term.append(el('div', { class: 'meta' }, 'Sandbox shell. Try: ls, cat file, node script.js, python3 -c "print(1+1)". Commands run inside the isolated sandbox.'));
  for (const e of entries) {
    if (e.type === 'cmd') term.append(el('div', { class: 'cmd' }, e.text));
    else if (e.type === 'out') term.append(el('div', { class: 'out' }, e.text));
    else if (e.type === 'er') term.append(el('div', { class: 'er' }, e.text));
    else term.append(el('div', { class: 'meta' }, e.text));
  }
  body.append(term);

  const row = el('div', { class: 'term-input-row' });
  const input = el('input', { placeholder: 'run a command…', autocomplete: 'off', spellcheck: 'false' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim(); if (!cmd) return;
      if (cmd === 'clear') { setState({ terminal: [] }, 'terminal'); input.value = ''; return; }
      history.unshift(cmd); histIdx = -1; input.value = '';
      runTerminal(cmd);
    } else if (e.key === 'ArrowUp') { e.preventDefault(); if (histIdx < history.length - 1) input.value = history[++histIdx] || ''; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (histIdx > 0) input.value = history[--histIdx] || ''; else { histIdx = -1; input.value = ''; } }
  });
  row.append(el('span', { class: 'p' }, '❯'), input);
  body.append(row);
  body.scrollTop = body.scrollHeight;
  setTimeout(() => { input.focus(); body.scrollTop = body.scrollHeight; }, 0);
}

function renderLogs(body) {
  const logs = store.logs || [];
  const wrap = el('div', {});
  if (!logs.length) wrap.append(el('div', { class: 'empty', style: { padding: '20px' } }, 'No logs yet.'));
  for (const l of logs.slice(-300)) {
    wrap.append(el('div', { class: 'log-row' },
      el('span', { style: { color: 'var(--faint)' } }, fmtTime(l.ts)),
      el('span', { class: 'lvl lvl-' + l.level }, l.level),
      el('span', { class: 'scope' }, l.scope),
      el('span', {}, l.message + (l.meta && Object.keys(l.meta).length ? '  ' + esc(JSON.stringify(l.meta)) : ''))));
  }
  body.append(wrap);
  body.scrollTop = body.scrollHeight;
}

function renderChanges(body) {
  const changes = store.changes || [];
  const wrap = el('div', {});
  if (!changes.length) wrap.append(el('div', { class: 'empty', style: { padding: '20px' } }, 'No file changes tracked yet.'));
  for (const c of changes.slice(0, 200)) {
    wrap.append(el('div', { class: 'log-row', style: { gridTemplateColumns: '70px 60px 1fr' } },
      el('span', { style: { color: 'var(--faint)' } }, timeAgo(c.ts)),
      el('span', { class: 'lvl', style: { color: opColor(c.op) } }, c.op),
      el('span', { class: 'mono' }, c.target + (c.from ? ' ← ' + c.from : ''))));
  }
  body.append(wrap);
}
function opColor(op) { return ({ create: 'var(--ok)', edit: 'var(--info)', delete: 'var(--err)', move: 'var(--warn)', mkdir: 'var(--accent-2)' })[op] || 'var(--muted)'; }

async function pollLogs() {
  const tick = async () => {
    try {
      const { logs } = await api.logs(store.logCursor || 0);
      if (logs.length) {
        const merged = [...(store.logs || []), ...logs].slice(-500);
        setState({ logs: merged, logCursor: logs[logs.length - 1].id }, 'logs');
      }
    } catch { /* ignore */ }
    setTimeout(tick, 2500);
  };
  tick();
}
