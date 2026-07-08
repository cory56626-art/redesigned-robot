// Ring-buffer logger. Emits to stdout and keeps recent structured entries the UI can poll.
import { EventEmitter } from 'node:events';

const MAX = 1000;
const buffer = [];
export const logBus = new EventEmitter();
logBus.setMaxListeners(0);

const COLORS = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m', agent: '\x1b[35m' };
const RESET = '\x1b[0m';

export function log(level, scope, message, meta = {}) {
  const entry = { id: buffer.length + 1, ts: Date.now(), level, scope, message, meta };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  const c = COLORS[level] || '';
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  process.stdout.write(`${c}[${level.toUpperCase()}]${RESET} ${scope} — ${message}${metaStr}\n`);
  logBus.emit('log', entry);
  return entry;
}

export const logger = {
  info: (scope, m, meta) => log('info', scope, m, meta),
  warn: (scope, m, meta) => log('warn', scope, m, meta),
  error: (scope, m, meta) => log('error', scope, m, meta),
  debug: (scope, m, meta) => log('debug', scope, m, meta),
  agent: (scope, m, meta) => log('agent', scope, m, meta),
};

export function recentLogs(sinceId = 0, level = null) {
  return buffer.filter((e) => e.id > sinceId && (!level || e.level === level));
}
