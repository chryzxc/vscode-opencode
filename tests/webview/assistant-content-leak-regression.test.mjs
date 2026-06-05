import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("message handler excludes activity-like typeless parts from assistant body content", () => {
  assert.match(
    messageHandlerSource,
    /function isActivityLikePart\(part: UnknownRecord\)/,
    "messageHandler should define an activity-like part guard",
  );
  assert.match(
    messageHandlerSource,
    /const hasTextLikeField[\s\S]*typeof part\.text === "string"[\s\S]*typeof part\.content === "string"[\s\S]*typeof part\.delta === "string"[\s\S]*typeof part\.message === "string"/,
    "typeless assistant parts should require explicit text-like fields",
  );
  assert.match(
    messageHandlerSource,
    /return !isActivityLikePart\(part\);/,
    "activity-like typeless parts should be excluded from assistant body content",
  );
});

test("message components mirror the same activity leak guard during final rendering", () => {
  const getMessageContentBody = extractFunctionBody(
    messageComponentsSource,
    "function getMessageContent(",
  );

  assert.ok(
    getMessageContentBody.includes(
      "const baseContent =\n    firstNonEmptyString(\n      message.content,\n      message.text,\n      partsBody,\n      summaryText(message),\n    ) ?? \"\";",
    ),
    "MessageComponents should derive visible assistant content from the canonical message fields",
  );
  assert.ok(
    getMessageContentBody.includes("if (!questionPrompt) {\n    return baseContent;\n  }"),
    "renderer should return the canonical content directly when no question prompt is present",
  );
  assert.match(
    getMessageContentBody,
    /messageResponseType === "progress"[\s\S]*hasQuestionLikeInteractiveContent\(message\)[\s\S]*return questionPrompt;/,
    "the renderer should promote live progress question prompts over reasoning drafts",
  );
});

test("message handler hydration coalescing reuses renderable assistant text rules", () => {
  assert.match(
    messageHandlerSource,
    /function extractRenderableAssistantTextForHydration\(message: Message\): string/,
    "messageHandler should define a hydration-safe assistant text extractor",
  );
  assert.match(
    messageHandlerSource,
    /function isReasoningLeakCandidateForHydration\(/,
    "messageHandler should define a reasoning leak predicate for hydration",
  );
  assert.match(
    messageHandlerSource,
    /if \(!isReasoningLeakCandidateForHydration\(content, message, rec\.parts\)\)/,
    "assistant burst coalescing should reject reasoning-like direct content before promoting it to the visible response",
  );
});

test("message handler coalescing keeps the canonical question turn ahead of a reasoning-only follow-up", () => {
  assert.match(
    messageHandlerSource,
    /function isCanonicalAssistantDisplayMessage\(message: Message\): boolean/,
    "assistant burst coalescing should expose a canonical display-message predicate",
  );
  assert.match(
    messageHandlerSource,
    /const candidateTextScore =\s*content\.length \+ \(isCanonicalAssistantDisplayMessage\(message\) \? 100000 : 0\);/,
    "question turns should get the canonical display priority bonus",
  );
  assert.match(
    messageHandlerSource,
    /function getCanonicalStructuredMessageText\(message: Message \| UnknownRecord\): string/,
    "structured message extraction should exist for canonical question selection",
  );
  assert.match(
    messageHandlerSource,
    /if \(isReasoningLeakCandidateForHydration\(structuredMessage, message as Message, rec\.parts\)\) {\s*return \"\";/,
    "reasoning-like structured messages should be rejected before they can become the visible assistant body",
  );
  assert.match(
    messageHandlerSource,
    /responseType === "question" \|\| responseType === "implementation_plan"/,
    "question turns should remain canonical display candidates during assistant burst coalescing",
  );
});

test("webview store canonicalization uses hydration-safe assistant text extraction", () => {
  const storeSource = readSource(
    [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
    "store.ts",
  );

  assert.match(
    storeSource,
    /function extractRenderableAssistantTextForCanonical\(message: Message\): string/,
    "store canonicalization should define a renderable assistant text extractor",
  );
  assert.match(
    storeSource,
    /function isReasoningLeakCandidateForCanonical\(/,
    "store canonicalization should define a reasoning leak predicate",
  );
  assert.match(
    storeSource,
    /if \(!isReasoningLeakCandidateForCanonical\(content, message, rec\.parts\)\)/,
    "assistant run canonicalization should not promote reasoning-like direct content into the assistant body",
  );
});
