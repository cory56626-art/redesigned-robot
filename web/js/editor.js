// Editor region: tabs, split panes, code editor (highlight + line numbers),
// and preview surfaces (markdown, image, JSON tree, diff).
import { store, subscribe } from './store.js';
import { el, clear, esc, icon, copy, fmtBytes } from './util.js';
import { highlight } from './highlight.js';
import { renderMarkdown } from './markdown.js';
import { findTab, activateTab, closeTab, updateTabContent, saveTab, toggleSplit } from './actions.js';
import { renderView } from './views.js';

const nodeCache = new Map(); // tabId -> { root, refresh }

export function mountEditor() {
  const region = document.getElementById('editor-region');
  subscribe((evt) => {
    if (['editor', 'project-data', 'tree', 'controls', 'model', 'tasks', 'changes', 'browser', 'settings', 'memory'].includes(evt)) render(region);
    if (evt === 'editor-dirty') updateDirtyDots();
  });
  render(region);
}

function render(region) {
  clear(region);
  // prune cache for closed tabs
  for (const id of [...nodeCache.keys()]) if (!findTab(id)) nodeCache.delete(id);

  const active = findTab(store.activePath);
  const primary = buildPane('primary', active, false);
  region.append(primary);

  if (store.splitPath && findTab(store.splitPath) && store.splitPath !== store.activePath) {
    region.append(el('div', { class: 'resizer' }));
    region.append(buildPane('split', findTab(store.splitPath), true));
  }
}

function buildPane(kind, tab, isSplit) {
  const pane = el('div', { class: 'pane' });
  const tabs = el('div', { class: 'tabs' });
  if (!isSplit) {
    for (const t of store.tabs) {
      const active = t.id === store.activePath;
      tabs.append(el('div', { class: 'tab' + (active ? ' active' : ''), onclick: () => activateTab(t.id), title: t.path || t.name },
        t.dirty ? el('span', { class: 'dot' }) : null,
        el('span', { class: 'nm' }, t.name),
        el('span', { class: 'x', title: 'Close', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, '×'),
      ));
    }
    if (!store.tabs.length) tabs.append(el('div', { class: 'tab active' }, el('span', { class: 'nm', style: { color: 'var(--faint)' } }, 'No open tabs')));
  } else {
    tabs.append(el('div', { class: 'tab active' }, el('span', { class: 'nm' }, tab.name),
      el('span', { class: 'x', title: 'Close split', onclick: () => toggleSplit(store.splitPath) }, '×')));
  }
  pane.append(tabs);

  const host = el('div', { class: 'editor-host' });
  pane.append(host);
  if (!tab) { host.append(welcome()); return pane; }

  if (tab.kind === 'file' || tab.kind === 'binary') {
    const node = getFileNode(tab, isSplit ? 'split' : 'primary');
    host.append(node);
  } else {
    host.append(renderView(tab.kind, tab));
  }
  return pane;
}

function welcome() {
  return el('div', { class: 'welcome' },
    el('div', {},
      el('div', { class: 'big' }, 'AUREL'),
      el('div', { class: 'hint' }, 'Open a file from the Explorer, or ask the assistant to build something. Every file the agents touch lives in an isolated sandbox — nothing hits your real disk.'),
      el('div', { style: { marginTop: '14px', color: 'var(--faint)', fontSize: '12px' } }, 'Tip: press ', el('kbd', {}, 'Enter'), ' in chat to delegate to subagents.'),
    ));
}

function getFileNode(tab, paneKey) {
  const key = paneKey + ':' + tab.id;
  if (tab.kind === 'binary') return binaryPreview(tab);
  // Toolbar + editor
  const wrap = el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column' } });
  wrap.append(fileToolbar(tab));
  const body = el('div', { style: { position: 'relative', flex: '1', minHeight: '0' } });
  wrap.append(body);
  const mode = tab._mode || 'code';
  if (mode === 'preview' && tab.lang === 'md') body.append(mdPreview(tab));
  else if (mode === 'preview' && tab.lang === 'html') body.append(htmlPreview(tab));
  else if (mode === 'json' && tab.lang === 'json') body.append(jsonView(tab));
  else if (mode === 'diff') body.append(diffView(tab));
  else body.append(codeEditor(tab));
  return wrap;
}

function fileToolbar(tab) {
  const bar = el('div', { style: { position: 'absolute', top: '6px', right: '12px', zIndex: '5', display: 'flex', gap: '6px' } });
  const btn = (label, mode, cond = true) => cond ? el('button', { class: 'copy-btn', onclick: () => { tab._mode = (tab._mode === mode ? 'code' : mode); rerender(); } }, label) : null;
  if (tab.dirty) bar.append(el('button', { class: 'copy-btn', style: { borderColor: 'var(--accent)', color: 'var(--accent)' }, onclick: () => saveTab(tab.id) }, '⌘S Save'));
  bar.append(btn('Preview', 'preview', tab.lang === 'md' || tab.lang === 'html'));
  bar.append(btn('Tree', 'json', tab.lang === 'json'));
  bar.append(btn('Diff', 'diff', tab.original !== tab.content));
  bar.append(el('button', { class: 'copy-btn', onclick: () => copy(tab.content) }, 'Copy'));
  return bar;
}

let _region;
function rerender() { _region = _region || document.getElementById('editor-region'); render(_region); }

function codeEditor(tab) {
  const wrap = el('div', { class: 'code-wrap' });
  const gutter = el('div', { class: 'gutter' });
  const scroll = el('div', { class: 'code-scroll' });
  const layer = el('pre', { class: 'code-layer' }, el('code', { html: highlight(tab.content, tab.lang) }));
  const input = el('textarea', {
    class: 'code-input', spellcheck: 'false', wrap: store.settings.tools.editorWordWrap ? 'soft' : 'off',
  });
  input.value = tab.content;
  const updateGutter = () => {
    const lines = input.value.split('\n').length;
    clear(gutter);
    for (let i = 1; i <= lines; i++) gutter.append(el('div', {}, String(i)));
  };
  const rehl = () => { layer.firstChild.innerHTML = highlight(input.value, tab.lang); };
  input.addEventListener('input', () => { updateTabContent(tab.id, input.value); rehl(); updateGutter(); });
  input.addEventListener('scroll', () => { layer.scrollTop = input.scrollTop; layer.scrollLeft = input.scrollLeft; gutter.style.transform = `translateY(${-input.scrollTop}px)`; });
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveTab(tab.id); }
    if (e.key === 'Tab') { e.preventDefault(); const s = input.selectionStart, en = input.selectionEnd; input.value = input.value.slice(0, s) + '  ' + input.value.slice(en); input.selectionStart = input.selectionEnd = s + 2; updateTabContent(tab.id, input.value); rehl(); }
  });
  if (!store.settings.tools.showLineNumbers) gutter.style.display = 'none';
  scroll.append(layer, input);
  wrap.append(gutter, scroll);
  updateGutter();
  setTimeout(() => input.focus(), 0);
  return wrap;
}

