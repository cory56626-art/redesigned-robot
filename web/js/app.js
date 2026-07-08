// Bootstrap: auth gate, config load, layout wiring, activity rail, status bar,
// project switcher, keyboard shortcuts and pane resizers.
import { store, setState, subscribe } from './store.js';
import { api, setToken, getToken } from './api.js';
import { el, clear, icon, toast, fmtMs } from './util.js';
import { loadProjectData, refreshTasks } from './actions.js';
import { mountEditor } from './editor.js';
import { mountSidebar } from './sidebar.js';
import { mountDock } from './dock.js';
import { mountChat, sendMessage } from './chat.js';
import { openModelModal } from './modelmodal.js';
import { openView } from './actions.js';

const RAIL = [
  { id: 'chat', icon: 'chat', title: 'Chat' },
  { id: 'files', icon: 'files', title: 'Explorer' },
  { id: 'search', icon: 'search', title: 'Search' },
  { id: 'sandbox', icon: 'sandbox', title: 'Sandbox' },
  { id: 'agents', icon: 'agents', title: 'Agents' },
  { id: 'tasks', icon: 'tasks', title: 'Tasks' },
  { id: 'terminal', icon: 'terminal', title: 'Terminal' },
  { id: 'browser', icon: 'browser', title: 'Browser' },
  { id: 'memory', icon: 'memory', title: 'Memory' },
  { id: 'logs', icon: 'logs', title: 'Logs' },
  { id: 'settings', icon: 'settings', title: 'Settings' },
];

boot();

async function boot() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  // Auth
  let user = null;
  if (getToken()) { try { user = (await api.me()).user; } catch { setToken(null); } }
  if (user) { store.user = user; startApp(); }
  else setupAuth();
}

/* ---- auth ---------------------------------------------------------------- */
function setupAuth() {
  const authEl = document.getElementById('auth');
  const form = document.getElementById('auth-form');
  const nameField = document.getElementById('name-field');
  const errEl = document.getElementById('auth-err');
  const swap = document.getElementById('auth-swap');
  const submit = document.getElementById('auth-submit');
  let mode = 'signin';
  document.getElementById('auth-toggle').addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    nameField.style.display = mode === 'signup' ? 'block' : 'none';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    swap.innerHTML = mode === 'signup' ? 'Already have an account? ' : 'New here? ';
    const a = document.createElement('a'); a.id = 'auth-toggle'; a.textContent = mode === 'signup' ? 'Sign in' : 'Create an account';
    swap.append(a); a.addEventListener('click', () => document.getElementById('auth-toggle').click());
    document.getElementById('auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); errEl.textContent = '';
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value.trim();
    try {
      const res = mode === 'signup' ? await api.signup({ email, password, name }) : await api.signin({ email, password });
      setToken(res.token); store.user = res.user;
      authEl.classList.add('hidden'); startApp();
    } catch (err) { errEl.textContent = err.message; }
  });
  document.getElementById('auth-skip').addEventListener('click', () => { authEl.classList.add('hidden'); store.user = null; startApp(); });
}

/* ---- app start ----------------------------------------------------------- */
async function startApp() {
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('app').classList.add('ready');

  let cfg;
  try { cfg = await api.config(); }
  catch (e) { toast('Failed to load config: ' + e.message, 'err'); return; }
  store.config = cfg;
  store.projects = cfg.projects;

  // defaults — the model MUST belong to the selected provider, or we'd send e.g.
  // a Groq model id to Gemini. Resolve provider first, then a model within it.
  if (!store.projectId || !cfg.projects.find((p) => p.id === store.projectId)) store.projectId = cfg.projects[0]?.id;
  let prov = cfg.models.providers.find((p) => p.id === store.provider);
  if (!prov) { prov = cfg.models.providers.find((p) => p.id === cfg.models.defaultProvider) || cfg.models.providers[0]; store.provider = prov?.id; }
  if (prov && (!store.model || !prov.models.some((m) => m.id === store.model))) store.model = prov.defaultModel;
  if (store.user?.prefs?.settings) store.settings = { ...store.settings, ...store.user.prefs.settings };

  // apply saved theme from settings general
  if (store.settings.general.theme && store.theme === 'system') store.theme = store.settings.general.theme;
  applyTheme();

  buildRail();
  wireTopbar();
  wireShortcuts();
  wireResizers();
  applyLayout();

  mountEditor();
  mountSidebar();
  mountDock();
  mountChat();

  subscribe((evt) => {
    if (['model', 'controls', 'config', 'project-data', 'tasks', 'messages', 'theme', 'view'].includes(evt)) renderStatus();
    if (evt === 'theme') applyTheme();
    if (evt === 'view') { buildRail(); applyLayout(); }
    if (['controls', 'sidebar', 'dock'].includes(evt)) applyLayout();
  });

  await loadProjectData();
  setState({ view: store.view || 'files', sidebarMode: 'files' }, 'view');
  renderStatus();
  setInterval(refreshTasks, 4000);
  toast('Connected · ' + cfg.models.total + ' models across ' + cfg.models.providers.length + ' providers', 'ok');
}

