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
const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const shellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);
const debugStoreSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "sdkDebugStore.ts")],
  "sdkDebugStore.ts",
);

test("raw SDK event debugging has an explicit opt-in configuration", () => {
  assert.match(configSource, /showSdkEventDebug:\s*(true|false)/);
});

test("SDK debug configuration keeps the debug component mounted", () => {
  assert.match(shellSource, /<SdkEventDebugPanel\s*\/>/);
  assert.match(shellSource, /SdkEventDebugPanel,/);
  assert.match(
    messageSource,
    /export const SdkEventDebugPanel = memo\(function SdkEventDebugPanel\(\) \{\s*if \(!config\.debug\.showSdkEventDebug\) \{\s*return null;\s*\}/s,
  );
});

test("SDK debug panel stays in the fixed top area beside live tui notifications", () => {
  const liveBannerIndex = shellSource.indexOf('placement="top"');
  const debugPanelIndex = shellSource.indexOf('data-sdk-event-debug-top');
  const messageListIndex = shellSource.indexOf('{/* Message list */}');

  assert.ok(liveBannerIndex >= 0, "top tui.show banner must exist");
  assert.ok(debugPanelIndex > liveBannerIndex, "SDK debug panel must follow the top live banner");
  assert.ok(debugPanelIndex < messageListIndex, "SDK debug panel must remain outside the scrollable message list");
});

test("enabled SDK debugging does not stringify the full tape during render", () => {
  assert.match(messageSource, /useSyncExternalStore\(/);
  assert.match(messageSource, /getSdkDebugSnapshot\(sessionId\)/);
  assert.match(messageSource, /showRawDebugData \? \(/);
  assert.match(messageSource, /visibleLiveEvents = useMemo\([\s\S]*?liveEvents\.slice\(-100\)/);
  assert.match(messageSource, /Copy all/);
  assert.doesNotMatch(messageSource, /<pre>\{JSON\.stringify\(debugData, null, 2\)\}<\/pre>/);
});

test("stream and SDK hydration diagnostics are bounded and never serialized eagerly", () => {
  assert.match(handlerSource, /appendLiveSdkDebugEvents\(sessionId, events\)/);
  assert.match(handlerSource, /setRehydratedSdkDebugMessages\(historySessionId, rawSdkMessages\)/);
  assert.match(handlerSource, /config\.debug\.showSdkEventDebug/);
  assert.doesNotMatch(handlerSource, /JSON\.stringify\([^)]*(?:rawSdkMessages|debugEvents)/);
  assert.doesNotMatch(storeSource, /sdkMessagesBySessionId|liveEventStreamBySessionId/);
  assert.match(debugStoreSource, /MAX_LIVE_EVENTS_PER_SESSION\s*=\s*200/);
  assert.doesNotMatch(debugStoreSource, /NOTIFY_INTERVAL_MS = 100/);
});
