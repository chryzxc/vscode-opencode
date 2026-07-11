/**
 * Regression: File attachment chips on user messages must show basename with
 * line suffix preserved, deduplicate across explicit and inferred sources,
 * and exclude image parts from the file chip group.
 *
 * Bug: User messages with file attachments showed the full path (or just
 * basename without line info), images appeared as both file chips AND image
 * thumbnails (duplicate rendering), and explicit+inferred file chips were
 * not deduplicated — so a file attached by name that also appeared in the
 * message text showed twice.
 *
 * Fix: MessageComponents now has:
 *   1. basenamePreservingLineSuffix() — extracts basename, preserves :line
 *   2. buildExplicitFileChipLabel() / buildExplicitFileChip() — build {label, path}
 *   3. isImageAttachmentPart() — filters image parts out of file chip group
 *   4. Dedup via Map keyed by `${path}:${label}`
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot, extractFunctionBody } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("basenamePreservingLineSuffix extracts basename and preserves line suffix", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function basenamePreservingLineSuffix(",
  );
  assert.ok(body.length > 0, "basenamePreservingLineSuffix must exist");

  // Must split on path separators [\\/] (both Windows and Unix)
  assert.match(
    body,
    /split\(/,
    "must split the label to extract basename",
  );
  assert.match(
    body,
    /\[\\\\\/\]/,
    "must split on both backslash and forward slash path separators",
  );
});

test("buildExplicitFileChipLabel derives label from filename or source path", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function buildExplicitFileChipLabel(",
  );
  assert.ok(body.length > 0, "buildExplicitFileChipLabel must exist");

  // Must prefer filename, fall back to source.path
  assert.match(
    body,
    /part\.filename/,
    "must read filename from part",
  );
  assert.match(
    body,
    /part\.source\?\.path/,
    "must fall back to source.path",
  );
  assert.match(
    body,
    /part\.source\?\.lineInfo/,
    "must read lineInfo from source",
  );
  assert.match(
    body,
    /basenamePreservingLineSuffix\(/,
    "must delegate to basenamePreservingLineSuffix for formatting",
  );
});

test("buildExplicitFileChip returns label and optional path", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function buildExplicitFileChip(",
  );
  assert.ok(body.length > 0, "buildExplicitFileChip must exist");

  assert.match(
    body,
    /label:/,
    "must return label field",
  );
  assert.match(
    body,
    /path:/,
    "must return path field",
  );
  assert.match(
    body,
    /return undefined/,
    "must return undefined when no label can be built",
  );
});

test("isImageAttachmentPart filters image parts out of file chip rendering", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function isImageAttachmentPart(",
  );
  assert.ok(body.length > 0, "isImageAttachmentPart must exist");

  assert.match(
    body,
    /type === "file"/,
    "must check part type is file",
  );
  assert.match(
    body,
    /mime\.startsWith\("image\/"\)/,
    "must check mime starts with image/",
  );
});

test("UserMessage file chips filter out image parts to avoid duplicate rendering", () => {
  // The filter must use BOTH isExplicitFileAttachmentPart AND !isImageAttachmentPart
  // so images render only as thumbnails, not as file chips too
  assert.match(
    messageComponentsSource,
    /\.filter\(\(part\) => isExplicitFileAttachmentPart\(part\) && !isImageAttachmentPart\(part\)\)/,
    "file chips must exclude image parts to prevent duplicate rendering",
  );
});

test("UserMessage deduplicates file chips by path+label key", () => {
  // Dedup must use a Map keyed by `${path}:${label}` so the same file from
  // explicit parts and inferred text doesn't show twice
  assert.match(
    messageComponentsSource,
    /new Map\([\s\S]*?\[...explicitFileChips, ...inferredFileChips\][\s\S]*?`\$\{chip\.path \?\? ""\}:\$\{chip\.label\}`/s,
    "file chips must be deduplicated by path+label key via Map",
  );
});

test("UserMessage file chips render with truncate and FileIcon", () => {
  assert.match(
    messageComponentsSource,
    /fileChips\.length > 0 && \(/,
    "must conditionally render file chips section",
  );
  assert.match(
    messageComponentsSource,
    /<FileIcon filePath=\{label\.path \|\| label\.label\}/,
    "file chips must render FileIcon with path",
  );
  assert.match(
    messageComponentsSource,
    /className="truncate"/,
    "file chip label must use truncate class",
  );
});
