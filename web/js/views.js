// Center "editor" views that aren't files: Agent Activity, Tasks, Settings,
// Browser, Sandbox overview and Memory.
import { store, setState, saveSettings } from './store.js';
import { api } from './api.js';
import { el, clear, esc, icon, fmtMs, fmtBytes, timeAgo, fmtTime, toast } from './util.js';
import { refreshTasks, openFile } from './actions.js';

export function renderView(kind, tab) {
  switch (kind) {
    case 'agents': return agentsView();
    case 'tasks': return tasksView();
    case 'settings': return settingsView();
    case 'browser': return browserView();
    case 'sandbox': return sandboxView();
    case 'memory': return memoryView();
    default: return el('div', { class: 'empty' }, 'Unknown view');
  }
}

/* ---- Agent Activity ------------------------------------------------------ */
function agentsView() {
  const root = el('div', { class: 'view active' });
  const pad = el('div', { class: 'view-pad' });
  pad.append(el('h2', {}, 'Agent Activity'), el('div', { class: 'sub' }, 'A true multi-agent system. The lead agent plans, delegates to specialists in parallel, then merges their results.'));

  // live status
  const act = store.activity;
  if (act) {
    const live = el('div', { class: 'card', style: { marginBottom: '16px' } });
    live.append(el('div', { class: 'section-title', style: { margin: '0 0 10px' } }, 'Live run'));
    live.append(el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
      el('span', { class: 'spin', style: { display: act.done ? 'none' : 'inline-block', width: '13px', height: '13px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%' } }),
      el('span', {}, act.stageLabel || 'working…')));
    for (const a of act.agents) live.append(agentChip(a));
    pad.append(live);
  }

  pad.append(el('div', { class: 'section-title' }, 'Specialized Subagents'));
  const grid = el('div', { class: 'grid c2' });
  for (const a of (store.config?.agents || [])) {
    grid.append(el('div', { class: 'card agent-card' },
      el('div', { class: 'top' },
        el('div', { class: 'gl', style: { background: `color-mix(in srgb, ${a.color} 22%, transparent)`, color: a.color } }, a.glyph),
        el('div', {}, el('div', { class: 'nm' }, a.name), el('div', { class: 'role mono' }, a.id))),
      el('div', { class: 'tagline' }, a.tagline),
      el('div', { class: 'tags' }, a.actor ? el('span', { class: 'tag actor' }, 'acts on sandbox') : el('span', { class: 'tag' }, 'analysis'), a.browse ? el('span', { class: 'tag browse' }, 'web access') : null),
    ));
  }
  pad.append(grid);

  // timeline
  pad.append(el('div', { class: 'section-title' }, 'Recent Timeline'));
  const tl = el('div', { class: 'timeline' });
  const events = store.agentTimeline || [];
  if (!events.length) tl.append(el('div', { class: 'empty' }, 'No agent runs yet. Turn on subagents and send a message.'));
  for (const e of events.slice(0, 40)) {
    tl.append(el('div', { class: 'tl-item' },
      el('div', { class: 'when' }, fmtTime(e.ts)),
      el('div', { class: 'what' }, el('span', { class: 'who', style: { color: e.color || 'var(--accent)' } }, e.name), ' — ', e.text)));
  }
  pad.append(tl);
  root.append(pad);
  return root;
}

function agentChip(a) {
  const chip = el('div', { class: 'agent-chip ' + (a.status || '') });
  chip.append(el('div', { class: 'gl', style: { background: `color-mix(in srgb, ${a.color} 22%, transparent)`, color: a.color } }, a.glyph));
  chip.append(el('div', {}, el('div', {}, a.name), a.tool ? el('div', { class: 'tk' }, a.tool + (a.path ? ' · ' + a.path : '')) : null));
  const st = el('div', { class: 'st' });
  if (a.status === 'done') st.append('✓ ' + (a.ms ? fmtMs(a.ms) : 'done'));
  else if (a.status === 'error') st.append('✗ failed');
  else st.append(el('span', { class: 'pulse' }), 'working');
  chip.append(st);
  return chip;
}

