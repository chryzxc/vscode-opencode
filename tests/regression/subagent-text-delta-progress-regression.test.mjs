import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const trackerSource = readSource(
  [joinFromRoot("src", "services", "SubagentTracker.ts")],
  "SubagentTracker.ts",
);

test("text deltas are never synthesized as subagent progress steps", () => {
  const start = trackerSource.indexOf("private extractProgressFromPart(");
  const end = trackerSource.indexOf("private bindChildSessionToKnownSubtask(", start);
  const extractProgressBody = trackerSource.slice(start, end);

  assert.doesNotMatch(extractProgressBody, /title:\s*`\$\{partType\}: \$\{deltaLabel\}`/);
  assert.match(extractProgressBody, /Only explicit progress-bearing part/);
});

test("streamed markup chunks do not gain a space after an opening angle bracket", () => {
  assert.match(trackerSource, /!\/\[\(\[\{<\]\$\//);
});
