import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const ownershipSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "backgroundTaskOwnership.ts")],
  "backgroundTaskOwnership.ts",
);
const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const classificationSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "transcriptMessageClassification.ts")],
  "transcriptMessageClassification.ts",
);

test("subagent initiator ownership resolves a part through its parent message", () => {
  const body = extractFunctionBody(
    ownershipSource,
    "export function isSubagentInitiatorMessage(params:",
  );

  assert.match(body, /message\.info\?\.id, message\.id, message\.messageId/);
  assert.match(body, /<!-- omo_internal_initiator -->/);
  assert.match(body, /getCentralizedEventType\(payload\) !== "message\.updated"/);
  assert.match(body, /eventMessageId === messageId && eventRole === "user" && !!agent/);
  assert.doesNotMatch(body, /startsWith\(["']prt_/i, "part ids are not subagent ownership ids");
});

test("subagent initiator user messages are hidden before transcript bubble rendering", () => {
  const body = extractFunctionBody(
    classificationSource,
    "export function classifyCentralizedTranscriptMessage(params:",
  );

  assert.match(
    body,
    /isSubagentInitiatorMessage\(\{[\s\S]*message,[\s\S]*rawSdkEventPayloads,[\s\S]*\}\)[\s\S]*return "hidden"/,
  );
});

test("child-session events are hidden from the parent transcript before bubble rendering", () => {
  const ownershipBody = extractFunctionBody(
    ownershipSource,
    "export function isCrossSessionSubagentMessage(params:",
  );
  const classificationBody = extractFunctionBody(
    classificationSource,
    "export function classifyCentralizedTranscriptMessage(params:",
  );

  assert.match(
    ownershipBody,
    /part\?\.sessionID,[\s\S]*?info\?\.sessionID,[\s\S]*?properties\?\.sessionID/,
    "the ownership check must compare the event's explicit scoped session to its envelope",
  );
  assert.match(
    ownershipBody,
    /envelopeSessionId !== scopedSessionId/,
    "only cross-session events are excluded",
  );
  assert.match(
    classificationBody,
    /isCrossSessionSubagentMessage\(\{ message, rawSdkEventPayloads \}\)[\s\S]*?return "hidden"/,
    "child-session events must not reach main transcript rendering",
  );
});

test("server-authored search-mode parts override their transport user role", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedRenderMessages(",
  );

  assert.match(
    body,
    /if \(messageId && isStandaloneSystemTextPart\) \{[\s\S]*systemMessageIds\.add\(messageId\);[\s\S]*messageRolesById\.set\(messageId, "system"\);[\s\S]*userMessageIds\.delete\(messageId\);/,
    "an explicit system directive must win over the SDK's transport user role",
  );
});
