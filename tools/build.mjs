/**
 * Validates every JSON file in both packs, then zips them into an installable
 * `.mcaddon`. Run with:  node tools/build.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKS = ["behavior_packs", "resource_packs"];
const OUT_NAME = "Organic-Forgery.mcaddon";
const DIST = join(ROOT, "dist");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function validateJson() {
  let checked = 0;
  const errors = [];
  for (const pack of PACKS) {
    const base = join(ROOT, pack);
    if (!existsSync(base)) {
      errors.push(`Missing pack folder: ${pack}`);
      continue;
    }
    for (const file of walk(base)) {
      if (!file.endsWith(".json")) continue;
      checked++;
      try {
        JSON.parse(readFileSync(file, "utf8"));
      } catch (e) {
        errors.push(`${relative(ROOT, file)}: ${e.message}`);
      }
    }
    // Manifest must exist.
    const manifest = walk(base).find((f) => f.endsWith("manifest.json"));
    if (!manifest) errors.push(`No manifest.json found in ${pack}`);
  }
  console.log(`Validated ${checked} JSON files.`);
  if (errors.length) {
    console.error("\nJSON validation FAILED:");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
}

function build() {
  validateJson();
  if (!existsSync(DIST)) mkdirSync(DIST);
  const outPath = join(DIST, OUT_NAME);
  if (existsSync(outPath)) rmSync(outPath);
  // Zip the two pack folders at the archive root.
  execSync(`cd "${ROOT}" && zip -r -q "${outPath}" ${PACKS.join(" ")} -x "*.DS_Store"`, {
    stdio: "inherit",
  });
  const size = (statSync(outPath).size / 1024).toFixed(1);
  console.log(`\n✔ Built ${relative(ROOT, outPath)} (${size} KiB)`);
}

build();
