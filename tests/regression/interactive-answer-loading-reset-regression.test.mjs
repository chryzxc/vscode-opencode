import assert from "node:assert/strict";
import test from "node:test";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const panelComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "PanelComponents.tsx")],
  "PanelComponents.tsx",
);

test("interactive answer handoff recognizes plain user replies when a pending assistant question is active", () => {
  assert.match(
    messageHandlerSource,
    /const isLikelyInteractiveAnswerSubmissionMessage = \(message: Message\): boolean => \{[\s\S]*containsInteractiveMarker\(text\)[\s\S]*const pendingInteractive = latestPendingInteractiveEvents\(getState\(\)\.messages \|\| \[\]\);[\s\S]*return pendingInteractive\.length > 0 && text\.trim\(\)\.length > 0;/,
    "interactive answer detection should treat plain user replies as question answers when the latest assistant turn still has pending interactive events",
  );
});

test("interactive answer handoff still clears stale processing and streaming state on userMessageAppended", () => {
  assert.match(
    messageHandlerSource,
    /if \(isInteractiveAnswerSubmission\) \{[\s\S]*flushVisibleStreamingSnapshotToMessages\(dispatch,\s*getState\);[\s\S]*SET_PROCESSING[\s\S]*payload:\s*false[\s\S]*SET_STEERING[\s\S]*payload:\s*false[\s\S]*SET_STREAMING[\s\S]*payload:\s*null[\s\S]*SET_INTERACTIVE_EVENTS[\s\S]*payload:\s*\[\]/s,
    "interactive answer userMessageAppended handling should clear loading, streaming, and stale popover state before the next assistant turn starts",
  );
});

test("SDK-native question replies clear stale local loading state before posting questionReply", () => {
  assert.match(
    panelComponentsSource,
    /if \(canReplyToSdkQuestion\) \{[\s\S]*SET_PROCESSING[\s\S]*payload:\s*false[\s\S]*SET_STEERING[\s\S]*payload:\s*false[\s\S]*SET_STREAMING[\s\S]*payload:\s*null[\s\S]*type:\s*"questionReply"/s,
    "SDK question reply submits should clear stale processing, steering, and streaming state before waiting for continuation events",
  );
});
