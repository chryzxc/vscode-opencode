import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "StreamingComponents.tsx")],
  "StreamingComponents.tsx",
);

test("an active streaming card yields to a transcript card for the same assistant turn", () => {
  assert.match(
    source,
    /const hasMatchingAssistantTurnInTranscript =[\s\S]*?if \(hasMatchingAssistantTurnInTranscript\) return false;/,
    "matching assistant IDs must prevent a live and transcript card from rendering together",
  );
});