/* ---- rail + views -------------------------------------------------------- */
function buildRail() {
  const rail = document.getElementById('rail');
  clear(rail);
  for (const item of RAIL) {
    if (item.id === 'spacer') { rail.append(el('div', { class: 'spacer' })); continue; }
    const active = store.view === item.id;
    const btn = el('button', { class: 'rb' + (active ? ' active' : ''), title: item.title, html: icon(item.icon), onclick: () => selectView(item.id) });
    if (item.id === 'tasks') { const running = (store.tasks || []).filter((t) => t.status === 'running').length; if (running) btn.append(el('span', { class: 'badge' }, String(running))); }
    rail.append(btn);
  }
  rail.append(el('div', { class: 'spacer' }));
}

function selectView(id) {
  if (id === 'chat') { setState({ chatVisible: !store.chatVisible }, 'view'); return; }
  if (id === 'files') { setState({ view: 'files', sidebarMode: 'files', sidebarVisible: true }, 'view'); setState({}, 'sidebar'); return; }
  if (id === 'search') { setState({ view: 'search', sidebarMode: 'search', sidebarVisible: true }, 'view'); setState({}, 'sidebar'); return; }
  if (id === 'terminal') { setState({ view: 'terminal', dockTab: 'terminal', dockOpen: true }, 'view'); setState({ dockTab: 'terminal', dockOpen: true }, 'dock'); return; }
  if (id === 'logs') { setState({ view: 'logs', dockTab: 'logs', dockOpen: true }, 'view'); setState({ dockTab: 'logs', dockOpen: true }, 'dock'); return; }
  // center views
  setState({ view: id }, 'view'); openView(id);
}

/* ---- layout -------------------------------------------------------------- */
function applyLayout() {
  document.documentElement.style.setProperty('--side-w', store.sideWidth + 'px');
  document.documentElement.style.setProperty('--chat-w', store.chatWidth + 'px');
  const sidebar = document.getElementById('sidebar');
  const chatcol = document.getElementById('chatcol');
  sidebar.classList.toggle('hidden', store.sidebarVisible === false);
  document.getElementById('resize-side').style.display = store.sidebarVisible === false ? 'none' : '';
  chatcol.classList.toggle('hidden', store.chatVisible === false);
  document.getElementById('resize-chat').style.display = store.chatVisible === false ? 'none' : '';
}

/* ---- topbar / account ---------------------------------------------------- */
function wireTopbar() {
  document.getElementById('btn-theme').addEventListener('click', () => {
    const order = ['system', 'dark', 'light'];
    const next = order[(order.indexOf(store.theme) + 1) % 3];
    store.settings.general.theme = next;
    setState({ theme: next }, 'theme');
    toast('Theme: ' + next, '');
  });
  document.getElementById('account-label').textContent = store.user ? store.user.name : 'Guest';
  document.getElementById('btn-account').addEventListener('click', accountMenu);
  document.getElementById('project-switch').addEventListener('click', projectMenu);
  document.getElementById('btn-new-chat').addEventListener('click', () => { setState({ messages: [] }, 'messages'); });
  updateProjectName();
}
function updateProjectName() {
  const p = store.projects.find((x) => x.id === store.projectId);
  document.getElementById('project-name').textContent = p ? p.name : 'Project';
}

function accountMenu(e) {
  popup(e.currentTarget, (menu, close) => {
    menu.append(menuItem(store.user ? store.user.email : 'Guest session', null, true));
    if (store.user) menu.append(menuItem('Sign out', async () => { try { await api.signout(); } catch {} setToken(null); location.reload(); }));
    else menu.append(menuItem('Sign in / Create account', () => location.reload()));
    menu.append(menuItem('Open Settings', () => { selectView('settings'); }));
  });
}
function projectMenu(e) {
  popup(document.getElementById('project-switch'), (menu, close) => {
    for (const p of store.projects) menu.append(menuItem((p.id === store.projectId ? '● ' : '   ') + p.name, () => switchProject(p.id)));
    menu.append(el('div', { style: { height: '1px', background: 'var(--border)', margin: '4px 0' } }));
    menu.append(menuItem('✚ New project', async () => {
      const name = prompt('Project name:', store.settings.general.defaultProjectName || 'New Project'); if (!name) return;
      const proj = await api.createProject(name); store.projects.push(proj); switchProject(proj.id);
    }));
    if (store.projects.length > 1) menu.append(menuItem('🗑 Delete current', async () => {
      if (!confirm('Delete project ' + (store.projects.find(p => p.id === store.projectId)?.name) + '?')) return;
      await api.deleteProject(store.projectId); store.projects = store.projects.filter((p) => p.id !== store.projectId); switchProject(store.projects[0].id);
    }));
  });
}
async function switchProject(id) {
  setState({ projectId: id, tabs: [], activePath: null, splitPath: null, messages: [], terminal: [] }, 'editor');
  updateProjectName();
  const { history } = await api.memory(id).then((m) => ({ history: m.history })).catch(() => ({ history: [] }));
  store.messages = history.map((h) => ({ role: h.role, content: h.content, meta: { model: h.model } }));
  setState({ messages: store.messages }, 'messages');
  await loadProjectData();
  toast('Switched project', '');
}

