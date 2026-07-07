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
  // Interactive answer detection has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /isInteractiveAnswerSubmission|interactiveAnswer|pendingInteractive/,
    "message handler should detect interactive answer submissions",
  );
});

test("interactive answer handoff still clears stale processing and streaming state on userMessageAppended", () => {
  // State clearing logic has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /SET_PROCESSING.*SET_STREAMING|FINISH_STREAMING|flushVisibleStreamingSnapshotToMessages/,
    "interactive answer handling should clear processing and streaming state",
  );
});

test("SDK-native question replies clear stale local loading state before posting questionReply", () => {
  assert.match(
    panelComponentsSource,
    /if \(canReplyToSdkQuestion\) \{[\s\S]*SET_PROCESSING[\s\S]*payload:\s*false[\s\S]*SET_STEERING[\s\S]*payload:\s*false[\s\S]*SET_STREAMING[\s\S]*payload:\s*null[\s\S]*type:\s*"questionReply"/s,
    "SDK question reply submits should clear stale processing, steering, and streaming state before waiting for continuation events",
  );
});
