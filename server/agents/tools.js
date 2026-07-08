// Tool protocol shared by actor agents. Agents emit fenced ```action blocks; we parse,
// execute against the sandbox / browser, and feed observations back.
import { webFetch, webSearch } from '../services/browse.js';

export const TOOL_DOCS = (canBrowse) =>
`You act by emitting one or more action blocks. Each block is fenced exactly like:

\`\`\`action
{ "tool": "write_file", "path": "src/index.js", "content": "console.log('hi')\\n" }
\`\`\`

Available tools:
- write_file   { "path", "content" }            create or overwrite a file
- read_file    { "path" }                       read a file's contents
- edit_file    { "path", "find", "replace" }    replace the first occurrence of "find"
- delete_file  { "path" }                        delete a file or folder
- rename       { "from", "to" }                  rename/move a file
- mkdir        { "path" }                        create a folder
- search       { "query" }                       search file contents in the sandbox
- run          { "command" }                     run a shell command in the sandbox${canBrowse ? `
- web_search   { "query" }                       search the web
- web_fetch    { "url" }                          fetch and read a web page` : ''}
- done         { "summary" }                     finish; provide a one-line summary

Rules: emit real JSON (double quotes, escaped newlines). You may emit several action blocks per turn.
After each turn you will receive the observations. Keep going until the task is complete, then emit a "done" action.`;

const BLOCK_RE = /```(?:action|json|aurel)?\s*\n([\s\S]*?)```/gi;

export function parseActions(text) {
  const actions = [];
  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text))) {
    const body = m[1].trim();
    try {
      const obj = JSON.parse(body);
      if (obj && obj.tool) actions.push(obj);
    } catch {
      // Tolerate multiple concatenated JSON objects in one block.
      for (const chunk of body.split(/\n(?=\{)/)) {
        try { const o = JSON.parse(chunk); if (o.tool) actions.push(o); } catch { /* skip */ }
      }
    }
  }
  return actions;
}

export async function runTool(action, { sandbox, emit }) {
  const { tool } = action;
  const changes = [];
  try {
    switch (tool) {
      case 'write_file': {
        const r = await sandbox.write(action.path, action.content ?? '');
        changes.push({ op: r.created ? 'create' : 'edit', path: r.path });
        return { ok: true, result: `${r.created ? 'created' : 'updated'} ${r.path} (${r.size} bytes)`, changes };
      }
      case 'read_file': {
        const r = await sandbox.read(action.path);
        return { ok: true, result: r.binary ? `[binary ${r.size} bytes]` : r.content.slice(0, 6000) };
      }
      case 'edit_file': {
        const r = await sandbox.read(action.path);
        if (r.binary) return { ok: false, result: 'cannot edit binary file' };
        if (!r.content.includes(action.find)) return { ok: false, result: `"find" text not present in ${action.path}` };
        const next = r.content.replace(action.find, action.replace ?? '');
        await sandbox.write(action.path, next);
        changes.push({ op: 'edit', path: action.path });
        return { ok: true, result: `edited ${action.path}`, changes };
      }
      case 'delete_file': {
        await sandbox.remove(action.path);
        changes.push({ op: 'delete', path: action.path });
        return { ok: true, result: `deleted ${action.path}`, changes };
      }
      case 'rename':
      case 'move': {
        await sandbox.move(action.from, action.to);
        changes.push({ op: 'move', path: action.to, from: action.from });
        return { ok: true, result: `moved ${action.from} → ${action.to}`, changes };
      }
      case 'mkdir': {
        await sandbox.mkdir(action.path);
        changes.push({ op: 'mkdir', path: action.path });
        return { ok: true, result: `created folder ${action.path}`, changes };
      }
      case 'search': {
        const hits = await sandbox.search(action.query, { maxResults: 30 });
        return { ok: true, result: hits.length ? hits.map((h) => `${h.path}:${h.line}: ${h.text.trim()}`).join('\n') : 'no matches' };
      }
      case 'run': {
        const { runCommand } = await import('../sandbox/exec.js');
        const r = await runCommand(sandbox, action.command, { timeout: 20000 });
        if (emit) emit('terminal', { command: r.command, stdout: r.stdout, stderr: r.stderr, code: r.code, ms: r.ms });
        return { ok: r.code === 0, result: `$ ${r.command}\n(exit ${r.code}, ${r.ms}ms)\n${(r.stdout || '') + (r.stderr ? '\n' + r.stderr : '')}`.slice(0, 4000) };
      }
      case 'web_search': {
        const r = await webSearch(action.query);
        if (emit) emit('browse', { kind: 'search', query: action.query, results: r.results });
        return { ok: true, result: (r.results || []).map((x, i) => `${i + 1}. ${x.title} — ${x.url}`).join('\n') || r.note || 'no results' };
      }
      case 'web_fetch': {
        const r = await webFetch(action.url);
        if (emit) emit('browse', { kind: 'fetch', url: r.url, title: r.title, status: r.status });
        return { ok: !r.error, result: `# ${r.title || r.url}\n${r.text}` };
      }
      case 'done':
        return { ok: true, done: true, result: action.summary || 'done' };
      default:
        return { ok: false, result: `unknown tool: ${tool}` };
    }
  } catch (e) {
    return { ok: false, result: `error: ${e.message}` };
  }
}
