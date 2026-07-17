import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "../helpers/source-utils.mjs";

const panelSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "PanelComponents.tsx")],
  "PanelComponents.tsx",
);
const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("normal sends render inline immediately and do not mount the legacy queue list", () => {
  const sendPrompt = extractFunctionBody(panelSource, "const sendPrompt = () =>");
  assert.match(
    sendPrompt,
    /const pendingSessionId[\s\S]*?dispatch\(\{\s*type: "ADD_PENDING_USER_MESSAGE"/,
    "normal sends must add an inline optimistic user message",
  );
  assert.doesNotMatch(
    panelSource,
    /<QueueContainer\s*\/>/,
    "the composer must not mount the legacy extension queue list",
  );
});

test("a busy SDK session does not rewrite normal sends into QueueManager items", () => {
  const scheduleBody = extractFunctionBody(providerSource, "private async schedulePromptDispatch(");
  assert.doesNotMatch(
    scheduleBody,
    /statusType === "busy"[\s\S]*?effectiveMode = "queue"/,
    "normal sends must remain direct rather than entering the extension queue",
  );
});
