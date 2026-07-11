/**
 * Regression: Code selections attached to user messages must render as
 * clickable chips that open a preview modal, not as inline text or
 * dropped attachments.
 *
 * Bug: The new code-selection part type (type:"file" with source.type:"file",
 * source.lineInfo, source.text.value) was being misclassified by
 * isExplicitFileAttachmentPart as a regular file attachment, so it showed
 * as a plain file chip with no preview capability. The selection content
 * was invisible to the user.
 *
 * Fix: MessageComponents now has:
 *   1. isCodeSelectionPart() — distinguishes selection parts from file parts
 *   2. collectCodeSelectionsFromParts() — builds CodeSelectionChipData[]
 *   3. parseLineRange() + rangeToLines() — normalize line info
 *   4. UserMessage renders clickable <button> chips that open CodeSelectionPreviewModal
 *   5. isExplicitFileAttachmentPart excludes code-selection parts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot, extractFunctionBody } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("isCodeSelectionPart type guard distinguishes code selections from regular file parts", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function isCodeSelectionPart(",
  );
  assert.ok(body.length > 0, "isCodeSelectionPart must exist");

  // Must check type === "file" AND source.type === "file" AND has lineInfo AND has text.value
  assert.match(
    body,
    /type === "file"/,
    "must check part type is file",
  );
  assert.match(
    body,
    /sourceType === "file"/,
    "must check source.type is file (distinguishes from regular file attachments)",
  );
  assert.match(
    body,
    /lineInfo\.length > 0/,
    "must require non-empty lineInfo — this is what makes it a selection, not a plain file",
  );
  assert.match(
    body,
    /typeof textValue === "string"/,
    "must require text.value to be a string",
  );
});

test("isExplicitFileAttachmentPart excludes code-selection parts", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function isExplicitFileAttachmentPart(",
  );
  assert.ok(body.length > 0, "isExplicitFileAttachmentPart must exist");

  assert.match(
    body,
    /if \(isCodeSelectionPart\(part\)\) return false/,
    "must return false for code-selection parts so they don't render as plain file chips",
  );
});

test("collectCodeSelectionsFromParts builds chip data from selection parts", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function collectCodeSelectionsFromParts(",
  );
  assert.ok(body.length > 0, "collectCodeSelectionsFromParts must exist");

  assert.match(
    body,
    /if \(!isCodeSelectionPart\(part\)\) continue/,
    "must skip non-selection parts",
  );

  assert.match(
    body,
    /source\.text\?\.value/,
    "must extract content from source.text.value",
  );

  assert.match(
    body,
    /parseLineRange\(source\.lineInfo\)/,
    "must parse line range from source.lineInfo",
  );
});

test("parseLineRange extracts start and end line numbers from lineInfo", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function parseLineRange(",
  );
  assert.ok(body.length > 0, "parseLineRange must exist");

  // Matches "5" → {startLine:5} and "5-10" → {startLine:5, endLine:10}
  assert.match(
    body,
    /\(\\d\+\)\(?:\\s\*-\\s\*\(\\d\+\)\)\?/,
    "must match both single-line and line-range patterns",
  );
});

test("rangeToLines converts source range to 1-based line numbers", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function rangeToLines(",
  );
  assert.ok(body.length > 0, "rangeToLines must exist");

  // +1 because editor lines are 0-based in the source range
  assert.match(
    body,
    /range\.start\?\.line \+ 1/,
    "must convert 0-based start.line to 1-based",
  );
  assert.match(
    body,
    /range\.end\?\.line \+ 1/,
    "must convert 0-based end.line to 1-based",
  );
});

test("UserMessage collects code selections from message parts", () => {
  assert.match(
    messageComponentsSource,
    /const codeSelections = useMemo\([\s\S]*?collectCodeSelectionsFromParts\(message\?\.parts\)/s,
    "UserMessage must collect code selections from parts via useMemo",
  );
});

test("UserMessage renders clickable button chips for code selections that open preview", () => {
  // The chip must be a <button> (not a <div>) so it's keyboard-accessible
  assert.match(
    messageComponentsSource,
    /codeSelections\.map\([\s\S]*?<button[\s\S]*?onClick=\{\(\) => setPreviewSelection\(sel\)\}/s,
    "code selection chips must be buttons with onClick that sets preview selection",
  );

  assert.match(
    messageComponentsSource,
    /<FileCode/,
    "chips must render FileCode icon",
  );
});

test("UserMessage wires CodeSelectionPreviewModal with preview selection state", () => {
  assert.match(
    messageComponentsSource,
    /const \[previewSelection, setPreviewSelection\] = useState<CodeSelectionChipData \| null>\(null\)/,
    "UserMessage must maintain preview selection state",
  );

  assert.match(
    messageComponentsSource,
    /<CodeSelectionPreviewModal[\s\S]*?isOpen=\{previewSelection !== null\}[\s\S]*?data=\{previewSelection\}[\s\S]*?onClose=\{\(\) => setPreviewSelection\(null\)\}/s,
    "UserMessage must wire CodeSelectionPreviewModal with preview state",
  );
});

test("UserMessage renders even with only code selections and no text content", () => {
  // The early-return guard must account for codeSelections
  assert.match(
    messageComponentsSource,
    /if \(!content && !hasImages && !injectedSystemText && codeSelections\.length === 0/,
    "early-return guard must NOT bail when code selections exist",
  );
});
