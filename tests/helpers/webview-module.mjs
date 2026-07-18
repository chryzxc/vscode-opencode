// Runtime loader for webview TypeScript modules from .mjs test files.
//
// Why this exists:
// - The primary CI test command is `node --test tests/**/*.test.mjs`, which cannot
//   import `.ts` files natively.
// - Colocated `.test.ts` files under `webview/shared/src/` are not picked up by
//   `npm test` today, so runtime coverage of webview pure functions is effectively
//   zero in CI.
// - `tsx` is already a project devDep and exposes a programmatic ESM loader
//   (`tsx/esm/api`) that compiles and imports TypeScript on demand.
//
// This helper lets `.test.mjs` regression tests import the real TypeScript
// implementation and assert on actual runtime behavior (rather than only
// matching source text with regex, like `source-utils.mjs`).
//
// Usage:
//   import { importWebviewModule } from "../helpers/webview-module.mjs";
//   const { truncateLargeStrings } = await importWebviewModule(
//     "webview/shared/src/chat/lib/truncateLargeStrings.ts",
//   );
//
// Notes:
// - Modules that transitively import `react`, `./vscode`, or other host-side
//   code will fail to load here. Stick to pure-TypeScript lib modules with
//   no runtime side effects. Type-only imports are erased by tsx and are safe.
// - `tsImport` caches compiled modules per file path, so repeated calls in the
//   same process are cheap.

import { tsImport } from "tsx/esm/api";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Import a TypeScript module from the webview by repo-relative path.
 *
 * @param {string} repoRelativePath - e.g. "webview/shared/src/chat/lib/truncateLargeStrings.ts"
 * @returns {Promise<Record<string, unknown>>} The module's exports.
 */
export async function importWebviewModule(repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim()) {
    throw new Error("importWebviewModule: repoRelativePath must be a non-empty string");
  }
  const resolved = path.resolve(repoRoot, repoRelativePath);
  const mod = await tsImport(resolved, import.meta.url);
  return mod;
}

export { repoRoot };
