// The delegation engine. Given a message, effort and a subagent count, it plans,
// summons specialized subagents (real parallel model calls), lets actor agents mutate
// the sandbox through the tool loop, then synthesizes a final streamed answer.
import { chat } from '../providers/index.js';
import { providerById } from '../config.js';
import { AGENTS, ROUTE_HINTS, PIPELINE_ORDER } from './catalog.js';
import { getEffort, reasoningPreamble } from './effort.js';
import { TOOL_DOCS, parseActions, runTool } from './tools.js';
import { getSandbox } from '../sandbox/sandbox.js';
import { uid } from '../utils/id.js';
import { logger } from '../utils/logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- low level model call with effort-driven retries -----------------------
async function callModel({ provider, model, system, messages, temperature, maxTokens = 2048, onDelta, retries = 0, signal }) {
  const prov = providerById(provider);
  if (!prov) throw new Error(`Provider "${provider}" is not configured.`);
  const full = system ? [{ role: 'system', content: system }, ...messages] : messages;
  // Rate-limit (429) and transient (502/503/504) errors are always retried a few
  // times with the server-provided delay — parallel subagents share a TPM budget.
  const transientBudget = 6;
  let lastErr;
  let attempt = 0, transientUsed = 0;
  while (true) {
    try {
      return await chat(prov, { model, messages: full, temperature, maxTokens, stream: !!onDelta, onDelta, signal });
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      const transient = e.status === 429 || (e.status >= 500 && e.status <= 504);
      const canRetry = transient ? transientUsed < transientBudget : attempt < retries;
      logger.warn('orchestrator', `model call failed${transient ? ' (transient)' : ''}`, { model, status: e.status, err: e.message.slice(0, 120) });
      if (!canRetry) break;
      const wait = transient ? Math.max(e.retryAfter || 0, 700) + Math.random() * 500 : 400 * (attempt + 1);
      await sleep(wait);
      if (transient) transientUsed++; else attempt++;
    }
  }
  throw lastErr;
}

// --- routing: pick N subagents ---------------------------------------------
export function routeAgents(message, count) {
  if (count <= 0) return [];
  const scores = new Map();
  for (const a of Object.keys(AGENTS)) scores.set(a, 0);
  scores.set('coder', 1); // baseline: most requests involve code
  for (const { agent, re } of ROUTE_HINTS) if (re.test(message)) scores.set(agent, (scores.get(agent) || 0) + 3);
  // researcher only if clearly needed
  if (!/\b(research|browse|search the web|look up|latest|docs?|documentation|compare|api of)\b/i.test(message)) scores.set('researcher', scores.get('researcher') - 5);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const picked = [];
  for (const a of ranked) { if (picked.length >= count) break; if (scores.get(a) > -4) picked.push(a); }
  while (picked.length < count) { const nxt = PIPELINE_ORDER.find((a) => !picked.includes(a)); if (!nxt) break; picked.push(nxt); }
  // order by pipeline for sensible execution
  return picked.sort((a, b) => PIPELINE_ORDER.indexOf(a) - PIPELINE_ORDER.indexOf(b)).slice(0, count);
}

// --- actor agent: tool loop ------------------------------------------------
async function runActor(agent, { task, context, sandbox, effort, provider, model, emit, runId, signal }) {
  const canBrowse = !!agent.browse;
  const system = `${agent.system}\n\n${reasoningPreamble(effort)}\n\n${TOOL_DOCS(canBrowse)}`;
  const messages = [{ role: 'user', content: `${context}\n\nYour subtask:\n${task}` }];
  const changes = [];
  let summary = '';
  let transcript = '';

  for (let turn = 0; turn < effort.toolIterations; turn++) {
    let buf = '';
    const r = await callModel({
      provider, model, system, messages, signal,
      temperature: effort.temperature, maxTokens: 2600, retries: effort.retries,
      onDelta: (d) => { buf += d; emit('agent_delta', { runId, agentId: agent.id, delta: d }); },
    });
    transcript += (r.text || buf) + '\n';
    messages.push({ role: 'assistant', content: r.text || buf });
    const actions = parseActions(r.text || buf);
    if (!actions.length) { summary = (r.text || buf).slice(-600); break; }

    const observations = [];
    for (const action of actions) {
      emit('tool', { runId, agentId: agent.id, tool: action.tool, path: action.path || action.url || action.command || action.query || '' });
      const res = await runTool(action, { sandbox, emit });
      if (res.changes) for (const c of res.changes) { changes.push(c); emit('change', c); }
      if (action.tool === 'done') { summary = action.summary || res.result; observations.push({ tool: 'done', result: 'ok' }); }
      else observations.push({ tool: action.tool, ok: res.ok, result: res.result });
    }
    if (actions.some((a) => a.tool === 'done')) break;
    messages.push({ role: 'user', content: 'Observations:\n' + observations.map((o) => `[${o.tool}] ${o.ok === false ? '(failed) ' : ''}${o.result}`).join('\n\n') });
  }
  if (!summary) summary = transcript.slice(-600).trim();
  return { agentId: agent.id, name: agent.name, summary, changes, transcript: transcript.slice(-4000) };
}

