import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("message-attached centralized payloads keep scoped events that lack explicit message ids", () => {
  const body = extractFunctionBody(
    source,
    "const centralizedRawSdkEventPayloads = useMemo(() => {",
  );

  assert.match(
    body,
    /const attachedPayloadsWithoutIds = messageAttachedRawSdkEventPayloads\.filter\(\(event\) =>\s*!extractEventMessageId\(event\),\s*\);/s,
    "message-attached payload selection should explicitly preserve already-scoped entries that do not expose messageID/messageId",
  );

  assert.match(
    body,
    /return \[\s*\.\.\.scopedAttachedPayloads,\s*(?:\.\.\.sessionScopedNoIdPayloads,\s*)?\.\.\.attachedPayloadsWithoutIds,\s*\];/s,
    "scoped attached payloads should merge in no-id entries instead of dropping them during assistant-scope filtering",
  );

  assert.match(
    body,
    /if \(messageSpecificEvents\.length > 0\) \{\s*return \[\s*\.\.\.messageSpecificEvents,\s*(?:\.\.\.sessionScopedNoIdPayloads,\s*)?\.\.\.attachedPayloadsWithoutIds,\s*\];\s*\}/s,
    "session-scoped message matches should still merge message-attached no-id payloads so the assistant response body cannot disappear during re-scoping",
  );
});

test("assistant cards keep assistant-like no-id centralized terminal payloads from the session tape", () => {
  assert.match(
    source,
    /function isAssistantScopedNoIdPayloadCandidate\(/,
    "MessageComponents should define a dedicated guard for assistant-like centralized payloads that have no explicit message id",
  );

  const body = extractFunctionBody(
    source,
    "const centralizedRawSdkEventPayloads = useMemo(() => {",
  );

  assert.match(
    body,
    /const sessionScopedNoIdPayloads = sessionScopedRawSdkEventPayloads\.filter\(\(event\) =>\s*isAssistantScopedNoIdPayloadCandidate\(event\),\s*\);/s,
    "assistant card scoping should preserve assistant-like no-id payloads from the session tape",
  );

  assert.match(
    body,
    /return \[\s*\.\.\.messageSpecificEvents,\s*\.\.\.sessionScopedNoIdPayloads,\s*\.\.\.attachedPayloadsWithoutIds,\s*\];/s,
    "message-specific centralized events should merge assistant-like no-id session payloads before attached no-id payloads",
  );
});
