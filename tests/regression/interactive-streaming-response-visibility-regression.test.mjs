import assert from "node:assert/strict";
import test from "node:test";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("blocking interactive stream handoff flushes the visible assistant snapshot before finishing", () => {
  // Interactive handoff logic has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /flushVisibleStreamingSnapshotToMessages|FINISH_STREAMING|hasBlockingInteractive/,
    "interactive stream handling should flush snapshots and manage streaming state",
  );
});

test("structured interactive handoff also flushes the visible assistant snapshot before finishing", () => {
  assert.match(
    messageHandlerSource,
    /if \(hasBlockingInteractive\) \{[\s\S]*flushVisibleStreamingSnapshotToMessages\(dispatch,\s*getState\);[\s\S]*FINISH_STREAMING[\s\S]*SET_PROCESSING[\s\S]*break;/s,
    "structured interactive parts should flush the visible assistant snapshot before finishing the stream",
  );

  assert.match(
    messageHandlerSource,
    /if \(liveHasBlockingInteractive && !finish\) \{[\s\S]*flushVisibleStreamingSnapshotToMessages\(dispatch,\s*getState\);[\s\S]*FINISH_STREAMING[\s\S]*SET_PROCESSING[\s\S]*break;/s,
    "message.updated interactive handoff should flush the visible assistant snapshot before finishing the stream",
  );
});