// --- analyst agent: single streamed call -----------------------------------
async function runAnalyst(agent, { task, context, effort, provider, model, emit, runId, signal }) {
  const system = `${agent.system}\n\n${reasoningPreamble(effort)}`;
  let buf = '';
  const r = await callModel({
    provider, model, system, signal,
    messages: [{ role: 'user', content: `${context}\n\nYour task:\n${task}` }],
    temperature: effort.temperature, maxTokens: 1800, retries: effort.retries,
    onDelta: (d) => { buf += d; emit('agent_delta', { runId, agentId: agent.id, delta: d }); },
  });
  return { agentId: agent.id, name: agent.name, summary: (r.text || buf).trim(), changes: [], transcript: (r.text || buf).trim() };
}

async function runAgent(agentId, opts) {
  const agent = AGENTS[agentId];
  const runId = uid('run');
  const started = Date.now();
  opts.emit('agent_start', { runId, agentId, name: agent.name, glyph: agent.glyph, color: agent.color, actor: !!agent.actor });
  logger.agent('orchestrator', `▶ ${agent.name}`, { task: opts.task?.slice(0, 80) });
  try {
    const result = agent.actor
      ? await runActor(agent, { ...opts, runId })
      : await runAnalyst(agent, { ...opts, runId });
    opts.emit('agent_done', { runId, agentId, name: agent.name, ms: Date.now() - started, summary: result.summary?.slice(0, 400), changes: result.changes.length });
    logger.agent('orchestrator', `✓ ${agent.name}`, { ms: Date.now() - started, changes: result.changes.length });
    return { ...result, runId, ms: Date.now() - started, ok: true };
  } catch (e) {
    opts.emit('agent_error', { runId, agentId, name: agent.name, error: e.message });
    logger.error('orchestrator', `✗ ${agent.name}: ${e.message}`);
    return { agentId, name: agent.name, summary: `failed: ${e.message}`, changes: [], ok: false, ms: Date.now() - started };
  }
}

// Simple concurrency pool honoring effort.parallelism.
async function pool(items, limit, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return out;
}

