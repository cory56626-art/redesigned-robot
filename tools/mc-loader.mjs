/**
 * Node ESM resolution hook that maps the bare `@minecraft/*` specifiers to the
 * local no-op stubs, so the add-on scripts can be imported outside a game.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const MAP = {
  "@minecraft/server": join(here, "stubs", "server.mjs"),
  "@minecraft/server-ui": join(here, "stubs", "server-ui.mjs"),
};

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) {
    return { url: pathToFileURL(MAP[specifier]).href, shortCircuit: true };
  }
  return next(specifier, context);
}
