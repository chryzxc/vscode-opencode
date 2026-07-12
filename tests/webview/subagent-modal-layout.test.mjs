import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const modalSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "SubagentDetailModal.tsx")],
  "SubagentDetailModal.tsx",
);

test("subagent detail modal uses one scroll container for its conversation", () => {
  assert.match(
    modalSource,
    /oc-modal-content min-h-0(?: [^\"]+)? overflow-y-auto/,
    "the modal content region should own vertical scrolling",
  );

  const stepperClass = modalSource.match(
    /className="([^"]*oc-refined-stepper[^"]*)"\s*\n\s*autoScrollToBottom=\{false\}/,
  )?.[1];

  assert.ok(stepperClass, "the conversation stepper should remain present");
  assert.doesNotMatch(
    stepperClass,
    /(?:overflow-y-auto|max-h-\[)/,
    "the conversation stepper must not create a nested vertical scroll region",
  );

  assert.doesNotMatch(
    modalSource,
    /sticky top-0 z-\[1\].*Assistant Conversation/s,
    "the conversation label must scroll with its content instead of overlaying timeline rows",
  );
  assert.match(
    modalSource,
    /document\.body\.style\.overflow = "hidden"/,
    "opening the modal should prevent the page behind it from becoming a second scroll target",
  );
  assert.doesNotMatch(modalSource, /Copy Refs|Jump to Parent|onCopyRefs|onJumpToParent/);
});

test("subagent selection is stored outside stream-remounted message cards", () => {
  const messageSource = readSource(
    [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
    "MessageComponents.tsx",
  );

  assert.match(messageSource, /selectedSubagentId: state\.selectedSubagentId/);
  assert.match(
    messageSource,
    /const openSubagentModal[\s\S]*?SELECT_SUBAGENT", payload: subagentId/s,
  );
});
