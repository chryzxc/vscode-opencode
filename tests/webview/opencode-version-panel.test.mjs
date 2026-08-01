import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);
const extensionSource = readSource(
  [joinFromRoot("src", "extension.ts")],
  "extension.ts",
);
const packageJsonSource = readSource(
  [joinFromRoot("package.json")],
  "package.json",
);
const panelSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "PanelComponents.tsx")],
  "PanelComponents.tsx",
);
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

test("webview state carries sdk and tui versions", () => {
  assert.match(typesSource, /sdkVersion\?: string;/, "AppState should expose sdkVersion");
  assert.match(storeSource, /sdkVersion:\s*undefined,/, "initial state should default sdkVersion to undefined");
  assert.match(storeSource, /type: "SET_SDK_VERSION"; payload: string \| undefined/, "store should accept sdk version updates");
  assert.match(storeSource, /type: "SET_SERVER_VERSION"; payload: string \| undefined/, "store should accept server version updates");
  assert.match(handlerSource, /type:\s*"SET_SDK_VERSION",[\s\S]*sdkVersion/, "message handler should hydrate sdkVersion from initState");
  assert.match(handlerSource, /type:\s*"SET_SERVER_VERSION",[\s\S]*serverVersion/, "message handler should hydrate serverVersion from initState and status updates");
});

test("provider sends sdk and server versions in init snapshots", () => {
  assert.match(providerSource, /sdkVersion:\s*this\.installedSdkVersion/, "provider should include the SDK version in init payloads");
  assert.match(providerSource, /serverVersion:\s*this\.serverManager\.getVersion\(\)/, "provider should include the TUI/server version in init payloads");
});

test("test-only compatibility banner command is removed", () => {
  assert.doesNotMatch(
    packageJsonSource,
    /opencode\.simulateCompatibilityWarning/,
    "package.json should not expose the test command",
  );
  assert.doesNotMatch(
    extensionSource,
    /opencode\.simulateCompatibilityWarning/,
    "extension should not register the test command",
  );
  assert.doesNotMatch(
    extensionSource,
    /toggleCompatibilityWarningTestBanner\(\)/,
    "test command handler should be removed",
  );
  assert.doesNotMatch(
    providerSource,
    /COMPATIBILITY_WARNING_TEST_MODE_KEY/,
    "provider should not persist a test banner mode anymore",
  );
  assert.doesNotMatch(
    providerSource,
    /globalState\.update\(\s*ChatViewProvider\.COMPATIBILITY_WARNING_TEST_MODE_KEY/,
    "provider should not persist the test banner flag in globalState",
  );
  assert.doesNotMatch(
    providerSource,
    /loadPersistedCompatibilityWarningsOverride\(\)/,
    "provider should not restore test banner state from persistence",
  );
});

test("active task panel renders both versions in the session section", () => {
  assert.match(panelSource, /OpenCode TUI/, "panel should label the server/TUI version clearly");
  assert.match(panelSource, /OpenCode SDK/, "panel should render the SDK version");
  assert.match(panelSource, /sdkVersion,/, "panel should read sdkVersion from app state");
});

test("compatibility warning waits for numeric SDK and server versions", () => {
  assert.match(
    handlerSource,
    /const sdkParts = sdkLabel\?\.match\(/,
    "compatibility checks should parse the SDK major/minor version",
  );
  assert.match(
    handlerSource,
    /if \(!sdkParts \|\| !serverParts\) return null;/,
    "compatibility warnings must stay hidden until both versions are known",
  );
});

test("toast dismiss button is anchored to the banner edge", () => {
  const toastSource = readSource(
    [joinFromRoot("webview", "shared", "src", "chat", "ToastOverlay.tsx")],
    "ToastOverlay.tsx",
  );
  assert.match(toastSource, /relative border-l-2 border-oc-border/, "toast should establish a positioning context");
  assert.match(toastSource, /absolute right-3 top-2 rounded p-1/, "dismiss button should render at the right edge");
});
