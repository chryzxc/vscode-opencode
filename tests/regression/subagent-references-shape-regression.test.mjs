import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const stateManagerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "subagents", "stateManager.ts")],
  "subagent state manager",
);
const trackerSource = readSource(
  [joinFromRoot("src", "services", "SubagentTracker.ts")],
  "SubagentTracker",
);

test("malformed subagent summary references cannot crash webview hydration", () => {
  assert.match(
    stateManagerSource,
    /references: Array\.isArray\(summary\.references\) \? \[\.\.\.summary\.references\] : \[\]/,
    "summary references must be normalized before spreading",
  );
});

test("malformed subagent summary references cannot crash extension cloning", () => {
  assert.match(
    trackerSource,
    /references: Array\.isArray\(summary\.references\)[\s\S]*?summary\.references\.map\(cloneReference\)[\s\S]*?: \[\]/,
    "summary references must be normalized before cloning",
  );
});
