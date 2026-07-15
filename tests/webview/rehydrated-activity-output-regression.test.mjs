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
