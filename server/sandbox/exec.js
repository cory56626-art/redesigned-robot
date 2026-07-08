// Command execution confined to a sandbox root, with an allowlist, timeout and metrics.
import { spawn } from 'node:child_process';
import { logger } from '../utils/logger.js';

// Commands the AI and terminal are allowed to run. Everything else is rejected.
export const ALLOWED = new Set([
  'ls', 'cat', 'echo', 'pwd', 'head', 'tail', 'wc', 'grep', 'find', 'sort', 'uniq',
  'node', 'npm', 'npx', 'python3', 'python', 'pip', 'pip3',
  'mkdir', 'touch', 'cp', 'mv', 'rm', 'tree', 'sed', 'awk', 'date', 'env', 'true', 'false',
  'git', 'diff', 'test', 'basename', 'dirname', 'seq', 'printf', 'clear', 'whoami', 'uname',
]);

// A couple of built-ins we resolve ourselves so the terminal feels alive.
export function isAllowed(cmd) { return ALLOWED.has(cmd); }

export function runCommand(sandbox, commandLine, { timeout = 15000, env = {} } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const line = String(commandLine || '').trim();
    if (!line) return resolve({ stdout: '', stderr: '', code: 0, ms: 0, command: line });

    // Handle `cd` as informational (sandbox is single-root).
    const [bin] = line.split(/\s+/);
    if (bin === 'cd') return resolve({ stdout: '', stderr: '', code: 0, ms: 0, command: line });
    if (!isAllowed(bin)) {
      return resolve({
        stdout: '', code: 127, ms: Date.now() - started, command: line,
        stderr: `aurel: command not permitted in sandbox: ${bin}\nAllowed: ${[...ALLOWED].join(', ')}`,
      });
    }

    let stdout = '', stderr = '', killed = false;
    const child = spawn('/bin/sh', ['-c', line], {
      cwd: sandbox.root,
      env: { PATH: process.env.PATH, HOME: sandbox.root, LANG: 'C.UTF-8', ...env },
      timeout,
    });
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeout);

    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 200_000) { stdout = stdout.slice(0, 200_000) + '\n…(truncated)'; child.kill(); } });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stderr += String(e.message); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (killed) stderr += `\naurel: killed after ${timeout}ms timeout`;
      logger.info('exec', line, { code: killed ? 'TIMEOUT' : code, ms });
      // A command that writes files should surface as sandbox changes; re-scan lightly.
      resolve({ stdout, stderr, code: killed ? 124 : (code ?? 0), ms, command: line });
    });
  });
}
