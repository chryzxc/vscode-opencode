/**
 * Regression: Large text pastes must convert to .txt attachment
 * even when the clipboard also contains image items.
 *
 * Bug: Rich-text clipboard copies from IDEs/browsers include an image/png
 * fallback alongside text/plain. The old condition checked
 * `!items.some(it => it.type.startsWith("image/"))` which blocked text
 * conversion whenever any image item existed — so large text pastes
 * showed as "image-1" instead of a .txt attachment.
 *
 * Fix: Removed the image-item exclusion. Large text pastes (>= 2000 chars)
 * always convert to .txt regardless of other clipboard representations.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot } from "../helpers/source-utils.mjs";

const panelSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "PanelComponents.tsx")],
  "PanelComponents.tsx",
);

function extractHandlePaste(source) {
  const start = source.indexOf("const handlePaste =");
  if (start === -1) return "";
  // Find the matching closing brace by tracking depth
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") {
      if (bodyStart === -1) bodyStart = i;
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0 && bodyStart > -1) {
        return source.slice(start, i + 1);
      }
    }
  }
  return source.slice(start, start + 2000);
}

test("paste threshold constant exists and is 2000 characters", () => {
  assert.match(
    panelSource,
    /const PASTE_TEXT_ATTACHMENT_THRESHOLD = 2000/,
    "threshold constant must exist",
  );
});

test("large text paste converts to txt without checking for image items", () => {
  const handler = extractHandlePaste(panelSource);
  assert.ok(handler.length > 0, "handlePaste must exist");

  const thresholdIdx = handler.indexOf("PASTE_TEXT_ATTACHMENT_THRESHOLD");
  assert.ok(thresholdIdx > -1, "threshold constant must appear in handler");
  const textBranch = handler.slice(
    thresholdIdx,
    handler.indexOf("return;", thresholdIdx) + 6,
  );

  assert.match(
    textBranch,
    /pastedText\.length >= PASTE_TEXT_ATTACHMENT_THRESHOLD/,
    "must check text length threshold",
  );

  assert.match(
    textBranch,
    /data:text\/plain/,
    "must create text/plain data URL",
  );

  assert.match(
    textBranch,
    /\.txt/,
    "filename must use .txt extension",
  );

  assert.match(
    textBranch,
    /ADD_ATTACHMENT/,
    "must dispatch ADD_ATTACHMENT",
  );

  // The critical regression: old code had
  // `!Array.from(items).some((it) => it.type.startsWith("image/"))`
  // which blocked text conversion when images existed in clipboard
  assert.doesNotMatch(
    textBranch,
    /items\)\.some\(\(it\) => it\.type\.startsWith\("image\/"\)\)/,
    "must NOT check for image items before converting text — this was the bug",
  );
});

test("text paste branch returns early before image handling code", () => {
  const handler = extractHandlePaste(panelSource);
  const textBranchEnd = handler.indexOf("return;");
  const imageBranchStart = handler.indexOf("pastedImage", textBranchEnd);

  assert.ok(
    textBranchEnd > -1 && imageBranchStart > textBranchEnd,
    "text paste branch must return before image handling code runs",
  );
});
