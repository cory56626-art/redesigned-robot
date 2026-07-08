// Chat panel: streaming responses, live multi-agent activity, and the model /
// effort / subagent controls. Also owns the model-switcher modal.
import { store, setState, subscribe, emit } from './store.js';
import { streamChat } from './api.js';
import { el, clear, esc, icon, copy, fmtMs, toast } from './util.js';
import { renderMarkdown } from './markdown.js';
import { selectModel, setEffort, setSubagents, refreshTree, refreshChanges, refreshTasks, termPush } from './actions.js';
import { openModelModal } from './modelmodal.js';

let live = null; // { msg, bubbleEl, activityEl, activity }
let session = null;

export function mountChat() {
  subscribe((evt) => {
    if (['messages', 'chat'].includes(evt)) { renderMessages(); updateSendState(); }
    if (['model', 'controls', 'config'].includes(evt)) renderComposer();
  });
  renderMessages();
  renderComposer();
}

function updateSendState() {
  const btn = document.querySelector('#composer .send-btn');
  if (!btn) return;
  btn.classList.toggle('stop', store.streaming);
  btn.innerHTML = store.streaming ? icon('x') : icon('send');
  btn.title = store.streaming ? 'Stop' : 'Send';
}

/* ---- messages ------------------------------------------------------------ */
function renderMessages() {
  const scroll = document.getElementById('chat-scroll');
  clear(scroll);
  if (!store.messages.length) {
    scroll.append(el('div', { class: 'empty', style: { margin: 'auto' } },
      el('div', { class: 'em' }, '◈'),
      el('div', {}, 'Ask Aurel to build, debug, explain or refactor.'),
      el('div', { style: { marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' } },
        suggestion('Build a REST API for a todo app in Node'),
        suggestion('Create a Python script that plots a sine wave'),
        suggestion('Scaffold a landing page with HTML and CSS'))));
    return;
  }
  for (const m of store.messages) scroll.append(renderMessage(m));
  scroll.scrollTop = scroll.scrollHeight;
}
function suggestion(text) { return el('button', { class: 'mini-btn', style: { textAlign: 'left' }, onclick: () => { const ta = document.getElementById('composer-input'); if (ta) { ta.value = text; ta.focus(); } } }, text); }

function renderMessage(m) {
  const wrap = el('div', { class: 'msg ' + m.role });
  wrap.append(el('div', { class: 'who' },
    el('span', { class: 'av' }, m.role === 'user' ? (store.user?.name?.[0]?.toUpperCase() || 'U') : '◈'),
    el('span', {}, m.role === 'user' ? (store.user?.name || 'You') : 'Aurel'),
    m.meta?.model ? el('span', { style: { color: 'var(--faint)' } }, '· ' + m.meta.model) : null));
  if (m.role === 'assistant') {
    const activityEl = el('div', {});
    if (m.activity) activityEl.append(renderActivity(m.activity));
    wrap.append(activityEl);
    const bubble = el('div', { class: 'bubble md' , html: m.content ? renderMarkdown(m.content) : (m.streaming ? '<span style="color:var(--faint)">…</span>' : '') });
    wrap.append(bubble);
    if (m.streaming && live && live.msg === m) { live.bubbleEl = bubble; live.activityEl = activityEl; }
    if (m.content && !m.streaming) wrap.append(el('div', { style: { marginTop: '4px' } }, el('button', { class: 'copy-btn', onclick: () => copy(m.content) }, 'Copy')));
  } else {
    wrap.append(el('div', { class: 'bubble' }, m.content));
  }
  return wrap;
}

function renderActivity(a) {
  const box = el('div', { class: 'activity' });
  box.append(el('div', { class: 'stage-line' },
    a.done ? el('span', { style: { color: 'var(--ok)' } }, '✓') : el('span', { class: 'spin' }),
    el('span', { style: { flex: '1' } }, a.stageLabel || 'Working…'),
    a.effort ? el('span', { style: { fontSize: '10px', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.06em' } }, a.effort) : null));
  for (const ag of a.agents) {
    const chip = el('div', { class: 'agent-chip ' + (ag.status || '') });
    chip.append(el('div', { class: 'gl', style: { background: `color-mix(in srgb, ${ag.color} 22%, transparent)`, color: ag.color } }, ag.glyph));
    chip.append(el('div', { style: { minWidth: '0' } }, el('div', {}, ag.name), ag.tool ? el('div', { class: 'tk', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ag.tool + (ag.path ? ' · ' + ag.path : '')) : null));
    const st = el('div', { class: 'st' });
    if (ag.status === 'done') st.append('✓ ' + (ag.ms ? fmtMs(ag.ms) : ''));
    else if (ag.status === 'error') st.append('✗');
    else st.append(el('span', { class: 'pulse' }), 'working');
    chip.append(st);
    box.append(chip);
  }
  if (a.plan) {
    const det = el('details', { style: { padding: '8px 11px', fontSize: '12px', borderTop: '1px solid var(--border-soft)' } });
    det.append(el('summary', { style: { cursor: 'pointer', color: 'var(--muted)' } }, 'Plan'), el('div', { class: 'bubble md', style: { marginTop: '6px' }, html: renderMarkdown(a.plan) }));
    box.append(det);
  }
  return box;
}

/* ---- send ---------------------------------------------------------------- */
export function sendMessage(text) {
  if (!text.trim() || store.streaming) return;
  if (!store.model) { toast('Pick a model first', 'warn'); openModelModal(); return; }

  const userMsg = { role: 'user', content: text.trim() };
  const activity = { stageLabel: 'Starting…', effort: store.effort, agents: [], done: false, plan: '' };
  const assistant = { role: 'assistant', content: '', streaming: true, activity, meta: { model: store.model, provider: store.provider } };
  live = { msg: assistant, activity };
  setState({ messages: [...store.messages, userMsg, assistant], streaming: true }, 'messages');
  setState({ activity, agentTimeline: store.agentTimeline || [] }, 'activity-quiet');

  const subs = store.subagentsOn ? store.subagentCount : 0;
  let changeTimer = null;
  const scheduleRefresh = () => { clearTimeout(changeTimer); changeTimer = setTimeout(() => { refreshTree(); refreshChanges(); }, 400); };

  const findAgent = (id, runId) => activity.agents.find((x) => (runId && x.runId === runId) || (!runId && x.id === id && x.status !== 'done'));
  const pushTimeline = (name, color, text) => { store.agentTimeline = [{ ts: Date.now(), name, color, text }, ...(store.agentTimeline || [])].slice(0, 80); };
  const bumpViews = () => { if ((store.activePath || '').startsWith('view:')) emit('editor', {}); };
  const redrawActivity = () => { if (live?.activityEl) { clear(live.activityEl); live.activityEl.append(renderActivity(activity)); } bumpViews(); };

  session = streamChat({ projectId: store.projectId, message: text.trim(), provider: store.provider, model: store.model, effort: store.effort, subagents: subs }, {
    task: (d) => { assistant.meta.taskId = d.taskId; refreshTasks(); },
    stage: (d) => { activity.stageLabel = d.label || d.stage; redrawActivity(); refreshTasks(); },
    plan: (d) => { activity.plan = d.plan; redrawActivity(); },
    agent_start: (d) => { activity.agents.push({ id: d.agentId, runId: d.runId, name: d.name, glyph: d.glyph, color: d.color, status: 'running' }); pushTimeline(d.name, d.color, 'started'); redrawActivity(); },
    tool: (d) => { const a = findAgent(d.agentId, d.runId); if (a) { a.tool = d.tool; a.path = d.path; } pushTimeline(d.name || (a && a.name) || 'agent', a?.color, `${d.tool} ${d.path || ''}`); redrawActivity(); },
    change: () => scheduleRefresh(),
    terminal: (d) => { termPush([{ type: 'cmd', text: d.command }, ...(d.stdout ? [{ type: 'out', text: d.stdout.replace(/\n$/, '') }] : []), ...(d.stderr ? [{ type: 'er', text: d.stderr.replace(/\n$/, '') }] : []), { type: 'meta', text: `exit ${d.code} · ${d.ms}ms` }]); },
    browse: (d) => { if (d.kind === 'fetch') setState({ browser: { url: d.url, result: { url: d.url, title: d.title, text: '(opened by Research Agent)' }, mode: 'page' } }, 'browser'); },
    agent_delta: () => {},
    agent_done: (d) => { const a = findAgent(d.agentId, d.runId); if (a) { a.status = 'done'; a.ms = d.ms; a.tool = null; } pushTimeline(d.name, a?.color, `done · ${d.changes || 0} changes`); redrawActivity(); },
    agent_error: (d) => { const a = findAgent(d.agentId, d.runId); if (a) { a.status = 'error'; } pushTimeline(d.name, 'var(--err)', 'error: ' + d.error); redrawActivity(); },
    token: (d) => {
      assistant.content += d.delta;
      if (live?.bubbleEl) { live.bubbleEl.innerHTML = renderMarkdown(assistant.content); const sc = document.getElementById('chat-scroll'); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 200) sc.scrollTop = sc.scrollHeight; }
    },
    done: (d) => {
      activity.done = true; activity.stageLabel = `Done · ${fmtMs(d.ms)} · ${d.subagents?.length || 0} subagents · ${d.changes?.length || 0} changes`;
      redrawActivity();
    },
    error: (d) => {
      assistant.content += (assistant.content ? '\n\n' : '') + '⚠️ ' + d.error;
      activity.done = true; activity.stageLabel = 'Error';
      if (live?.bubbleEl) live.bubbleEl.innerHTML = renderMarkdown(assistant.content);
      redrawActivity();
    },
    close: () => {
      assistant.streaming = false; live = null; session = null;
      if (!assistant.content) assistant.content = '_(no response — the model returned nothing. Try again or lower the subagent count.)_';
      setState({ streaming: false }, 'messages');
      refreshTree(); refreshChanges(); refreshTasks();
    },
  });
}

export function stopStream() { if (session) { session.abort(); toast('Stopped', 'warn'); } }

/* ---- composer + controls ------------------------------------------------- */
function renderComposer() {
  const c = document.getElementById('composer');
  clear(c);
  const modelName = currentModelName();

  const ctlRow = el('div', { class: 'ctl-row' });
  // model
  ctlRow.append(el('button', { class: 'pill model', title: 'Switch model (⌘K)', onclick: openModelModal },
    el('span', { class: 'lbl' }, providerLabel()), el('span', { class: 'nm' }, modelName)));
  c.append(ctlRow);

  // effort segmented
  const effRow = el('div', { class: 'ctl-row' });
  const seg = el('div', { class: 'seg' });
  for (const e of (store.config?.efforts || [])) seg.append(el('button', { class: store.effort === e.id ? 'on' : '', title: e.blurb, onclick: () => setEffort(e.id) }, e.glyph + ' ' + e.label));
  effRow.append(el('span', { class: 'lbl', style: { color: 'var(--muted)', fontSize: '11px' } }, 'Effort'), seg);
  c.append(effRow);

  // subagent switch + stepper
  const subRow = el('div', { class: 'ctl-row' });
  const tgl = el('div', { class: 'toggle' + (store.subagentsOn ? ' on' : '') });
  tgl.addEventListener('click', () => setSubagents(!store.subagentsOn, null));
  subRow.append(el('span', { class: 'switch' }, tgl, 'Subagents'));
  const stepper = el('div', { class: 'subagent-stepper' });
  stepper.append(
    el('button', { disabled: !store.subagentsOn || store.subagentCount <= 1, onclick: () => setSubagents(null, store.subagentCount - 1) }, '−'),
    el('span', { class: 'cnt' }, String(store.subagentCount)),
    el('button', { disabled: !store.subagentsOn || store.subagentCount >= 6, onclick: () => setSubagents(null, store.subagentCount + 1) }, '+'),
    el('span', { style: { fontSize: '11px', color: 'var(--muted)' } }, 'to summon'));
  stepper.style.opacity = store.subagentsOn ? '1' : '.4';
  subRow.append(stepper);
  c.append(subRow);

  // input box
  const box = el('div', { class: 'box' });
  const ta = el('textarea', { id: 'composer-input', rows: '1', placeholder: 'Ask Aurel to build something…' });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; });
  ta.addEventListener('keydown', (e) => {
    const sendOnEnter = store.settings.general.sendOnEnter;
    if (e.key === 'Enter' && ((sendOnEnter && !e.shiftKey) || (!sendOnEnter && (e.metaKey || e.ctrlKey)))) {
      e.preventDefault(); const v = ta.value; ta.value = ''; ta.style.height = 'auto'; sendMessage(v);
    }
  });
  const btn = el('button', { class: 'send-btn' + (store.streaming ? ' stop' : ''), title: store.streaming ? 'Stop' : 'Send', html: store.streaming ? icon('x') : icon('send') });
  btn.addEventListener('click', () => { if (store.streaming) stopStream(); else { const v = ta.value; ta.value = ''; ta.style.height = 'auto'; sendMessage(v); } });
  box.append(ta, btn);
  c.append(box);
}

function currentModelName() {
  const idx = store.config?.models;
  if (!idx || !store.model) return 'Select model';
  for (const p of idx.providers) { const m = p.models.find((x) => x.id === store.model); if (m) return m.name; }
  return store.model;
}
function providerLabel() {
  const p = store.config?.models?.providers.find((x) => x.id === store.provider);
  return p ? p.label : 'Model';
}