/* ---- status bar ---------------------------------------------------------- */
function renderStatus() {
  const sb = document.getElementById('statusbar');
  const streaming = store.streaming;
  sb.classList.toggle('idle', !streaming);
  const modelName = (() => { for (const p of (store.config?.models?.providers || [])) { const m = p.models.find((x) => x.id === store.model); if (m) return m.name; } return store.model || 'no model'; })();
  const eff = (store.config?.efforts || []).find((e) => e.id === store.effort);
  const running = (store.tasks || []).find((t) => t.status === 'running');
  set('sb-model', '◈ ' + modelName);
  set('sb-effort', (eff ? eff.glyph + ' ' + eff.label : '') + ' effort');
  set('sb-subagents', store.subagentsOn ? `⛓ ${store.subagentCount} subagents` : '⛓ solo');
  set('sb-sandbox', '⛁ ' + (store.projects.find((p) => p.id === store.projectId)?.name || 'sandbox'));
  set('sb-task', running ? `⟳ ${running.stage} ${running.progress || 0}%` : '');
  set('sb-providers', (store.config?.models?.providers.length || 0) + ' providers');
  updateProjectName();
  buildRail();
}
function set(id, text) { const e = document.getElementById(id); if (e) e.textContent = text; }

/* ---- popups -------------------------------------------------------------- */
function popup(anchor, build) {
  document.querySelector('.app-popup')?.remove();
  const r = anchor.getBoundingClientRect();
  const menu = el('div', { class: 'app-popup', style: { position: 'fixed', top: (r.bottom + 6) + 'px', left: Math.min(r.left, window.innerWidth - 240) + 'px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: '10px', boxShadow: 'var(--shadow)', padding: '5px', zIndex: '80', minWidth: '210px' } });
  const close = () => { menu.remove(); document.removeEventListener('click', onDoc); };
  build(menu, close);
  document.body.append(menu);
  const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener('click', onDoc), 0);
}
function menuItem(label, onclick, disabled) {
  return el('div', { style: { padding: '8px 12px', borderRadius: '7px', fontSize: '12.5px', cursor: disabled ? 'default' : 'pointer', color: disabled ? 'var(--muted)' : 'var(--text)' },
    onmouseenter: (e) => { if (!disabled) e.target.style.background = 'var(--panel-2)'; }, onmouseleave: (e) => e.target.style.background = '',
    onclick: () => { if (!disabled && onclick) { onclick(); document.querySelector('.app-popup')?.remove(); } } }, label);
}

/* ---- theme --------------------------------------------------------------- */
function applyTheme() {
  const t = store.theme || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ---- shortcuts + resizers ------------------------------------------------ */
function wireShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openModelModal(); }
    else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setState({ sidebarVisible: store.sidebarVisible === false }, 'sidebar'); applyLayout(); }
    else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); setState({ dockOpen: !store.dockOpen }, 'dock'); }
    else if (mod && e.key === '\\') { e.preventDefault(); setState({ chatVisible: store.chatVisible === false }, 'view'); }
  });
}
function wireResizers() {
  makeResizer('resize-side', (dx) => { store.sideWidth = Math.max(180, Math.min(460, store.sideWidth + dx)); setState({ sideWidth: store.sideWidth }, 'controls'); }, 1);
  makeResizer('resize-chat', (dx) => { store.chatWidth = Math.max(300, Math.min(640, store.chatWidth - dx)); setState({ chatWidth: store.chatWidth }, 'controls'); }, 1);
}
function makeResizer(id, apply) {
  const handle = document.getElementById(id);
  if (!handle) return;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault(); let last = e.clientX;
    const move = (ev) => { const dx = ev.clientX - last; last = ev.clientX; apply(dx); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
}
