import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const transcriptClassificationSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "transcriptMessageClassification.ts")],
  "transcriptMessageClassification.ts",
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
    /function buildCentralizedRenderMessages\(\s*rawSdkEventPayloads: unknown\[\],[\s\S]*?\): Message\[\]/s,
    "render message builder should not accept local messages as an input",
  );
  assert.match(
    chatShellSource,
    /function buildCentralizedConversationEntries\(\s*rawSdkEventPayloads: unknown\[\],?\s*\): ConversationRenderEntry\[\]/s,
    "conversation entry builder should not accept local messages as an input",
  );
  assert.match(
    chatShellSource,
    /const transcriptProjection = useMemo\(\s*\(\) => buildCentralizedTranscriptProjection\((?:centralizedSessionRawSdkEventPayloads|throttledPayloads)\),/s,
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

test("centralized render builder preserves user file parts instead of dropping non-text attachments", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedRenderMessages(",
  );

  assert.match(
    body,
    /if \(messageId\) \{[\s\S]*?const existingParts = partsByMessageId\.get\(messageId\) \?\? \[\];[\s\S]*?existingParts\.push\(part\);[\s\S]*?partsByMessageId\.set\(messageId, existingParts\);[\s\S]*?\}/s,
    "every centralized part event with a messageId should be preserved in partsByMessageId before role-specific filtering",
  );
  assert.match(
    body,
    /parts:\s*getPartsForMessageId\(descriptor\.messageId\),/s,
    "merged user messages must receive preserved centralized parts so attachment chips can render",
  );
  assert.match(
    body,
    /if \(messageId\) \{[\s\S]*?partsByMessageId\.set\(messageId, existingParts\);[\s\S]*?\}[\s\S]*?if \(firstNonEmptyString\(part\?\.type\)\?\.toLowerCase\(\) !== "text"\) \{\s*continue;\s*\}/s,
    "user attachment parts must be preserved before the text-only descriptor branch runs",
  );
});

test("centralized user messages derive visible text from parts and ignore synthetic tool echoes", () => {
  assert.match(
    chatShellSource,
    /function buildVisibleUserMessageText\(/,
    "centralized user-message builder should derive visible text through a dedicated helper",
  );
  assert.match(
    chatShellSource,
    /\.filter\(\(part\) => part\?\.synthetic !== true\)/,
    "centralized user-text derivation should exclude synthetic user parts before building visible text",
  );
  assert.match(
    chatShellSource,
    /normalized\.startsWith\("called the "\)[\s\S]*?normalized\.includes\(" tool with the following input:"\)/,
    "centralized user-text derivation should ignore synthetic tool-call echo text",
  );
  assert.match(
    chatShellSource,
    /value\.includes\("<path>"\)[\s\S]*?value\.includes\("<\/path>"\)[\s\S]*?value\.includes\("<content>"\)/,
    "centralized user-text derivation should ignore raw file-dump payload text",
  );
  assert.match(
    chatShellSource,
    /const visibleUserText = buildVisibleUserMessageText\(descriptor\.text, userParts\);[\s\S]*?content:\s*visibleUserText,[\s\S]*?text:\s*visibleUserText,[\s\S]*?parts:\s*userParts/s,
    "canonical user messages should use filtered visible text while preserving attachment parts for the same bubble",
  );
});

test("centralized transcript projection emits session-error entries in tape order", () => {
  assert.match(
    chatShellSource,
    /parseCentralizedSessionErrorEvent\([\s\S]*?kind:\s*"session\.error"/s,
    "transcript projection must parse centralized session errors into ordered conversation entries",
  );
  assert.match(
    chatShellSource,
    /primarySessionErrorEvents[\s\S]*?candidateError\.source !== "message\.updated"/s,
    "projection should detect when a primary session.error/error event exists",
  );
  assert.match(
    chatShellSource,
    /fallbackSpecificSessionErrorEvents[\s\S]*?candidateError\.source === "message\.updated"[\s\S]*?!isGenericSessionErrorMessage\(candidateError\.message\)/s,
    "projection should keep specific message.updated errors when primary session.error rows are only generic fallbacks",
  );
  assert.match(
    chatShellSource,
    /hasSpecificSessionErrorEvent[\s\S]*?isGenericSessionErrorMessage\(candidateError\.message\)/s,
    "projection should prefer specific error text over generic fallback messages",
  );
  assert.match(
    chatShellSource,
    /conversationEntries:\s*conversationEntries\.sort\(\(left, right\) => left\.order - right\.order\)/,
    "session-error entries must participate in the same centralized sort as the rest of the transcript",
  );
});

test("centralized transcript projection no longer emits session-status entries", () => {
  const projectionBody = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedTranscriptProjection(",
  );

  assert.doesNotMatch(
    chatShellSource,
    /function parseCentralizedSessionStatusEvent\(/,
    "centralized transcript layer should no longer define a dedicated session.status parser",
  );
  assert.doesNotMatch(
    projectionBody,
    /kind:\s*"session\.status"/,
    "transcript projection must not emit session.status conversation entries anymore",
  );
  assert.doesNotMatch(
    chatShellSource,
    /entry\.kind === "session\.status"[\s\S]*?entry\.status\.createdAt \?\? 0/s,
    "pending-user merge should no longer treat session.status as a centralized conversation entry",
  );
});

test("centralized builder classifies system messages as full-width entries instead of defaulting to user bubbles", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedRenderMessages(",
  );

  assert.match(
    body,
    /if \(messageId && !messageRolesById\.has\(messageId\)\) \{[\s\S]*?partEventRole[\s\S]*?systemMessageIds\.add\(messageId\)/s,
    "role must be registered from message.part.updated events so system messages without a matching message.updated are not lost",
  );

  assert.match(
    body,
    /isExplicitSystemTransportText\(descriptor\.text\)/,
    "routing loop must fall back to content-based system detection for descriptors with no registered role",
  );

  assert.match(
    transcriptClassificationSource,
    /export function isExplicitSystemTransportText\([\s\S]*?\/\^\\\[\[a-z\]/s,
    "content-based fallback should detect bracketed system message patterns",
  );

  assert.match(
    body,
    /role:\s*"system",[\s\S]*?info:\s*\{[\s\S]*?role:\s*"system"/s,
    "system descriptors must be merged with role and info.role set to system for full-width rendering",
  );

  assert.match(
    body,
    /const isStandaloneSystemTextPart[\s\S]*?isExplicitSystemTransportText[\s\S]*?const isAssistantOwnedPart\s*=\s*!isStandaloneSystemTextPart/s,
    "standalone system text must bypass the assistant-ID fallback before system classification",
  );
});
