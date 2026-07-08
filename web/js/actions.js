// Imperative operations shared across views. Each mutates the store and emits so
// subscribed UI modules re-render. Keeps view modules free of cross-imports.
import { api } from './api.js';
import { store, setState, emit } from './store.js';
import { langFor, baseName, toast } from './util.js';

export async function loadProjectData() {
  if (!store.projectId) return;
  try {
    const [{ tree }, { changes }, { tasks }] = await Promise.all([
      api.tree(store.projectId), api.changes(store.projectId), api.tasks(store.projectId),
    ]);
    setState({ tree, changes, tasks }, 'project-data');
  } catch (e) { toast('Failed to load project: ' + e.message, 'err'); }
}

export async function refreshTree() {
  if (!store.projectId) return;
  try { const { tree } = await api.tree(store.projectId); setState({ tree }, 'tree'); } catch { /* ignore */ }
}
export async function refreshChanges() {
  if (!store.projectId) return;
  try { const { changes } = await api.changes(store.projectId); setState({ changes }, 'changes'); } catch { /* ignore */ }
}
export async function refreshTasks() {
  if (!store.projectId) return;
  try { const { tasks } = await api.tasks(store.projectId); setState({ tasks }, 'tasks'); } catch { /* ignore */ }
}

// ---- editor tabs ----------------------------------------------------------
export function findTab(id) { return store.tabs.find((t) => t.id === id); }

export async function openFile(path) {
  const id = 'file:' + path;
  if (findTab(id)) return activateTab(id);
  try {
    const f = await api.readFile(store.projectId, path);
    const tab = f.binary
      ? { id, kind: 'binary', name: baseName(path), path, base64: f.base64, ext: (path.split('.').pop() || '').toLowerCase(), size: f.size, dirty: false }
      : { id, kind: 'file', name: baseName(path), path, content: f.content, original: f.content, lang: langFor(path), dirty: false };
    setState({ tabs: [...store.tabs, tab], activePath: id }, 'editor');
  } catch (e) { toast('Cannot open ' + path + ': ' + e.message, 'err'); }
}

export function openView(kind) {
  const id = 'view:' + kind;
  const names = { settings: 'Settings', agents: 'Agent Activity', tasks: 'Task Manager', browser: 'Browser', sandbox: 'Sandbox', memory: 'Memory' };
  if (!findTab(id)) setState({ tabs: [...store.tabs, { id, kind, name: names[kind] || kind, dirty: false }] }, 'editor');
  setState({ activePath: id }, 'editor');
}

export function activateTab(id) { setState({ activePath: id }, 'editor'); }

export function closeTab(id) {
  const idx = store.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tabs = store.tabs.filter((t) => t.id !== id);
  let activePath = store.activePath;
  let splitPath = store.splitPath === id ? null : store.splitPath;
  if (activePath === id) activePath = tabs.length ? (tabs[Math.max(0, idx - 1)]?.id || tabs[0].id) : null;
  setState({ tabs, activePath, splitPath }, 'editor');
}

export function updateTabContent(id, content) {
  const tab = findTab(id);
  if (!tab) return;
  tab.content = content;
  tab.dirty = content !== tab.original;
  emit('editor-dirty', { id });
}

export async function saveTab(id) {
  const tab = findTab(id);
  if (!tab || tab.kind !== 'file') return;
  try {
    await api.writeFile(store.projectId, tab.path, tab.content);
    tab.original = tab.content; tab.dirty = false;
    if (store.settings.tools.autoFormatOnSave) { /* hook point */ }
    toast('Saved ' + tab.name, 'ok');
    emit('editor', {}); refreshTree(); refreshChanges();
  } catch (e) { toast('Save failed: ' + e.message, 'err'); }
}

export function toggleSplit(id) {
  setState({ splitPath: store.splitPath === id ? null : id }, 'editor');
}

// ---- file operations ------------------------------------------------------
export async function createFile(path, content = '') {
  await api.writeFile(store.projectId, path, content);
  await refreshTree(); refreshChanges();
  openFile(path);
}
export async function createFolder(path) { await api.mkdir(store.projectId, path); await refreshTree(); }
export async function deleteEntry(path) {
  await api.del(store.projectId, path);
  closeTab('file:' + path);
  await refreshTree(); refreshChanges();
}
export async function renameEntry(from, newName) {
  const { to } = await api.rename(store.projectId, from, newName);
  closeTab('file:' + from);
  await refreshTree();
  if (to) openFile(to);
}
export async function moveEntry(from, to) { await api.move(store.projectId, from, to); await refreshTree(); }

// ---- terminal -------------------------------------------------------------
export function termPush(entries) {
  const term = store.terminal || [];
  setState({ terminal: [...term, ...entries].slice(-500) }, 'terminal');
}
export async function runTerminal(command) {
  termPush([{ type: 'cmd', text: command }]);
  try {
    const r = await api.exec(store.projectId, command);
    const out = [];
    if (r.stdout) out.push({ type: 'out', text: r.stdout.replace(/\n$/, '') });
    if (r.stderr) out.push({ type: 'er', text: r.stderr.replace(/\n$/, '') });
    out.push({ type: 'meta', text: `exit ${r.code} · ${r.ms}ms` });
    termPush(out);
    refreshTree(); refreshChanges();
  } catch (e) { termPush([{ type: 'er', text: e.message }]); }
}

// ---- model selection ------------------------------------------------------
export function selectModel(provider, model) { setState({ provider, model }, 'model'); }
export function setEffort(effort) { setState({ effort }, 'controls'); }
export function setSubagents(on, count) {
  const patch = {};
  if (on != null) patch.subagentsOn = on;
  if (count != null) patch.subagentCount = Math.max(1, Math.min(6, count));
  setState(patch, 'controls');
}
