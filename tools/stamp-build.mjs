#!/usr/bin/env node
// Summoner Realms — cache-bust stamper.
//
// There is no build step: the browser loads js/main.js and follows its imports.
// ES modules are cached by URL, so a stale copy of one module can be served
// alongside a fresh copy of another — which is exactly what the old hand-edited
// `?build=` strings ended up doing, since they drifted out of sync module by
// module.
//
// This rewrites the `?v=` stamp on every relative import (and on the entry
// script and stylesheet in index.html) to the single BUILD constant in
// js/config.js, so either the whole graph is fresh or none of it is.
//
//   node tools/stamp-build.mjs            stamp everything with the current BUILD
//   node tools/stamp-build.mjs --check    exit non-zero if anything is out of date
//
// Bump BUILD in js/config.js and re-run before releasing.

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const config = readFileSync(join(root, 'js/config.js'), 'utf8');
const m = config.match(/export const BUILD\s*=\s*'([^']+)'/);
if (!m) {
  console.error('Could not find `export const BUILD` in js/config.js');
  process.exit(2);
}
const BUILD = m[1];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const changed = [];

// Relative imports inside the module graph.
for (const file of walk(join(root, 'js'))) {
  const src = readFileSync(file, 'utf8');
  const next = src.replace(
    /(\bfrom\s*['"])(\.[^'"?]+\.js)(\?v=[^'"]*)?(['"])/g,
    (_all, pre, spec, _old, post) => `${pre}${spec}?v=${BUILD}${post}`,
  );
  if (next !== src) { changed.push(file); if (!check) writeFileSync(file, next); }
}

// The entry points in index.html.
{
  const file = join(root, 'index.html');
  const src = readFileSync(file, 'utf8');
  const next = src
    .replace(/(src="js\/main\.js)(\?v=[^"]*)?"/, `$1?v=${BUILD}"`)
    .replace(/(href="css\/styles\.css)(\?v=[^"]*)?"/, `$1?v=${BUILD}"`);
  if (next !== src) { changed.push(file); if (!check) writeFileSync(file, next); }
}

const rel = (f) => f.slice(root.length + 1);
if (check) {
  if (changed.length) {
    console.error(`✗ ${changed.length} file(s) not stamped with BUILD "${BUILD}":`);
    for (const f of changed) console.error('  ' + rel(f));
    console.error('\nRun: node tools/stamp-build.mjs');
    process.exit(1);
  }
  console.log(`✓ every module stamped with BUILD "${BUILD}"`);
} else {
  console.log(`stamped ${changed.length} file(s) with BUILD "${BUILD}"`);
  for (const f of changed) console.log('  ' + rel(f));
}
