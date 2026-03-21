import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "./helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("webview history normalization drops internal system-reminder transport messages", () => {
  const helperBody = extractFunctionBody(
    messageHandlerSource,
    "function isInternalSystemReminderMessage(message: Message): boolean",
  );
  const renderableBody = extractFunctionBody(
    messageHandlerSource,
    "function hasRenderableHistoryPayload(message: Message): boolean",
  );

  assert.match(
    helperBody,
    /normalizedText\.includes\("<system-reminder>"\)/,
    "isInternalSystemReminderMessage should recognize <system-reminder> payloads",
  );
  assert.match(
    helperBody,
    /normalizedText\.includes\("<!-- omo_internal_initiator -->"\)/,
    "isInternalSystemReminderMessage should recognize the internal initiator marker",
  );
  assert.match(
    helperBody,
    /normalizedText\.includes\("\[search-model\]"\)\s*&&[\s\S]*normalizedText\.includes\("maximize search effort"\)/,
    "isInternalSystemReminderMessage should recognize search-model reminder payloads",
  );
  assert.match(
    helperBody,
    /if\s*\(\/\\bproceed on this plan\\\.\/i\.test\(text\)\)\s*\{\s*return false;\s*\}/,
    "isInternalSystemReminderMessage should preserve plan proceed confirmations",
  );
  assert.match(
    renderableBody,
    /if\s*\(\s*isInternalSystemReminderMessage\(message\)\s*\)\s*\{\s*return false;\s*\}/,
    "hasRenderableHistoryPayload should exclude internal reminder messages from hydrated chatHistory",
  );
});
