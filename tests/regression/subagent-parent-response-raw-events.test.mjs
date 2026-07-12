import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const tracker = readSource(
  [joinFromRoot("src", "services", "SubagentTracker.ts")],
  "SubagentTracker.ts",
);
const sessionService = readSource(
  [joinFromRoot("src", "services", "SessionService.ts")],
  "SessionService.ts",
);
const extractor = readSource(
  [
    joinFromRoot(
      "webview",
      "shared",
      "src",
      "chat",
      "lib",
      "subagents",
      "centralExtractor.ts",
    ),
  ],
  "centralExtractor.ts",
);
const shell = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

test("subagent details preserve a bounded raw event tape", () => {
  assert.match(tracker, /rawEvents:\s*unknown\[\]/);
  assert.match(tracker, /appendRawEvent\(detail, event\)/);
  assert.match(sessionService, /compact\.rawEvents/);
});

test("centralized subagents stay attached to their assistant response block", () => {
  assert.match(
    extractor,
    /resolvedParentMessageId = findUltimateParentMessageId/,
  );
  assert.match(
    extractor,
    /resolvedParentMessageId !== parentMessageId/,
  );
  assert.match(
    shell,
    /extractSubagentsFromCentralizedEvents\(messageEvents, messageId\)/,
  );
});
