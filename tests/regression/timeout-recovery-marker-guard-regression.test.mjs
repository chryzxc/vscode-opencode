import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const historyProcessorSource = readSource(
  [joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts")],
  "HistoryProcessor.ts",
);

test("timeout recovery marker comparison does not assume iterable message arrays", () => {
  assert.match(
    historyProcessorSource,
    /if \(!Array\.isArray\(messages\) \|\| messages\.length === 0\)[\s\S]*richness:\s*-1/s,
    "getLatestAssistantHistoryMarker should guard non-array inputs before iterating",
  );

  assert.match(
    historyProcessorSource,
    /const asMarker = \(/,
    "hasAssistantHistoryAdvanced should normalize either arrays or marker objects",
  );

  assert.match(
    historyProcessorSource,
    /if \(Array\.isArray\(value\)\)[\s\S]*this\.getLatestAssistantHistoryMarker\(value\)/s,
    "hasAssistantHistoryAdvanced should still support array message history inputs",
  );

  assert.match(
    historyProcessorSource,
    /if \(typeof value === "object"\)[\s\S]*richness:/s,
    "hasAssistantHistoryAdvanced should support marker-object inputs from timeout recovery path",
  );
});

