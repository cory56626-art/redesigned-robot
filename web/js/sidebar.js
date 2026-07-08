// Context sidebar: file explorer (tree, DnD, upload/download, context menu) and global search/replace.
import { store, setState, subscribe } from './store.js';
import { api } from './api.js';
import { el, clear, esc, icon, toast, baseName, debounce } from './util.js';
import { openFile, createFile, createFolder, deleteEntry, renameEntry, moveEntry, refreshTree } from './actions.js';

const expanded = new Set();

export function mountSidebar() {
  subscribe((evt) => {
    if (['tree', 'project-data', 'view', 'sidebar', 'changes'].includes(evt)) render();
  });
  render();
}

function render() {
  const title = document.getElementById('side-title');
  const actions = document.getElementById('side-actions');
  const body = document.getElementById('side-body');
  clear(actions); clear(body);
  if (store.sidebarMode === 'search') { title.textContent = 'Search'; renderSearch(body); return; }
  title.textContent = 'Explorer';
  actions.append(
    iconBtn('plus', 'New file', () => newEntry(false)),
    iconBtn('folderPlus', 'New folder', () => newEntry(true)),
    iconBtn('upload', 'Upload', uploadFiles),
    iconBtn('refresh', 'Refresh', refreshTree),
  );
  renderTree(body);
}

function iconBtn(name, title, onclick) { return el('button', { class: 'icon-btn', title, onclick, html: icon(name) }); }

function renderTree(body) {
  const tree = el('div', { class: 'tree' });
  if (!store.tree.length) tree.append(el('div', { class: 'empty', style: { padding: '30px 16px' } }, 'Empty sandbox.', el('div', { style: { marginTop: '8px' } }, el('button', { class: 'mini-btn', onclick: () => newEntry(false) }, 'New file'))));
  const changed = new Set((store.changes || []).map((c) => c.target));
  const walk = (nodes, depth, container) => {
    for (const n of nodes) {
      if (n.type === 'dir') {
        const isOpen = expanded.has(n.path);
        const row = el('div', { class: 'node', style: { '--depth': depth }, draggable: 'true' },
          el('span', { class: 'tw' }, isOpen ? '▾' : '▸'),
          el('span', { class: 'ic', html: icon('files') }),
          el('span', { class: 'nm' }, n.name));
        wireNode(row, n, true);
        row.addEventListener('click', () => { if (isOpen) expanded.delete(n.path); else expanded.add(n.path); render(); });
        container.append(row);
        if (isOpen) walk(n.children, depth + 1, container);
      } else {
        const row = el('div', { class: 'node' + (store.activePath === 'file:' + n.path ? ' selected' : ''), style: { '--depth': depth }, draggable: 'true' },
          el('span', { class: 'tw' }),
          el('span', { class: 'ic', html: fileIcon(n.name) }),
          el('span', { class: 'nm' }, n.name),
          changed.has(n.path) ? el('span', { class: 'chg' }, '●') : null);
        row.addEventListener('click', () => openFile(n.path));
        wireNode(row, n, false);
        container.append(row);
      }
    }
  };
  walk(store.tree, 0, tree);
  body.append(tree);
}

function fileIcon(name) { return icon('file'); }

function wireNode(row, node, isDir) {
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e, node, isDir); });
  row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/aurel', node.path); e.dataTransfer.effectAllowed = 'move'; });
  if (isDir) {
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('dragover'); });
    row.addEventListener('dragleave', () => row.classList.remove('dragover'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); row.classList.remove('dragover');
      const from = e.dataTransfer.getData('text/aurel');
      if (!from || from === node.path) return;
      const to = node.path + '/' + baseName(from);
      try { await moveEntry(from, to); toast('Moved to ' + node.name, 'ok'); } catch (err) { toast(err.message, 'err'); }
    });
  }
}