// --- main entry ------------------------------------------------------------
export async function orchestrate({ projectId, message, history = [], provider, model, effortId, subagentCount, emit, control, signal, onProgress }) {
  const effort = getEffort(effortId);
  const sandbox = getSandbox(projectId || 'default');
  const t0 = Date.now();
  const gate = async () => { if (control) await control.gate(); };
  const progress = (p, stage) => { if (onProgress) onProgress(p, stage); };
  emit('stage', { stage: 'understanding', label: 'Understanding the request', effort: effort.id, model, provider });
  progress(5, 'understanding');
  await gate();

  const tree = await sandbox.tree();
  const fileList = flattenTree(tree).slice(0, 60);
  const context =
`Project sandbox files (${fileList.length}):\n${fileList.map((f) => '- ' + f).join('\n') || '(empty)'}\n\n` +
`Conversation so far:\n${history.slice(-4).map((h) => `${h.role}: ${h.content}`).join('\n') || '(none)'}\n\n` +
`User request:\n${message}`;

  let plan = '';
  const workerResults = [];

  if (subagentCount > 0) {
    // 1. Planning phase (depth from effort)
    if (effort.planningDepth >= 1) {
      emit('stage', { stage: 'planning', label: `Planning (${effort.label})` });
      progress(15, 'planning');
      const p = await runAgent('planner', { task: `Produce a ${effort.planningDepth >= 3 ? 'detailed' : 'concise'} plan to satisfy the request. It will be split across ${subagentCount} subagents.`, context, effort, provider, model, emit, signal });
      plan = p.summary;
      emit('plan', { plan });
    }
    await gate();

    // 2. Route + delegate to subagents in parallel
    const selected = routeAgents(message, subagentCount);
    emit('stage', { stage: 'delegating', label: `Delegating to ${selected.length} subagent${selected.length > 1 ? 's' : ''}`, agents: selected.map((id) => ({ id, name: AGENTS[id].name, glyph: AGENTS[id].glyph, color: AGENTS[id].color })) });
    progress(30, 'delegating');

    const delegCtx = plan ? `${context}\n\nAgreed plan:\n${plan}` : context;
    const results = await pool(selected, effort.parallelism, (agentId) =>
      runAgent(agentId, {
        task: `As the ${AGENTS[agentId].name}, carry out your part of the request. Focus only on your specialty.`,
        context: delegCtx, sandbox, effort, provider, model, emit, signal,
      }));
    workerResults.push(...results);
    progress(65, 'delegating');
    await gate();

    // 3. Effort-driven validation & review passes (orchestration overhead)
    if (effort.validate && !selected.includes('tester') && workerResults.some((r) => r.changes.length)) {
      emit('stage', { stage: 'validating', label: 'Validating with the Testing Agent' });
      workerResults.push(await runAgent('tester', { task: 'Validate the implementation: write/run quick tests or execute the code, and report results.', context: delegCtx, sandbox, effort, provider, model, emit, signal }));
    }
    for (let pass = 0; pass < effort.reviewPasses; pass++) {
      if (selected.includes('reviewer') && pass === 0) continue;
      await gate();
      emit('stage', { stage: 'reviewing', label: `Review pass ${pass + 1}/${effort.reviewPasses}` });
      const changed = flattenTree(await sandbox.tree()).slice(0, 40).join('\n');
      workerResults.push(await runAgent('reviewer', { task: `Review pass ${pass + 1}. Audit the current sandbox state:\n${changed}`, context: delegCtx, sandbox, effort, provider, model, emit, signal }));
    }
  }

  // 4. Synthesis — final streamed answer to the chat
  await gate();
  progress(85, 'synthesizing');
  emit('stage', { stage: 'synthesizing', label: subagentCount > 0 ? 'Merging subagent results' : 'Responding' });

  const changes = workerResults.flatMap((r) => r.changes);
  let synthSystem;
  let synthUser;
  if (subagentCount > 0) {
    synthSystem =
`You are the lead orchestrator agent. You delegated work to specialized subagents and must now merge their results into a single, coherent final answer for the user. Be direct and useful. Reference concrete files that were created/edited. Write ONLY a natural-language answer with normal Markdown — never output \`\`\`action blocks or raw tool-call JSON. ${reasoningPreamble(effort)} ${effort.synthDepth === 'short' ? 'Keep it brief.' : effort.synthDepth === 'rich' ? 'Give a thorough, well-structured answer with sections where useful.' : 'Be clear and reasonably complete.'}`;
    synthUser =
`User request:\n${message}\n\n${plan ? `Plan:\n${plan}\n\n` : ''}Subagent results:\n` +
workerResults.map((r) => `## ${r.name}\n${r.summary}`).join('\n\n') +
`\n\nFile changes made: ${changes.length ? changes.map((c) => `${c.op} ${c.path}`).join(', ') : 'none'}\n\nWrite the final response to the user.`;
  } else {
    // Solo path — main agent can still use tools, then answer.
    emit('agent_start', { runId: 'solo', agentId: 'coder', name: 'Main Agent', glyph: '⌘', color: '#7c8bff', actor: true });
    const solo = await runActor(AGENTS.coder, {
      task: message, context, sandbox, effort,
      provider, model, emit, runId: 'solo', signal,
    });
    emit('agent_done', { runId: 'solo', agentId: 'coder', name: 'Main Agent', ms: Date.now() - t0, summary: solo.summary?.slice(0, 400), changes: solo.changes.length });
    changes.push(...solo.changes);
    synthSystem = `You are the main AI coding assistant. Summarize what you did and answer the user directly in natural language with normal Markdown. Never output \`\`\`action blocks or raw tool-call JSON. ${reasoningPreamble(effort)}`;
    synthUser = `User request:\n${message}\n\nWork log:\n${solo.summary}\n\nFile changes: ${solo.changes.map((c) => `${c.op} ${c.path}`).join(', ') || 'none'}\n\nWrite the final response.`;
  }

  let finalText = '';
  const r = await callModel({
    provider, model, system: synthSystem, signal,
    messages: [{ role: 'user', content: synthUser }],
    temperature: effort.temperature, maxTokens: effort.synthDepth === 'rich' ? 3000 : 1600, retries: effort.retries,
    onDelta: (d) => { finalText += d; emit('token', { delta: d }); },
  });
  finalText = finalText || r.text || '';

  const summary = {
    ms: Date.now() - t0, effort: effort.id, model, provider,
    subagents: workerResults.map((w) => ({ id: w.agentId, name: w.name, ms: w.ms, changes: w.changes.length, ok: w.ok })),
    changes, usage: r.usage || null,
  };
  emit('done', summary);
  logger.agent('orchestrator', `■ complete`, { ms: summary.ms, subagents: workerResults.length, changes: changes.length });
  return { finalText, ...summary };
}

function flattenTree(nodes, prefix = '') {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'dir') out.push(...flattenTree(n.children, prefix));
    else out.push(n.path);
  }
  return out;
}
