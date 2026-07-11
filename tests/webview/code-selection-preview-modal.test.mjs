/**
 * Regression: CodeSelectionPreviewModal must render highlighted code in a
 * portal with accessible title/line labels and keyboard escape dismissal.
 *
 * Context: When a user clicks a code-selection chip on their message, a
 * preview modal opens showing the selected code with syntax highlighting.
 * The modal must:
 *   1. Build a readable title (filename:lineInfo) from sparse chip data
 *   2. Build a line label for single vs range selections
 *   3. Close on Escape key and backdrop click
 *   4. Use hljs for syntax highlighting with language fallback
 *   5. Render via createPortal to document.body
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot, extractFunctionBody } from "../helpers/source-utils.mjs";

const modalSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "CodeSelectionPreviewModal.tsx")],
  "CodeSelectionPreviewModal.tsx",
);

test("CodeSelectionPreviewData interface defines all chip data fields", () => {
  assert.match(
    modalSource,
    /interface CodeSelectionPreviewData/,
    "must export CodeSelectionPreviewData interface",
  );
  assert.match(
    modalSource,
    /path\?:\s*string/,
    "must have optional path field",
  );
  assert.match(
    modalSource,
    /filename\?:\s*string/,
    "must have optional filename field",
  );
  assert.match(
    modalSource,
    /languageId\?:\s*string/,
    "must have optional languageId field",
  );
  assert.match(
    modalSource,
    /lineInfo\?:\s*string/,
    "must have optional lineInfo field",
  );
  assert.match(
    modalSource,
    /content:\s*string/,
    "must have required content field",
  );
  assert.match(
    modalSource,
    /startLine\?:\s*number/,
    "must have optional startLine field",
  );
  assert.match(
    modalSource,
    /endLine\?:\s*number/,
    "must have optional endLine field",
  );
});

test("buildLineLabel formats single and range line numbers correctly", () => {
  const body = extractFunctionBody(modalSource, "function buildLineLabel(");
  assert.ok(body.length > 0, "buildLineLabel must exist");

  // No start/end → fall back to lineInfo or empty
  assert.match(
    body,
    /lineInfo \?\? ""/,
    "must fall back to lineInfo string when no numeric lines",
  );

  // start && end && start !== end → "start-end"
  assert.match(
    body,
    /\$\{startLine\}-\$\{endLine\}/,
    "must format range as start-end when start differs from end",
  );
});

test("buildTitle combines filename and line info into modal title", () => {
  const body = extractFunctionBody(modalSource, "function buildTitle(");
  assert.ok(body.length > 0, "buildTitle must exist");

  // name falls back: filename ?? path ?? "code-selection"
  assert.match(
    body,
    /filename \?\? data\.path \?\? "code-selection"/,
    "must derive name from filename, path, or fallback to code-selection",
  );

  // If lines exist: `${name}:${lines}`, else just name
  assert.match(
    body,
    /lines \? `\$\{name\}:\$\{lines\}` : name/,
    "must append line info to title with colon separator",
  );
});

test("modal closes on Escape key", () => {
  assert.match(
    modalSource,
    /event\.key === "Escape"/,
    "must listen for Escape key to close modal",
  );
  assert.match(
    modalSource,
    /onClose\(\)/,
    "must call onClose when Escape is pressed",
  );
});

test("modal uses hljs with language fallback to auto-detection", () => {
  assert.match(
    modalSource,
    /hljs\.getLanguage\(/,
    "must check if hljs recognizes the language",
  );
  assert.match(
    modalSource,
    /hljs\.highlight\(/,
    "must use hljs.highlight when language is known",
  );
  assert.match(
    modalSource,
    /hljs\.highlightAuto\(/,
    "must fall back to hljs.highlightAuto for unknown languages",
  );
});

test("modal renders via createPortal to document.body", () => {
  assert.match(
    modalSource,
    /createPortal\(/,
    "must use createPortal for proper z-index stacking",
  );
  assert.match(
    modalSource,
    /document\.body/,
    "must portal into document.body",
  );
});

test("modal respects isOpen prop and does not render when closed", () => {
  assert.match(
    modalSource,
    /if \(!isOpen\) return null/,
    "must bail early when isOpen is false",
  );
});

test("modal closes on backdrop click", () => {
  // Backdrop click should close, but content click should not
  assert.match(
    modalSource,
    /onClick=\{onClose\}/,
    "backdrop must call onClose on click",
  );
});