function contextMenu(e, node, isDir) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = el('div', { class: 'ctx-menu', style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: '9px', boxShadow: 'var(--shadow)', padding: '5px', zIndex: '60', minWidth: '160px' } });
  const item = (label, fn, danger) => el('div', { style: { padding: '7px 12px', borderRadius: '6px', fontSize: '12.5px', cursor: 'pointer', color: danger ? 'var(--err)' : 'var(--text)' }, onmouseenter: (ev) => ev.target.style.background = 'var(--panel-2)', onmouseleave: (ev) => ev.target.style.background = '', onclick: () => { menu.remove(); fn(); } }, label);
  if (isDir) { menu.append(item('New file…', () => newEntry(false, node.path)), item('New folder…', () => newEntry(true, node.path))); }
  else menu.append(item('Open', () => openFile(node.path)), item('Download', () => downloadFile(node.path)));
  menu.append(item('Rename…', () => promptRename(node)), item('Delete', () => promptDelete(node), true));
  document.body.append(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function newEntry(isDir, parent = '') {
  const name = prompt(isDir ? 'New folder name:' : 'New file name:');
  if (!name) return;
  const path = (parent ? parent + '/' : '') + name;
  try {
    if (isDir) { await createFolder(path); expanded.add(parent); }
    else await createFile(path, '');
    if (parent) expanded.add(parent);
    refreshTree();
  } catch (e) { toast(e.message, 'err'); }
}
async function promptRename(node) {
  const name = prompt('Rename to:', node.name);
  if (!name || name === node.name) return;
  try { await renameEntry(node.path, name); } catch (e) { toast(e.message, 'err'); }
}
async function promptDelete(node) {
  if (store.settings.tools.fileConfirmDelete && !confirm(`Delete ${node.path}?`)) return;
  try { await deleteEntry(node.path); toast('Deleted', 'ok'); } catch (e) { toast(e.message, 'err'); }
}
async function downloadFile(path) {
  try {
    const f = await api.readFile(store.projectId, path);
    const a = document.createElement('a');
    a.href = f.binary ? `data:application/octet-stream;base64,${f.base64}` : 'data:text/plain;charset=utf-8,' + encodeURIComponent(f.content);
    a.download = baseName(path); a.click();
  } catch (e) { toast(e.message, 'err'); }
}
function uploadFiles() {
  const input = el('input', { type: 'file', multiple: true, style: { display: 'none' } });
  input.addEventListener('change', async () => {
    for (const file of input.files) {
      const buf = await file.arrayBuffer();
      const isText = /\.(txt|js|ts|json|md|css|html|py|sh|yml|yaml|csv|xml|jsx|tsx|go|rs|java|c|cpp|h)$/i.test(file.name);
      if (isText) await api.writeFile(store.projectId, file.name, new TextDecoder().decode(buf));
      else { const b64 = btoa(String.fromCharCode(...new Uint8Array(buf))); await api.writeFile(store.projectId, file.name, b64, true); }
    }
    toast(`Uploaded ${input.files.length} file(s)`, 'ok');
    refreshTree();
  });
  input.click();
}

/* ---- search -------------------------------------------------------------- */
function renderSearch(body) {
  const s = store.searchState || { q: '', replace: '', regex: false, cs: false, results: [] };
  const bar = el('div', { class: 'searchbar' });
  const q = el('input', { placeholder: 'Search across sandbox…', value: s.q });
  const rep = el('input', { placeholder: 'Replace with…', value: s.replace });
  const opts = el('div', { class: 'opts' },
    optBtn('.*', 'Regex', () => s.regex, () => { s.regex = !s.regex; run(); }),
    optBtn('Aa', 'Match case', () => s.cs, () => { s.cs = !s.cs; run(); }),
    el('button', { class: 'mini-btn', onclick: doReplace, title: 'Replace all' }, 'Replace all'));
  const run = debounce(async () => {
    s.q = q.value; s.replace = rep.value;
    if (!s.q) { s.results = []; setState({ searchState: { ...s } }, 'sidebar'); return; }
    try { const { results } = await api.search(store.projectId, s.q, { regex: s.regex, cs: s.cs }); s.results = results; setState({ searchState: { ...s } }, 'sidebar'); } catch (e) { toast(e.message, 'err'); }
  }, 250);
  q.addEventListener('input', run); rep.addEventListener('input', () => { s.replace = rep.value; });
  bar.append(q, rep, opts);
  body.append(bar);

  const list = el('div', {});
  const byFile = {};
  for (const r of s.results) (byFile[r.path] ||= []).push(r);
  const total = s.results.length;
  body.append(el('div', { style: { padding: '6px 12px', fontSize: '11px', color: 'var(--muted)' } }, total ? `${total} results in ${Object.keys(byFile).length} files` : (s.q ? 'No results' : 'Type to search')));
  for (const [path, hits] of Object.entries(byFile)) {
    list.append(el('div', { style: { padding: '5px 12px 2px', fontSize: '11px', color: 'var(--accent)', fontFamily: 'var(--mono)' } }, path));
    for (const h of hits.slice(0, 40)) list.append(el('div', { class: 'search-hit', onclick: () => openFile(h.path) },
      el('span', { class: 'line', html: `<span style="color:var(--faint)">${h.line}</span>  ` + highlightHit(h.text, s.q, s.regex) })));
  }
  body.append(list);

  async function doReplace() {
    if (!s.q) return;
    if (!confirm(`Replace all "${s.q}" with "${s.replace}"?`)) return;
    try { const r = await api.replace(store.projectId, { query: s.q, replacement: s.replace, regex: s.regex, caseSensitive: s.cs }); toast(`Replaced ${r.count} in ${r.files} files`, 'ok'); run(); refreshTree(); } catch (e) { toast(e.message, 'err'); }
  }
}
function optBtn(label, title, get, toggle) { const b = el('button', { class: 'mini-btn', title, onclick: () => { toggle(); b.classList.toggle('on'); } }, label); if (get()) b.style.borderColor = 'var(--accent)'; return b; }
function highlightHit(text, q, regex) {
  try { const re = regex ? new RegExp(q, 'gi') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); return esc(text).replace(re, (m) => `<mark>${esc(m)}</mark>`); }
  catch { return esc(text); }
}
