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
    /const hasMatchingAssistantTurnInTranscript =[\s\S]*?hasMatchingAssistantTurnInTranscript &&[\s\S]*?streaming\.hasAssistantFinishSignal === true &&[\s\S]*?hasTranscriptAssistantForCurrentTurn[\s\S]*?return false;/,
    "a transcript placeholder must not hide live reasoning and tool events until the explicit assistant-finish signal arrives for the current turn",
  );
});
