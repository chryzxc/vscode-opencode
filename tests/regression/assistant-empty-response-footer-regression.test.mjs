import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("assistant footer copy button and timestamp only render when response content is copyable", () => {
  assert.match(
    messageSource,
    /const hasCopyableResponseContent = \(visibleResolvedContent\?\.trim\(\)\?\.length \?\? 0\) > 0;/,
    "assistant message should compute whether the response has copyable content",
  );
  assert.match(
    messageSource,
    /const shouldShowResponseActions =[\s\S]*isAssistantTurnCollapsed[\s\S]*isLastInBlock[\s\S]*shouldShowResponseActions &&[\s\S]*showResponseSection &&[\s\S]*hasCopyableResponseContent && \(/,
    "assistant actions should only render on completed collapsed response summaries",
  );
});
