/**
 * Build & package the Organic Forgery add-on.
 *
 * Pipeline: parse-check all JSON → reference-integrity validate → load-time
 * smoke test → stage the two pack folders at the ARCHIVE ROOT → zip a
 * `.mcaddon` plus standalone `.mcpack` fallbacks → assert the archive layout is
 * correct (this is the bug that broke v1).
 *
 * Run:  node tools/build.mjs
 */
import { execSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  existsSync,
  rmSync,
  cpSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BP_SRC = join(ROOT, "behavior_packs", "of_bp");
const RP_SRC = join(ROOT, "resource_packs", "of_rp");
const DIST = join(ROOT, "dist");
const STAGE = join(DIST, ".stage");
const MCADDON = join(DIST, "Organic-Forgery.mcaddon");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function parseCheckJson() {
  let checked = 0;
  const bad = [];
  for (const base of [BP_SRC, RP_SRC]) {
    for (const f of walk(base)) {
      if (!f.endsWith(".json")) continue;
      checked++;
      try {
        JSON.parse(readFileSync(f, "utf8"));
      } catch (e) {
        bad.push(`${relative(ROOT, f)}: ${e.message}`);
      }
    }
  }
  if (bad.length) {
    console.error("✗ JSON parse failed:");
    for (const b of bad) console.error("  - " + b);
    process.exit(1);
  }
  console.log(`✔ JSON: ${checked} files parse`);
}

function run(step, cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  } catch {
    console.error(`✗ build halted at: ${step}`);
    process.exit(1);
  }
}

function zip(cwd, archive, entries) {
  execSync(`zip -r -q "${archive}" ${entries} -x "*.DS_Store"`, { cwd, stdio: "inherit" });
}

function assertLayout() {
  const listing = execSync(`unzip -Z1 "${MCADDON}"`, { cwd: ROOT }).toString();
  const lines = listing.split("\n").filter(Boolean);
  const problems = [];
  if (lines.some((l) => l.startsWith("behavior_packs/") || l.startsWith("resource_packs/"))) {
    problems.push("archive contains a nested behavior_packs/ or resource_packs/ wrapper");
  }
  if (!lines.some((l) => l === "of_bp/manifest.json")) {
    problems.push("of_bp/manifest.json not at archive root");
  }
  if (!lines.some((l) => l === "of_rp/manifest.json")) {
    problems.push("of_rp/manifest.json not at archive root");
  }
  if (problems.length) {
    console.error("✗ archive layout invalid:");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log("✔ layout: pack folders sit at the archive root (of_bp/, of_rp/)");
}

function build() {
  parseCheckJson();
  run("validate", "node tools/validate.mjs");
  run("smoke test", "node tools/smoke.mjs");

  // Fresh dist + staging.
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  cpSync(BP_SRC, join(STAGE, "of_bp"), { recursive: true });
  cpSync(RP_SRC, join(STAGE, "of_rp"), { recursive: true });

  // Combined .mcaddon — pack folders at the archive root.
  zip(STAGE, MCADDON, "of_bp of_rp");

  // Standalone .mcpack fallbacks — each pack's manifest at its archive root.
  zip(join(STAGE, "of_bp"), join(DIST, "of_bp.mcpack"), ".");
  zip(join(STAGE, "of_rp"), join(DIST, "of_rp.mcpack"), ".");

  rmSync(STAGE, { recursive: true, force: true });

  assertLayout();

  for (const name of ["Organic-Forgery.mcaddon", "of_bp.mcpack", "of_rp.mcpack"]) {
    const size = (statSync(join(DIST, name)).size / 1024).toFixed(1);
    console.log(`  → dist/${name} (${size} KiB)`);
  }
  console.log("\n✔ Build complete.");
}

build();
