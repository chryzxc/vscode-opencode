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

test("raw SDK event debugging can remain enabled for diagnostics", () => {
  assert.match(configSource, /showSdkEventDebug:\s*true/);
});

test("SDK debug configuration keeps the debug component mounted", () => {
  assert.match(shellSource, /<SdkEventDebugPanel\s*\/>/);
  assert.match(shellSource, /SdkEventDebugPanel,/);
  assert.match(
    messageSource,
    /export const SdkEventDebugPanel = memo\(function SdkEventDebugPanel\(\) \{\s*if \(!config\.debug\.showSdkEventDebug\) \{\s*return null;\s*\}/s,
  );
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
  assert.match(debugStoreSource, /MAX_REHYDRATED_SDK_MESSAGES = 50/);
  assert.match(debugStoreSource, /MAX_LIVE_EVENTS = 100/);
  assert.match(debugStoreSource, /NOTIFY_INTERVAL_MS = 100/);
});
