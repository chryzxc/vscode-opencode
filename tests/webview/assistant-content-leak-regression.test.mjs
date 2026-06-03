import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

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
  assert.match(
    messageComponentsSource,
    /function isActivityLikePart\(part: MessagePart\)/,
    "MessageComponents should define an activity-like part guard",
  );
  assert.match(
    messageComponentsSource,
    /const hasTextLikeField[\s\S]*typeof part\.text === "string"[\s\S]*typeof part\.content === "string"[\s\S]*typeof part\.message === "string"/,
    "rendering should require text-like fields before typeless parts count as assistant content",
  );
  assert.match(
    messageComponentsSource,
    /return !isActivityLikePart\(part\);/,
    "rendering should exclude activity-like typeless parts from the visible assistant body",
  );
  assert.match(
    messageComponentsSource,
    /source !== "parts" && source !== "content" && source !== "text"/,
    "reasoning leak guard should inspect parts-sourced assistant body text too",
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
