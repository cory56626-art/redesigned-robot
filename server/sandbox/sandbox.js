// Isolated per-project sandbox. All file operations are confined to the project root,
// every mutation is recorded in a change log, and commands run with a timeout.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { uid } from '../utils/id.js';
import { logger } from '../utils/logger.js';

const SANDBOX_ROOT = path.join(DATA_DIR, 'sandboxes');
const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'woff', 'woff2', 'ttf', 'mp3', 'mp4', 'wasm']);
// Tool/exec side-effect dirs (HOME points at the sandbox) — kept on disk but hidden from the tree.
const HIDE = new Set(['.git', '.cache', '.rustup', '.cargo', '.npm', '.config', '.local', 'node_modules', '.bun', '.python_history']);

export class Sandbox {
  constructor(projectId) {
    this.id = projectId;
    this.root = path.join(SANDBOX_ROOT, projectId, 'files');
    this.changeFile = path.join(SANDBOX_ROOT, projectId, 'changes.json');
    fs.mkdirSync(this.root, { recursive: true });
    if (!fs.existsSync(this.changeFile)) fs.writeFileSync(this.changeFile, '[]');
  }

  // --- path safety --------------------------------------------------------
  abs(rel) {
    const clean = String(rel || '').replace(/^[/\\]+/, '');
    const p = path.resolve(this.root, clean);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) {
      throw new Error(`Path escapes sandbox: ${rel}`);
    }
    return p;
  }
  rel(abs) { return path.relative(this.root, abs).split(path.sep).join('/'); }

  // --- change tracking ----------------------------------------------------
  track(op, target, extra = {}) {
    const changes = this.changes();
    const entry = { id: uid('chg'), ts: Date.now(), op, target, ...extra };
    changes.push(entry);
    fs.writeFileSync(this.changeFile, JSON.stringify(changes.slice(-500), null, 0));
    logger.info('sandbox', `${op} ${target}`, { project: this.id });
    return entry;
  }
  changes() {
    try { return JSON.parse(fs.readFileSync(this.changeFile, 'utf8')); } catch { return []; }
  }

  // --- reads --------------------------------------------------------------
  isBinary(rel) { return BINARY_EXT.has(path.extname(rel).slice(1).toLowerCase()); }

  async tree() {
    const walk = async (dir) => {
      const out = [];
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
      entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
      for (const e of entries) {
        if (HIDE.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        const rel = this.rel(abs);
        if (e.isDirectory()) {
          out.push({ type: 'dir', name: e.name, path: rel, children: await walk(abs) });
        } else {
          const st = await fsp.stat(abs);
          out.push({ type: 'file', name: e.name, path: rel, size: st.size, mtime: st.mtimeMs, binary: this.isBinary(rel) });
        }
      }
      return out;
    };
    return walk(this.root);
  }

  async read(rel) {
    const abs = this.abs(rel);
    if (this.isBinary(rel)) {
      const buf = await fsp.readFile(abs);
      return { path: rel, binary: true, base64: buf.toString('base64'), size: buf.length };
    }
    const content = await fsp.readFile(abs, 'utf8');
    return { path: rel, binary: false, content, size: Buffer.byteLength(content) };
  }

  async stat(rel) {
    const st = await fsp.stat(this.abs(rel));
    return { path: rel, size: st.size, mtime: st.mtimeMs, isDir: st.isDirectory() };
  }

  // --- writes -------------------------------------------------------------
  async write(rel, content, { base64 = false } = {}) {
    const abs = this.abs(rel);
    const existed = fs.existsSync(abs);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const data = base64 ? Buffer.from(content, 'base64') : content;
    await fsp.writeFile(abs, data);
    const size = base64 ? Buffer.from(content, 'base64').length : Buffer.byteLength(content);
    this.track(existed ? 'edit' : 'create', rel, { size });
    return { path: rel, size, created: !existed };
  }

  async mkdir(rel) {
    const abs = this.abs(rel);
    await fsp.mkdir(abs, { recursive: true });
    this.track('mkdir', rel);
    return { path: rel };
  }

  async remove(rel) {
    const abs = this.abs(rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) throw new Error(`Not found: ${rel}`);
    await fsp.rm(abs, { recursive: true, force: true });
    this.track('delete', rel, { dir: st.isDirectory() });
    return { path: rel };
  }

  async move(from, to) {
    const absFrom = this.abs(from);
    const absTo = this.abs(to);
    await fsp.mkdir(path.dirname(absTo), { recursive: true });
    await fsp.rename(absFrom, absTo);
    this.track('move', to, { from });
    return { from, to };
  }

  async rename(from, newName) {
    const to = path.posix.join(path.posix.dirname(from), newName);
    return this.move(from, to);
  }

  // --- search -------------------------------------------------------------
  async search(query, { regex = false, caseSensitive = false, maxResults = 200 } = {}) {
    const results = [];
    let matcher;
    try { matcher = regex ? new RegExp(query, caseSensitive ? 'g' : 'gi') : null; } catch { matcher = null; }
    const needle = caseSensitive ? query : query.toLowerCase();

    const walk = async (dir) => {
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (HIDE.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { await walk(abs); continue; }
        const rel = this.rel(abs);
        if (this.isBinary(rel)) continue;
        let text;
        try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hit = matcher ? matcher.test(line) : (caseSensitive ? line : line.toLowerCase()).includes(needle);
          if (matcher) matcher.lastIndex = 0;
          if (hit) {
            results.push({ path: rel, line: i + 1, text: line.slice(0, 400) });
            if (results.length >= maxResults) return;
          }
        }
      }
    };
    await walk(this.root);
    return results;
  }

  async replaceAll(query, replacement, { regex = false, caseSensitive = false } = {}) {
    let count = 0, files = 0;
    const re = regex ? new RegExp(query, caseSensitive ? 'g' : 'gi')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
    const walk = async (dir) => {
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (HIDE.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { await walk(abs); continue; }
        const rel = this.rel(abs);
        if (this.isBinary(rel)) continue;
        let text; try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
        const matches = text.match(re);
        if (matches) {
          const next = text.replace(re, replacement);
          await fsp.writeFile(abs, next);
          this.track('edit', rel, { replace: true, hits: matches.length });
          count += matches.length; files += 1;
        }
      }
    };
    await walk(this.root);
    return { count, files };
  }
}

const cache = new Map();
export function getSandbox(projectId) {
  if (!cache.has(projectId)) cache.set(projectId, new Sandbox(projectId));
  return cache.get(projectId);
}
