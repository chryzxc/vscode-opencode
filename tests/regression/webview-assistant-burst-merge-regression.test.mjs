import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("webview assistant burst merge preserves rawResponse and prefers richer final text", () => {
  assert.match(
    messageHandlerSource,
    /function coalesceAssistantHistoryBurst\(burst: Message\[\]\): Message \{[\s\S]*let latestRawResponse: unknown = \(base as unknown as UnknownRecord\)\.rawResponse;/,
    "assistant burst merge should start tracking rawResponse from the base message",
  );

  assert.match(
    messageHandlerSource,
    /candidateTextScore\s*=\s*content\.length \+ \(structuredMessage \? 100000 : 0\)/,
    "assistant burst merge should score canonical structured messages above short transitional text",
  );

  assert.match(
    messageHandlerSource,
    /if \(typeof latestRawResponse !== "undefined"\) \{[\s\S]*rawResponse = latestRawResponse;/,
    "assistant burst merge should retain rawResponse on the merged assistant message",
  );
});
