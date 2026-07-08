// Dead-simple JSON collection store persisted to data/db/<name>.json.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const DB_DIR = path.join(DATA_DIR, 'db');
fs.mkdirSync(DB_DIR, { recursive: true });
const memo = new Map();

function file(name) { return path.join(DB_DIR, name + '.json'); }

export function load(name, fallback = {}) {
  if (memo.has(name)) return memo.get(name);
  let val = fallback;
  try { val = JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { /* default */ }
  memo.set(name, val);
  return val;
}

export function save(name, value) {
  memo.set(name, value);
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2));
  return value;
}

export function mutate(name, fallback, fn) {
  const val = load(name, fallback);
  const next = fn(val) ?? val;
  return save(name, next);
}
