import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [
    joinFromRoot(
      "webview",
      "shared",
      "src",
      "chat",
      "lib",
      "streamingCardVisibility.ts",
    ),
  ],
  "streamingCardVisibility.ts",
);

test("a matching transcript takes ownership only after live streaming completes", () => {
  assert.match(
    source,
    /const hasMatchingAssistantTurnInTranscript =[\s\S]*?if \(hasMatchingAssistantTurnInTranscript && !streaming\.isActive\) return false;/,
    "a transcript placeholder must not hide live reasoning and tool events",
  );
});
