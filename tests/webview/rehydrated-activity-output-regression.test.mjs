import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const modalSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "SubagentDetailModal.tsx")],
  "SubagentDetailModal.tsx",
);
const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

	test("rehydrated raw tool output remains visible in the activity timeline", () => {
	assert.match(modalSource, /const output = toolDataText\(state\?\.output\);/);
	assert.match(modalSource, /summary: output \|\| inputSummary/);
  assert.match(modalSource, /activityDetail: \{ tool, input: input \?\? \{\}, output \}/);
  assert.match(
    messageComponentsSource,
    /event\.filePath \|\| event\.activityDetail\?\.output/,
    "the shared activity surface should use persisted tool output when no summary is available",
  );
  assert.match(
    messageComponentsSource,
    /<CollapsedMarkdownPreview title=\{event\.label\} content=\{visibleSummary\} \/>/,
    "rehydrated output should use the same expandable preview as other activity content",
  );
});

test("live Bash activity renders its terminal payload without requiring a summary", () => {
  assert.match(
    messageComponentsSource,
    /\{labelLower === "bash" \|\| isGlobSearch \? \(\s*<div className="oc-refined-event-summary">\s*<TerminalBlockWithOutput/s,
    "Bash/Glob terminal previews must be selected before the generic visibleSummary gate",
  );
  assert.match(
    messageComponentsSource,
    /labelLower !== "read" && labelLower !== "todowrite" && !isEditLike && visibleSummary && \(/,
    "other generic activity rows should retain the existing summary visibility guard",
  );
});

test("empty system transport envelopes do not render an empty expandable card", () => {
  assert.match(
    messageComponentsSource,
    /if \(!displayContent\) \{\s*return null;\s*\}\s*\n\s*return \(\s*<div className="oc-message-enter mb-4"/s,
    "SystemMessage must return no UI when its transport envelope has no displayable text",
  );
});
