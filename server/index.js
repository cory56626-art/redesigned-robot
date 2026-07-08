// Aurel backend: static hosting + JSON/SSE API tying together providers, models,
// the sandbox, the multi-agent orchestrator, tasks, memory and auth.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, WEB_DIR, installTransport, activeProviders } from './config.js';
import { json, readBody, sseStart } from './utils/http.js';
import { logger, recentLogs } from './utils/logger.js';
import { getModelIndex } from './models/registry.js';
import { EFFORT_LIST } from './agents/effort.js';
import { AGENT_LIST } from './agents/catalog.js';
import { orchestrate } from './agents/orchestrator.js';
import { getSandbox } from './sandbox/sandbox.js';
import { runCommand } from './sandbox/exec.js';
import { webFetch, webSearch } from './services/browse.js';
import * as auth from './services/auth.js';
import * as ws from './services/workspace.js';
import * as taskSvc from './services/tasks.js';

const transport = installTransport();
logger.info('server', 'transport ready', transport);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const abs = path.join(WEB_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(WEB_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(abs, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(WEB_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const routes = [];
const on = (method, pattern, handler) => routes.push({ method, pattern, handler });
function match(pattern, pathname) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  const m = pathname.match(re);
  if (!m) return null;
  const params = {};
  keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  return params;
}

// ---- health / config -------------------------------------------------------
on('GET', '/api/health', async (req, res) => {
  json(res, 200, { ok: true, providers: activeProviders().map((p) => ({ id: p.id, label: p.label })), proxy: !!transport.proxy });
});

on('GET', '/api/config', async (req, res) => {
  const models = await getModelIndex();
  json(res, 200, {
    models,
    efforts: EFFORT_LIST,
    agents: AGENT_LIST.map((a) => ({ id: a.id, name: a.name, glyph: a.glyph, color: a.color, tagline: a.tagline, actor: !!a.actor, browse: !!a.browse })),
    projects: ws.listProjects(),
  });
});

on('GET', '/api/models', async (req, res, _p, query) => {
  json(res, 200, await getModelIndex({ force: query.get('force') === '1' }));
});

// ---- auth ------------------------------------------------------------------
on('POST', '/api/auth/signup', async (req, res) => { try { json(res, 200, auth.createAccount(await readBody(req))); } catch (e) { json(res, 400, { error: e.message }); } });
on('POST', '/api/auth/signin', async (req, res) => { try { json(res, 200, auth.signIn(await readBody(req))); } catch (e) { json(res, 401, { error: e.message }); } });
on('POST', '/api/auth/signout', async (req, res) => { auth.signOut(bearer(req)); json(res, 200, { ok: true }); });
on('GET', '/api/auth/me', async (req, res) => { json(res, 200, { user: auth.userForToken(bearer(req)) }); });
on('PUT', '/api/auth/prefs', async (req, res) => {
  const user = auth.userForToken(bearer(req));
  if (!user) return json(res, 401, { error: 'not signed in' });
  json(res, 200, { user: auth.updatePrefs(user.id, (await readBody(req)).prefs || {}) });
});

// ---- projects / memory -----------------------------------------------------
on('GET', '/api/projects', async (req, res) => json(res, 200, { projects: ws.listProjects() }));
on('POST', '/api/projects', async (req, res) => json(res, 200, ws.createProject((await readBody(req)).name)));
on('PATCH', '/api/projects/:id', async (req, res, p) => json(res, 200, ws.renameProject(p.id, (await readBody(req)).name)));
on('DELETE', '/api/projects/:id', async (req, res, p) => { ws.deleteProject(p.id); json(res, 200, { ok: true }); });
on('GET', '/api/projects/:id/memory', async (req, res, p) => json(res, 200, ws.getMemory(p.id)));

// ---- sandbox ---------------------------------------------------------------
on('GET', '/api/sandbox/:pid/tree', async (req, res, p) => json(res, 200, { tree: await getSandbox(p.pid).tree() }));
on('GET', '/api/sandbox/:pid/changes', async (req, res, p) => json(res, 200, { changes: getSandbox(p.pid).changes().slice(-200).reverse() }));
on('GET', '/api/sandbox/:pid/file', async (req, res, p, q) => {
  try { json(res, 200, await getSandbox(p.pid).read(q.get('path'))); } catch (e) { json(res, 404, { error: e.message }); }
});
on('POST', '/api/sandbox/:pid/file', async (req, res, p) => {
  const b = await readBody(req);
  try { json(res, 200, await getSandbox(p.pid).write(b.path, b.content ?? '', { base64: !!b.base64 })); } catch (e) { json(res, 400, { error: e.message }); }
});
on('POST', '/api/sandbox/:pid/mkdir', async (req, res, p) => { const b = await readBody(req); try { json(res, 200, await getSandbox(p.pid).mkdir(b.path)); } catch (e) { json(res, 400, { error: e.message }); } });
on('POST', '/api/sandbox/:pid/delete', async (req, res, p) => { const b = await readBody(req); try { json(res, 200, await getSandbox(p.pid).remove(b.path)); } catch (e) { json(res, 400, { error: e.message }); } });
on('POST', '/api/sandbox/:pid/move', async (req, res, p) => { const b = await readBody(req); try { json(res, 200, await getSandbox(p.pid).move(b.from, b.to)); } catch (e) { json(res, 400, { error: e.message }); } });
on('POST', '/api/sandbox/:pid/rename', async (req, res, p) => { const b = await readBody(req); try { json(res, 200, await getSandbox(p.pid).rename(b.from, b.newName)); } catch (e) { json(res, 400, { error: e.message }); } });
on('GET', '/api/sandbox/:pid/search', async (req, res, p, q) => {
  json(res, 200, { results: await getSandbox(p.pid).search(q.get('q') || '', { regex: q.get('regex') === '1', caseSensitive: q.get('cs') === '1' }) });
});
on('POST', '/api/sandbox/:pid/replace', async (req, res, p) => {
  const b = await readBody(req);
  json(res, 200, await getSandbox(p.pid).replaceAll(b.query, b.replacement ?? '', { regex: !!b.regex, caseSensitive: !!b.caseSensitive }));
});
on('POST', '/api/sandbox/:pid/exec', async (req, res, p) => {
  const b = await readBody(req);
  const result = await runCommand(getSandbox(p.pid), b.command, { timeout: b.timeout || 20000 });
  json(res, 200, result);
});

// ---- browser ---------------------------------------------------------------
on('POST', '/api/browse/fetch', async (req, res) => { const b = await readBody(req); json(res, 200, await webFetch(b.url)); });
on('POST', '/api/browse/search', async (req, res) => { const b = await readBody(req); json(res, 200, await webSearch(b.query)); });

// ---- tasks -----------------------------------------------------------------
on('GET', '/api/tasks', async (req, res, _p, q) => json(res, 200, { tasks: taskSvc.listTasks(q.get('projectId')) }));
on('POST', '/api/tasks/:id/control', async (req, res, p) => json(res, 200, taskSvc.control(p.id, (await readBody(req)).action)));

// ---- logs ------------------------------------------------------------------
on('GET', '/api/logs', async (req, res, _p, q) => json(res, 200, { logs: recentLogs(Number(q.get('since') || 0), q.get('level') || null) }));

// ---- chat (SSE over POST) --------------------------------------------------
on('POST', '/api/chat', async (req, res) => {
  const b = await readBody(req);
  const projectId = b.projectId || 'default';
  const message = String(b.message || '').trim();
  if (!message) return json(res, 400, { error: 'empty message' });

  const provider = b.provider;
  const model = b.model;
  const effortId = b.effort || 'medium';
  const subagentCount = Math.max(0, Math.min(6, Number(b.subagents ?? 0)));

  ws.appendHistory(projectId, 'user', message);
  const { signal, control, update, finish, fail, task } = taskSvc.createTask({
    title: message.slice(0, 60), projectId, kind: 'chat',
  });

  const sse = sseStart(res);
  sse.send('task', { taskId: task.id });
  let closed = false;
  req.on('close', () => { closed = true; if (task.status === 'running' || task.status === 'paused') taskSvc.control(task.id, 'cancel'); });

  const emit = (event, data) => { if (!closed) sse.send(event, data); };
  try {
    const result = await orchestrate({
      projectId, message, history: ws.getMemory(projectId).history.slice(-8),
      provider, model, effortId, subagentCount, emit, control, signal,
      onProgress: (p, stage) => update(task.id, { progress: p, stage }),
    });
    ws.appendHistory(projectId, 'assistant', result.finalText, { model, provider, effort: effortId, changes: result.changes.length });
    ws.recordAgentContext(projectId, { message: message.slice(0, 120), subagents: result.subagents, changes: result.changes.length, ms: result.ms });
    finish({ stage: 'done', log: `completed in ${result.ms}ms` });
    sse.end();
  } catch (e) {
    logger.error('chat', e.message);
    fail(e.message);
    emit('error', { error: e.message });
    sse.end();
  }
});

// ---- server ----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const params = match(r.pattern, pathname);
        if (params) return await r.handler(req, res, params, url.searchParams);
      }
      return json(res, 404, { error: 'no such endpoint', path: pathname });
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    logger.error('server', e.message, { path: pathname });
    if (!res.headersSent) json(res, 500, { error: e.message });
    else try { res.end(); } catch { /* noop */ }
  }
});

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

server.listen(PORT, () => {
  logger.info('server', `Aurel listening on http://localhost:${PORT}`);
  const provs = activeProviders();
  logger.info('server', `${provs.length} providers configured: ${provs.map((p) => p.label).join(', ')}`);
  getModelIndex().then((idx) => logger.info('server', `model index warm: ${idx.total} models`)).catch((e) => logger.warn('server', 'model warm failed', { err: e.message }));
});
