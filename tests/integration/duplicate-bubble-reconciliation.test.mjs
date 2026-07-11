/**
 * Regression: Synthetic user text parts must not create duplicate
 * optimistic user bubbles in the centralized transcript.
 *
 * Bug: When a user message contained real text ("read this line") plus
 * synthetic text parts (tool call echoes like "Called the Read tool..."
 * and file dump content), the centralized builder used text-pattern
 * heuristics to filter synthetic content. Some synthetic parts (like
 * markdown headers "## Phase 2...") didn't match the heuristic, so the
 * canonical visible text became "read this line\n\n## Phase 2...".
 *
 * The pending optimistic overlay only knew "read this line", so
 * normalizeComparableText comparison failed and the optimistic bubble
 * survived alongside the canonical message → duplicate "read this line"
 * bubbles.
 *
 * Fix: buildVisibleUserMessageText() now structurally filters parts with
 * `synthetic !== true` BEFORE extracting text, so all synthetic parts are
 * excluded regardless of content patterns.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

function extractBuildVisibleUserMessageText(source) {
  const start = source.indexOf("function buildVisibleUserMessageText(");
  if (start === -1) return "";
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 2);
}

test("buildVisibleUserMessageText structurally filters synthetic parts", () => {
  const body = extractBuildVisibleUserMessageText(chatShellSource);
  assert.ok(body.length > 0, "function must exist");

  assert.match(
    body,
    /\.filter\(\(part\) => part\?\.synthetic !== true\)/,
    "must filter out parts with synthetic: true BEFORE extracting text",
  );

  assert.match(
    body,
    /splitInjectedSystemPromptFromUserText/,
    "must still split injected system prompts",
  );

  assert.match(
    body,
    /isSyntheticUserToolText/,
    "must still apply text-pattern filtering as secondary defense",
  );

  assert.match(
    body,
    /normalizeComparableText/,
    "must dedupe visible texts by normalized comparison",
  );
});

test("buildVisibleUserMessageText falls back to rawText when all parts are synthetic", () => {
  const body = extractBuildVisibleUserMessageText(chatShellSource);

  assert.match(
    body,
    /if \(visibleTexts\.length === 0\)/,
    "must check for empty visible texts after filtering",
  );

  assert.match(
    body,
    /return splitInjectedSystemPromptFromUserText\(rawText/,
    "must fall back to rawText when no visible parts remain",
  );
});

test("isRenderableUserTextPart structurally excludes synthetic parts for user role", () => {
  const fnStart = messageComponentsSource.indexOf("function isRenderableUserTextPart(");
  assert.ok(fnStart > -1, "isRenderableUserTextPart must exist");

  const fnBody = messageComponentsSource.slice(fnStart, fnStart + 600);

  assert.match(
    fnBody,
    /\(part as \{ synthetic\?: unknown \}\)\.synthetic === true/,
    "must check synthetic flag and return false for synthetic parts",
  );
});

test("messageBodyFromParts accepts optional role parameter for user-aware filtering", () => {
  const fnStart = messageComponentsSource.indexOf("function messageBodyFromParts(");
  assert.ok(fnStart > -1, "messageBodyFromParts must exist");

  const fnBody = messageComponentsSource.slice(fnStart, fnStart + 800);

  assert.match(
    fnBody,
    /role\??: string/,
    "must accept optional role parameter",
  );

  assert.match(
    fnBody,
    /role\?\.toLowerCase\(\) === "user"/,
    "must check for user role to apply stricter filtering",
  );
});