/* ---- Tasks --------------------------------------------------------------- */
function tasksView() {
  const root = el('div', { class: 'view active' });
  const pad = el('div', { class: 'view-pad' });
  pad.append(el('h2', {}, 'Task Manager'), el('div', { class: 'sub' }, 'Long-running work runs in the background. Pause, resume or cancel any task.'));
  const list = el('div', { class: 'grid', style: { gap: '10px' } });
  const tasks = store.tasks || [];
  if (!tasks.length) list.append(el('div', { class: 'empty' }, el('div', { class: 'em' }, '✓'), 'No tasks yet. Sending a chat message creates a task.'));
  for (const t of tasks) {
    const controls = el('div', { class: 'controls' });
    if (t.status === 'running') controls.append(ctlBtn('Pause', () => ctl(t.id, 'pause')));
    if (t.status === 'paused') controls.append(ctlBtn('Resume', () => ctl(t.id, 'resume')));
    if (['running', 'paused'].includes(t.status)) controls.append(ctlBtn('Cancel', () => ctl(t.id, 'cancel'), 'danger'));
    list.append(el('div', { class: 'card task-item' },
      el('div', { class: 'row1' },
        el('span', { class: 'status-dot status-' + t.status }),
        el('span', { style: { fontWeight: '600', flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.title),
        el('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--muted)' } }, t.status + ' · ' + t.stage)),
      el('div', { class: 'bar' }, el('i', { style: { width: (t.progress || 0) + '%' } })),
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        el('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--faint)' } }, timeAgo(t.createdAt) + (t.error ? ' · ' + t.error : '')),
        controls)));
  }
  pad.append(list);
  root.append(pad);
  return root;
}
function ctlBtn(label, onclick, cls = '') { return el('button', { class: 'mini-btn ' + cls, onclick }, label); }
async function ctl(id, action) { try { await api.taskControl(id, action); refreshTasks(); } catch (e) { toast(e.message, 'err'); } }

/* ---- Settings ------------------------------------------------------------ */
function settingsView() {
  const root = el('div', { class: 'view active' });
  const pad = el('div', { class: 'view-pad' });
  pad.append(el('h2', {}, 'Settings'), el('div', { class: 'sub' }, 'Configure Aurel across four areas. Changes apply immediately and persist locally.'));
  const layout = el('div', { class: 'settings-layout' });
  const nav = el('div', { class: 'settings-nav' });
  const body = el('div', { class: 'settings-body' });
  const sections = ['general', 'capability', 'tools', 'extras'];
  let cur = store._settingsTab || 'general';
  const draw = () => {
    clear(nav); clear(body);
    for (const s of sections) nav.append(el('button', { class: cur === s ? 'active' : '', onclick: () => { cur = s; store._settingsTab = s; draw(); } }, s[0].toUpperCase() + s.slice(1)));
    body.append(SECTIONS[cur]());
  };
  draw();
  layout.append(nav, body);
  pad.append(layout);
  root.append(pad);
  return root;
}

function setting(label, desc, control) {
  return el('div', { class: 'setting' }, el('div', {}, el('div', { class: 'label' }, label), desc ? el('div', { class: 'desc' }, desc) : null), control);
}
function toggle(get, set) {
  const t = el('div', { class: 'toggle' + (get() ? ' on' : '') });
  t.addEventListener('click', () => { set(!get()); t.classList.toggle('on'); });
  return t;
}
function selectField(options, get, set) {
  const s = el('select', { class: 'field', onchange: (e) => set(e.target.value) });
  for (const [val, label] of options) s.append(el('option', { value: val, selected: get() === val }, label));
  return s;
}
function textField(get, set) {
  return el('input', { class: 'field', value: get(), onchange: (e) => set(e.target.value) });
}
function bind(group, key, val) { store.settings[group][key] = val; saveSettings(); if (group === 'general' && key === 'theme') setState({ theme: val }, 'theme'); }

