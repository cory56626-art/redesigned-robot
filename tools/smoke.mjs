/**
 * Load-time smoke test.
 *
 * Registers the stub loader, then imports the add-on's script entry point. If
 * `scripts/main.js` (and everything it pulls in) evaluates and runs its
 * `start*()` wiring without throwing, the module graph is sound — this catches
 * the class of top-level/load-time error that silently killed the v1 pack.
 *
 * Run:  node tools/smoke.mjs
 */
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
register("./mc-loader.mjs", import.meta.url);

const mainPath = join(here, "..", "behavior_packs", "of_bp", "scripts", "main.js");

try {
  await import(pathToFileURL(mainPath).href);
  console.log("✔ smoke: scripts/main.js loaded against stubs without throwing");
} catch (e) {
  console.error("✗ smoke: main.js threw at load time:\n", e);
  process.exit(1);
}
