import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const configSource = readSource(
  [joinFromRoot("webview", "shared", "src", "config.ts")],
  "config.ts",
);
const messageSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("centralized debug tape rendering is disabled by default", () => {
  assert.match(configSource, /showCentralizedDebug:\s*false/);
});

test("disabled debug tape avoids subscribing to streaming state", () => {
  assert.match(
    messageSource,
    /export const CentralizedDebugPanel = memo\(function CentralizedDebugPanel\(\) \{\s*if \(!config\.debug\.showCentralizedDebug\) \{\s*return null;\s*\}\s*return <CentralizedDebugPanelContents \/>;/s,
  );
});