const SECTIONS = {
  general() {
    const g = store.settings.general;
    return el('div', {},
      el('div', { class: 'section-title', style: { marginTop: '0' } }, 'Account & Appearance'),
      setting('Signed in as', 'Your Aurel account', el('span', { class: 'mono', style: { color: 'var(--muted)' } }, store.user?.email || 'guest')),
      setting('Theme', 'System follows your OS', selectField([['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], () => g.theme, (v) => bind('general', 'theme', v))),
      setting('Language', 'Interface language', selectField([['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['ja', '日本語']], () => g.language, (v) => bind('general', 'language', v))),
      el('div', { class: 'section-title' }, 'Workspace defaults'),
      setting('Default project name', 'Used when creating new projects', textField(() => g.defaultProjectName, (v) => bind('general', 'defaultProjectName', v))),
      setting('Restore session', 'Reopen tabs and chat on launch', toggle(() => g.restoreSession, (v) => bind('general', 'restoreSession', v))),
      setting('Send on Enter', 'Enter sends, Shift+Enter for newline', toggle(() => g.sendOnEnter, (v) => bind('general', 'sendOnEnter', v))),
    );
  },
  capability() {
    const c = store.settings.capability;
    return el('div', {},
      el('div', { class: 'section-title', style: { marginTop: '0' } }, 'Assistant behavior'),
      setting('Auto-delegate', 'Let the lead agent summon subagents when useful', toggle(() => c.autoDelegate, (v) => bind('capability', 'autoDelegate', v))),
      setting('Model routing', 'Manual keeps your chosen model; auto lets Aurel pick', selectField([['manual', 'Manual'], ['auto', 'Automatic']], () => c.modelRouting, (v) => bind('capability', 'modelRouting', v))),
      setting('Stream responses', 'Show tokens as they generate', toggle(() => c.streamResponses, (v) => bind('capability', 'streamResponses', v))),
      setting('Auto-validate', 'Run the Testing Agent after code changes (effort-gated)', toggle(() => c.autoValidate, (v) => bind('capability', 'autoValidate', v))),
      el('div', { class: 'section-title' }, 'Permissions'),
      setting('Sandbox write', 'Allow agents to create and edit files in the sandbox', toggle(() => c.sandboxWrite, (v) => bind('capability', 'sandboxWrite', v))),
      setting('Web browsing', 'Allow the Research Agent to browse the web', toggle(() => c.browsing, (v) => bind('capability', 'browsing', v))),
    );
  },
  tools() {
    const t = store.settings.tools;
    return el('div', {},
      el('div', { class: 'section-title', style: { marginTop: '0' } }, 'Editor'),
      setting('Line numbers', '', toggle(() => t.showLineNumbers, (v) => bind('tools', 'showLineNumbers', v))),
      setting('Word wrap', '', toggle(() => t.editorWordWrap, (v) => bind('tools', 'editorWordWrap', v))),
      setting('Format on save', 'Reserved for formatter integration', toggle(() => t.autoFormatOnSave, (v) => bind('tools', 'autoFormatOnSave', v))),
      el('div', { class: 'section-title' }, 'Terminal & Files'),
      setting('Command timeout (s)', 'Max time a sandbox command may run', textField(() => String(t.terminalTimeout), (v) => bind('tools', 'terminalTimeout', Number(v) || 20))),
      setting('Confirm before delete', '', toggle(() => t.fileConfirmDelete, (v) => bind('tools', 'fileConfirmDelete', v))),
    );
  },
  extras() {
    const e = store.settings.extras;
    return el('div', {},
      el('div', { class: 'section-title', style: { marginTop: '0' } }, 'Advanced'),
      setting('Telemetry', 'Local-only usage counters (never leaves your machine)', toggle(() => e.telemetry, (v) => bind('extras', 'telemetry', v))),
      setting('Experimental features', 'Enable in-progress capabilities', toggle(() => e.experimental, (v) => bind('extras', 'experimental', v))),
      setting('Compact chat', 'Denser message spacing', toggle(() => e.compactChat, (v) => bind('extras', 'compactChat', v))),
      el('div', { class: 'section-title' }, 'Data'),
      setting('Export workspace', 'Download settings and memory as JSON', el('button', { class: 'mini-btn', onclick: exportData }, '↓ Export')),
      setting('Import workspace', 'Restore from a JSON export', el('label', { class: 'mini-btn' }, '↑ Import', el('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: importData }))),
      el('div', { class: 'section-title' }, 'Keyboard shortcuts'),
      shortcutRow('⌘/Ctrl + S', 'Save file'),
      shortcutRow('⌘/Ctrl + K', 'Open model switcher'),
      shortcutRow('⌘/Ctrl + B', 'Toggle sidebar'),
      shortcutRow('⌘/Ctrl + J', 'Toggle terminal'),
      shortcutRow('Enter', 'Send message'),
    );
  },
};
function shortcutRow(keys, desc) { return el('div', { class: 'setting' }, el('div', { class: 'label' }, desc), el('kbd', { style: { fontFamily: 'var(--mono)', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '5px', padding: '2px 8px', fontSize: '11px' } }, keys)); }
function exportData() {
  const blob = new Blob([JSON.stringify({ settings: store.settings, exportedAt: Date.now() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aurel-workspace.json'; a.click();
  toast('Exported workspace', 'ok');
}
function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader(); r.onload = () => { try { const d = JSON.parse(r.result); if (d.settings) { store.settings = d.settings; saveSettings(); toast('Imported', 'ok'); setState({}, 'settings'); } } catch { toast('Invalid file', 'err'); } }; r.readAsText(file);
}

/* ---- Browser ------------------------------------------------------------- */
function browserView() {
  const root = el('div', { class: 'view active', style: { position: 'absolute', inset: '0' } });
  const b = store.browser || { url: '', result: null };
  const bar = el('div', { class: 'browser-bar' });
  const input = el('input', { value: b.url || '', placeholder: 'Enter a URL or search the web…', onkeydown: (e) => { if (e.key === 'Enter') go(e.target.value); } });
  bar.append(
    el('button', { class: 'icon-btn', title: 'Go', onclick: () => go(input.value), html: icon('browser') }),
    input,
    el('button', { class: 'mini-btn', onclick: () => go(input.value) }, 'Open'),
    el('button', { class: 'mini-btn', onclick: () => search(input.value) }, 'Search'));
  root.append(bar);
  const content = el('div', { class: 'browser-content' });
  if (b.loading) content.append(el('div', { class: 'empty' }, el('div', { class: 'em' }, '◍'), 'Loading…'));
  else if (b.mode === 'search' && b.result) {
    content.append(el('div', { class: 'title' }, 'Results for "' + esc(b.query) + '"'));
    for (const r of (b.result.results || [])) content.append(el('div', { class: 'search-result', onclick: () => go(r.url) }, el('div', { class: 'rt' }, r.title), el('div', { class: 'ru' }, r.url)));
    if (!(b.result.results || []).length) content.append(el('div', { class: 'empty' }, b.result.note || b.result.error || 'No results.'));
  } else if (b.result) {
    content.append(el('div', { class: 'title' }, b.result.title || b.result.url), el('div', { class: 'url' }, b.result.url), el('div', { class: 'text' }, b.result.text || ''));
  } else content.append(el('div', { class: 'empty' }, el('div', { class: 'em' }, '🌐'), 'The Research Agent browses here. Enter a URL or a search query.'));
  root.append(content);
  return root;

  async function go(url) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !url.includes('.')) return search(url);
    setState({ browser: { url, loading: true } }, 'browser');
    try { const result = await api.browseFetch(url); setState({ browser: { url: result.url, result, mode: 'page' } }, 'browser'); }
    catch (e) { setState({ browser: { url, result: { url, title: 'Error', text: e.message } } }, 'browser'); }
  }
  async function search(query) {
    if (!query) return;
    setState({ browser: { url: query, loading: true } }, 'browser');
    try { const result = await api.browseSearch(query); setState({ browser: { url: query, query, result, mode: 'search' } }, 'browser'); }
    catch (e) { setState({ browser: { url: query, result: { text: e.message } } }, 'browser'); }
  }
}

/* ---- Sandbox ------------------------------------------------------------- */
function sandboxView() {
  const root = el('div', { class: 'view active' });
  const pad = el('div', { class: 'view-pad' });
  pad.append(el('h2', {}, 'Sandbox'), el('div', { class: 'sub' }, 'A fully isolated filesystem. Agents create, read, edit, move and delete here — never on your real disk. Every mutation is tracked.'));

  const files = flatten(store.tree);
  const stats = el('div', { class: 'grid c3', style: { marginBottom: '4px' } });
  stats.append(statCard(String(files.length), 'files'), statCard(String((store.changes || []).length), 'tracked changes'), statCard(fmtBytes(files.reduce((s, f) => s + (f.size || 0), 0)), 'total size'));
  pad.append(stats);

  pad.append(el('div', { class: 'section-title' }, 'Change log'));
  const log = el('div', { class: 'card', style: { padding: '0' } });
  const changes = store.changes || [];
  if (!changes.length) log.append(el('div', { class: 'empty' }, 'No changes yet.'));
  for (const c of changes.slice(0, 60)) {
    log.append(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 14px', borderBottom: '1px solid var(--border-soft)', fontSize: '12.5px', cursor: 'pointer' }, onclick: () => c.target && openFile(c.target) },
      el('span', { class: 'mono', style: { fontSize: '10px', textTransform: 'uppercase', color: opColor(c.op), width: '52px' } }, c.op),
      el('span', { class: 'mono', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis' } }, c.target + (c.from ? '  ← ' + c.from : '')),
      el('span', { style: { color: 'var(--faint)', fontSize: '11px' } }, timeAgo(c.ts))));
  }
  pad.append(log);

  pad.append(el('div', { class: 'section-title' }, 'Generated files'));
  const grid = el('div', { class: 'grid c3' });
  for (const f of files.slice(0, 24)) grid.append(el('div', { class: 'card', style: { cursor: 'pointer' }, onclick: () => openFile(f.path) },
    el('div', { class: 'mono', style: { fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.path),
    el('div', { style: { color: 'var(--faint)', fontSize: '11px', marginTop: '4px' } }, fmtBytes(f.size || 0))));
  if (!files.length) grid.append(el('div', { class: 'empty' }, 'Empty sandbox.'));
  pad.append(grid);
  root.append(pad);
  return root;
}
function statCard(big, label) { return el('div', { class: 'card', style: { textAlign: 'center' } }, el('div', { style: { fontSize: '26px', fontWeight: '700', fontFamily: 'var(--mono)' } }, big), el('div', { style: { color: 'var(--muted)', fontSize: '12px', marginTop: '2px' } }, label)); }
function opColor(op) { return ({ create: 'var(--ok)', edit: 'var(--info)', delete: 'var(--err)', move: 'var(--warn)', mkdir: 'var(--accent-2)' })[op] || 'var(--muted)'; }

/* ---- Memory -------------------------------------------------------------- */
function memoryView() {
  const root = el('div', { class: 'view active' });
  const pad = el('div', { class: 'view-pad' });
  pad.append(el('h2', {}, 'Memory'), el('div', { class: 'sub' }, 'What Aurel remembers about this project: conversation, file summaries, task history and agent context.'));
  const holder = el('div', {});
  pad.append(holder);
  root.append(pad);
  api.memory(store.projectId).then((mem) => {
    clear(holder);
    holder.append(el('div', { class: 'section-title', style: { marginTop: '0' } }, `Conversation (${mem.history.length})`));
    const conv = el('div', { class: 'card', style: { padding: '0', maxHeight: '240px', overflow: 'auto' } });
    for (const m of mem.history.slice(-30)) conv.append(el('div', { style: { padding: '6px 14px', borderBottom: '1px solid var(--border-soft)', fontSize: '12.5px' } }, el('span', { style: { color: m.role === 'user' ? 'var(--accent)' : 'var(--accent-2)', fontWeight: '600' } }, m.role + ': '), (m.content || '').slice(0, 200)));
    if (!mem.history.length) conv.append(el('div', { class: 'empty' }, 'No history yet.'));
    holder.append(conv);

    holder.append(el('div', { class: 'section-title' }, 'Agent context'));
    const ctx = el('div', { class: 'card', style: { padding: '0' } });
    for (const c of (mem.agentContext || []).slice(0, 20)) ctx.append(el('div', { style: { padding: '6px 14px', borderBottom: '1px solid var(--border-soft)', fontSize: '12px' } }, el('span', { class: 'mono', style: { color: 'var(--faint)' } }, fmtMs(c.ms || 0) + ' · ' + (c.changes || 0) + ' changes · '), (c.message || '')));
    if (!(mem.agentContext || []).length) ctx.append(el('div', { class: 'empty' }, 'No agent runs recorded.'));
    holder.append(ctx);

    const sums = Object.entries(mem.summaries || {});
    holder.append(el('div', { class: 'section-title' }, `File summaries (${sums.length})`));
    const sc = el('div', { class: 'card', style: { padding: '0' } });
    for (const [path, s] of sums) sc.append(el('div', { style: { padding: '6px 14px', borderBottom: '1px solid var(--border-soft)', fontSize: '12px' } }, el('span', { class: 'mono', style: { color: 'var(--accent)' } }, path + ': '), s.summary));
    if (!sums.length) sc.append(el('div', { class: 'empty' }, 'No summaries yet.'));
    holder.append(sc);
  }).catch(() => { clear(holder); holder.append(el('div', { class: 'empty' }, 'Could not load memory.')); });
  return root;
}

function flatten(nodes, out = []) { for (const n of nodes || []) { if (n.type === 'dir') flatten(n.children, out); else out.push(n); } return out; }
