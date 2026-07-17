import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("assistant cards render only message-ID-scoped centralized payloads", () => {
  const body = extractFunctionBody(
    source,
    "const centralizedRawSdkEventPayloads = useMemo(() => {",
  );

  assert.match(
    body,
    /const messageSpecificEvents: unknown\[\] = \[\];[\s\S]*?eventBelongsToAssistantScope\(event, messageCandidateIds\)/s,
    "the session tape must be filtered through the current assistant card's message ID set",
  );

  assert.match(
    body,
    /if \(messageSpecificEvents\.length > 0\) \{\s*return \[[\s\S]*\.\.\.messageSpecificEvents,[\s\S]*\.\.\.sessionScopedNoIdPayloads,[\s\S]*\.\.\.attachedPayloadsWithoutIds,[\s\S]*\];\s*\}/s,
    "a response card should combine matching assistant-turn rows with guarded ID-less raw SDK metadata",
  );

  assert.match(
    body,
    /if \(scopedAttachedPayloads\.length > 0\) \{[\s\S]*return \[[\s\S]*\.\.\.scopedAttachedPayloads,[\s\S]*\.\.\.sessionScopedNoIdPayloads,[\s\S]*\.\.\.attachedPayloadsWithoutIds,[\s\S]*\];\s*\}/s,
    "the attached-payload fallback must use the identical message-ID predicate plus guarded ID-less metadata",
  );
});

test("session-wide and ID-less events cannot bleed into an assistant response block", () => {
  assert.match(
    source,
    /function extractSemanticEventMessageId\(event: unknown\): string \| null \{[\s\S]*fallbackId\.toLowerCase\(\)\.startsWith\("evt_"\)/,
    "assistant-card scoping should distinguish semantic message ids from wrapper evt_ ids before treating a payload as message-scoped",
  );

  assert.match(
    source,
    /wrapper event id such as `evt_\*`[\s\S]*NOT safe for[\s\S]*assistant-card scoping/s,
    "MessageComponents should document why wrapper evt_ ids must not be treated as semantic assistant message ids",
  );

  const body = extractFunctionBody(
    source,
    "const centralizedRawSdkEventPayloads = useMemo(() => {",
  );

  assert.match(
    source,
    /function isAssistantScopedNoIdPayloadCandidate\(event: unknown\): boolean \{[\s\S]*extractSemanticEventMessageId\(event\)[\s\S]*return false;[\s\S]*isAssistantHeaderMetadataEvent && hasAssistantHeaderMetadata/s,
    "ID-less raw SDK rows must pass a strict assistant/header metadata predicate before joining a response block",
  );

  assert.match(
    body,
    /if \(!message\) \{[\s\S]*?return scopedLivePayloads;[\s\S]*?return sessionScopedRawSdkEventPayloads;/s,
    "the live-card path may render the active raw SDK tape until the assistant message ID is attached",
  );
});
