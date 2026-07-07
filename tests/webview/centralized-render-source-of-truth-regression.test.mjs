import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

test("centralized transcript renderer does not fall back to local message state when the tape is empty", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedRenderMessages(",
  );

  assert.match(
    body,
    /if \(normalizedRawSdkEventPayloads\.length === 0\) \{\s*return \[\];\s*\}/s,
    "an empty centralized raw event tape should render no transcript messages",
  );
  assert.doesNotMatch(
    body,
    /return \[\.\.\.messages\]\.sort/,
    "centralized rendering must not bootstrap visible bubbles from local message history",
  );
});

test("chat shell display path passes only centralized data into transcript builders", () => {
  assert.match(
    chatShellSource,
    /function buildCentralizedTranscriptProjection\(\s*rawSdkEventPayloads: unknown\[\],\s*\): CentralizedTranscriptProjection/s,
    "chat shell should expose a single centralized transcript projection pass",
  );
  assert.match(
    chatShellSource,
    /function buildCentralizedRenderMessages\(\s*rawSdkEventPayloads: unknown\[\]\s*\): Message\[\]/s,
    "render message builder should not accept local messages as an input",
  );
  assert.match(
    chatShellSource,
    /function buildCentralizedConversationEntries\(\s*rawSdkEventPayloads: unknown\[\],?\s*\): ConversationRenderEntry\[\]/s,
    "conversation entry builder should not accept local messages as an input",
  );
  assert.match(
    chatShellSource,
    /const transcriptProjection = useMemo\(\s*\(\) => buildCentralizedTranscriptProjection\(centralizedSessionRawSdkEventPayloads\),/s,
    "ChatContent should derive transcript state from one centralized projection pass",
  );
  assert.match(
    chatShellSource,
    /const renderMessages = transcriptProjection\.renderMessages;/,
    "renderMessages should come from the centralized transcript projection",
  );
  assert.match(
    chatShellSource,
    /const conversationEntries = transcriptProjection\.conversationEntries;/,
    "conversationEntries should come from the centralized transcript projection",
  );
  assert.match(
    chatShellSource,
    /const hasAnyRenderableConversation =\s*centralizedSessionRawSdkEventPayloads\.length > 0 \|\|\s*Boolean\(state\.streaming\?\.isActive\);/s,
    "renderable conversation detection should be based on centralized data or live streaming only",
  );
  assert.doesNotMatch(
    chatShellSource,
    /visiblePendingDeferredPrompts|pendingDeferredPromptToMessage|pendingDeferredPromptMatchesMessage/,
    "pending deferred prompts must not render transcript bubbles outside the centralized tape",
  );
  assert.doesNotMatch(
    chatShellSource,
    /messages=\{state\.messages\}/,
    "rendered transcript components should receive centralized renderMessages, not local state.messages",
  );
});
