// Central reactive state with a tiny pub/sub and localStorage persistence.
const listeners = new Set();
const persistKeys = ['theme', 'provider', 'model', 'effort', 'subagentsOn', 'subagentCount', 'projectId', 'settings', 'chatWidth', 'sideWidth', 'dockOpen'];

export const store = {
  ready: false,
  user: null,
  config: null,           // { models, efforts, agents, projects }
  projects: [],
  projectId: localStorage.getItem('aurel.projectId') || null,

  provider: localStorage.getItem('aurel.provider') || null,
  model: localStorage.getItem('aurel.model') || null,
  effort: localStorage.getItem('aurel.effort') || 'medium',
  subagentsOn: localStorage.getItem('aurel.subagentsOn') === '1',
  subagentCount: Number(localStorage.getItem('aurel.subagentCount') || 3),

  theme: localStorage.getItem('aurel.theme') || 'system',
  view: 'chat',           // active rail view controlling sidebar + center

  // editor
  tabs: [],               // [{path, name, dirty, content, original, lang}]
  activePath: null,
  splitPath: null,        // right pane path when split

  // chat
  messages: [],           // [{role, content, streaming, activity}]
  streaming: false,

  // live agent activity for the in-flight message
  activity: null,

  // data
  tree: [],
  changes: [],
  tasks: [],
  logs: [],
  logCursor: 0,

  settings: JSON.parse(localStorage.getItem('aurel.settings') || 'null') || defaultSettings(),

  chatWidth: Number(localStorage.getItem('aurel.chatWidth') || 400),
  sideWidth: Number(localStorage.getItem('aurel.sideWidth') || 268),
  dockOpen: localStorage.getItem('aurel.dockOpen') !== '0',
};

function defaultSettings() {
  return {
    general: { theme: 'system', language: 'en', defaultProjectName: 'New Project', restoreSession: true, sendOnEnter: true },
    capability: { autoDelegate: true, sandboxWrite: true, browsing: true, autoValidate: true, modelRouting: 'manual', streamResponses: true },
    tools: { editorWordWrap: false, editorMinimap: false, terminalTimeout: 20, fileConfirmDelete: true, showLineNumbers: true, autoFormatOnSave: false },
    extras: { telemetry: false, experimental: false, compactChat: false, soundOnComplete: false },
  };
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(evt, payload) { for (const fn of listeners) fn(evt, payload); }

export function setState(patch, evt = 'state') {
  Object.assign(store, patch);
  for (const k of Object.keys(patch)) {
    if (persistKeys.includes(k)) {
      const v = store[k];
      localStorage.setItem('aurel.' + k, typeof v === 'object' ? JSON.stringify(v) : (v === true ? '1' : v === false ? '0' : v));
    }
  }
  emit(evt, patch);
}

export function saveSettings() {
  localStorage.setItem('aurel.settings', JSON.stringify(store.settings));
  emit('settings');
}
