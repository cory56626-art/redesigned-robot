// Thin API client for the Aurel backend, including the SSE chat stream.
let TOKEN = localStorage.getItem('aurel.token') || null;
export function setToken(t) { TOKEN = t; if (t) localStorage.setItem('aurel.token', t); else localStorage.removeItem('aurel.token'); }
export function getToken() { return TOKEN; }

async function req(method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  health: () => req('GET', '/api/health'),
  config: () => req('GET', '/api/config'),
  models: (force) => req('GET', '/api/models' + (force ? '?force=1' : '')),

  signup: (b) => req('POST', '/api/auth/signup', b),
  signin: (b) => req('POST', '/api/auth/signin', b),
  signout: () => req('POST', '/api/auth/signout'),
  me: () => req('GET', '/api/auth/me'),
  savePrefs: (prefs) => req('PUT', '/api/auth/prefs', { prefs }),

  projects: () => req('GET', '/api/projects'),
  createProject: (name) => req('POST', '/api/projects', { name }),
  renameProject: (id, name) => req('PATCH', `/api/projects/${id}`, { name }),
  deleteProject: (id) => req('DELETE', `/api/projects/${id}`),
  memory: (id) => req('GET', `/api/projects/${id}/memory`),

  tree: (pid) => req('GET', `/api/sandbox/${pid}/tree`),
  changes: (pid) => req('GET', `/api/sandbox/${pid}/changes`),
  readFile: (pid, path) => req('GET', `/api/sandbox/${pid}/file?path=${encodeURIComponent(path)}`),
  writeFile: (pid, path, content, base64) => req('POST', `/api/sandbox/${pid}/file`, { path, content, base64 }),
  mkdir: (pid, path) => req('POST', `/api/sandbox/${pid}/mkdir`, { path }),
  del: (pid, path) => req('POST', `/api/sandbox/${pid}/delete`, { path }),
  move: (pid, from, to) => req('POST', `/api/sandbox/${pid}/move`, { from, to }),
  rename: (pid, from, newName) => req('POST', `/api/sandbox/${pid}/rename`, { from, newName }),
  search: (pid, q, opts = {}) => req('GET', `/api/sandbox/${pid}/search?q=${encodeURIComponent(q)}&regex=${opts.regex ? 1 : 0}&cs=${opts.cs ? 1 : 0}`),
  replace: (pid, b) => req('POST', `/api/sandbox/${pid}/replace`, b),
  exec: (pid, command) => req('POST', `/api/sandbox/${pid}/exec`, { command }),

  browseFetch: (url) => req('POST', '/api/browse/fetch', { url }),
  browseSearch: (query) => req('POST', '/api/browse/search', { query }),

  tasks: (projectId) => req('GET', '/api/tasks' + (projectId ? `?projectId=${projectId}` : '')),
  taskControl: (id, action) => req('POST', `/api/tasks/${id}/control`, { action }),
  logs: (since = 0) => req('GET', `/api/logs?since=${since}`),
};

// Streaming chat. Returns { abort }. Calls handlers[event](data).
export function streamChat(payload, handlers) {
  const controller = new AbortController();
  (async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
    let res;
    try {
      res = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    } catch (e) {
      if (!controller.signal.aborted) handlers.error?.({ error: e.message });
      handlers.close?.();
      return;
    }
    if (!res.ok || !res.body) { handlers.error?.({ error: 'chat request failed (' + res.status + ')' }); handlers.close?.(); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      let chunk;
      try { chunk = await reader.read(); } catch { break; }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop() || '';
      for (const frame of frames) {
        let event = 'message', data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data && event === 'message') continue;
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch { /* keep {} */ }
        handlers[event]?.(parsed);
      }
    }
    handlers.close?.();
  })();
  return { abort: () => controller.abort() };
}