function mdPreview(tab) { return el('div', { class: 'preview' }, el('div', { class: 'md-body bubble md', html: renderMarkdown(tab.content) })); }
function htmlPreview(tab) {
  const f = el('iframe', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%', border: 'none', background: '#fff' }, sandbox: 'allow-scripts' });
  setTimeout(() => { f.srcdoc = tab.content; }, 0);
  return f;
}
function jsonView(tab) {
  let data; try { data = JSON.parse(tab.content); } catch (e) { return el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'Invalid JSON: ' + e.message)); }
  return el('div', { class: 'preview' }, el('div', { class: 'json-tree' }, jsonNode(data)));
}
function jsonNode(v, key) {
  const kd = key != null ? el('span', { class: 'k' }, JSON.stringify(key) + ': ') : null;
  if (v === null) return el('div', {}, kd, el('span', { class: 'b' }, 'null'));
  if (typeof v === 'object') {
    const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    const det = el('details', { open: true });
    det.append(el('summary', {}, kd, el('span', { class: 'tk-punct' }, Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`)));
    for (const [k, val] of entries) det.append(jsonNode(val, k));
    return det;
  }
  const cls = typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's';
  return el('div', {}, kd, el('span', { class: cls }, JSON.stringify(v)));
}

function diffView(tab) {
  const wrap = el('div', { class: 'preview' });
  const diff = el('div', { class: 'diff' });
  const a = (tab.original || '').split('\n'), b = (tab.content || '').split('\n');
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) { diff.append(row(i + 1, a[i] ?? '', '')); }
    else {
      if (a[i] !== undefined) diff.append(row(i + 1, a[i], 'del'));
      if (b[i] !== undefined) diff.append(row(i + 1, b[i], 'add'));
    }
  }
  wrap.append(el('div', { style: { color: 'var(--muted)', fontSize: '11px', marginBottom: '10px' } }, 'Comparing saved (—) vs current (+)'), diff);
  return wrap;
  function row(n, text, kind) {
    return el('div', { class: 'row ' + kind }, el('span', { class: 'ln' }, String(n)), el('span', { html: (kind === 'add' ? '+ ' : kind === 'del' ? '- ' : '  ') + esc(text) }));
  }
}

function binaryPreview(tab) {
  const wrap = el('div', { class: 'preview' });
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg'].includes(tab.ext)) {
    const mime = tab.ext === 'svg' ? 'image/svg+xml' : 'image/' + (tab.ext === 'jpg' ? 'jpeg' : tab.ext);
    wrap.append(el('div', { style: { textAlign: 'center' } },
      el('img', { src: `data:${mime};base64,${tab.base64}` }),
      el('div', { style: { color: 'var(--muted)', marginTop: '12px', fontSize: '12px' } }, `${tab.name} · ${fmtBytes(tab.size)}`)));
  } else {
    wrap.append(el('div', { class: 'empty' }, el('div', { class: 'em' }, '📦'), `Binary file · ${fmtBytes(tab.size)}`,
      el('div', { style: { marginTop: '12px' } }, el('a', { class: 'copy-btn', href: `data:application/octet-stream;base64,${tab.base64}`, download: tab.name }, '↓ Download'))));
  }
  return wrap;
}

function updateDirtyDots() {
  // cheap: full re-render handles it
  rerender();
}
