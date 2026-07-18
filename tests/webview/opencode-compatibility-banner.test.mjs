import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const typesSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "types.ts")],
  "types.ts",
);
const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);
const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const shellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("chat types and store define compatibility warning state", () => {
  assert.match(
    typesSource,
    /export interface CompatibilityWarning \{/,
    "types should define a compatibility warning contract",
  );
  assert.match(
    typesSource,
    /compatibilityWarnings: CompatibilityWarning\[\];/,
    "AppState should carry compatibility warnings",
  );
  assert.match(
    storeSource,
    /compatibilityWarnings:\s*\[\],/,
    "initial state should initialize compatibility warnings",
  );
  assert.match(
    storeSource,
    /type: "SET_COMPATIBILITY_WARNINGS"; payload: CompatibilityWarning\[\]/,
    "store should expose a reducer action for compatibility warnings",
  );
});

test("message handler ingests compatibility warnings from init state and live updates", () => {
  assert.match(
    handlerSource,
    /type:\s*"SET_COMPATIBILITY_WARNINGS",\s*payload:\s*normalizeCompatibilityWarnings\(/,
    "init state should dispatch normalized compatibility warnings",
  );
  assert.match(
    handlerSource,
    /case "compatibilityStatus":[\s\S]*SET_COMPATIBILITY_WARNINGS/,
    "message handler should support dedicated compatibility status updates",
  );
});

test("chat shell does not render compatibility warnings", () => {
  assert.doesNotMatch(
    shellSource,
    /OpenCode compatibility warning/i,
    "compatibility diagnostics must not interrupt the chat UI",
  );
});

test("provider sends compatibility warnings to the webview", () => {
  assert.match(
    providerSource,
    /compatibilityWarnings:\s*this\.getCompatibilityWarnings\(\)/,
    "ChatViewProvider should include compatibility warnings in initState payloads",
  );
  assert.match(
    providerSource,
    /type:\s*"compatibilityStatus",[\s\S]*compatibilityWarnings:/,
    "ChatViewProvider should emit compatibility status updates",
  );
  assert.doesNotMatch(
    providerSource,
    /showWarningMessage\(summary\)/,
    "compatibility diagnostics must not create VS Code warning notifications",
  );
});
