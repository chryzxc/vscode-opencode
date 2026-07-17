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

test("raw SDK event debug rendering is disabled by default", () => {
  assert.match(configSource, /showSdkEventDebug:\s*false/);
});

test("disabled SDK event debug avoids subscribing to debug state", () => {
  assert.match(
    messageSource,
    /export const SdkEventDebugPanel = memo\(function SdkEventDebugPanel\(\) \{\s*if \(!config\.debug\.showSdkEventDebug\) \{\s*return null;\s*\}\s*return <SdkEventDebugPanelContents \/>;/s,
  );
});
