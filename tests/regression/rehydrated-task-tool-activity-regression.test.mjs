import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("rehydrated SDK task tool parts project into the activity timeline", () => {
  assert.match(
    source,
    /const fromSnapshotParts = progressItemsFromRawResponseParts\(\{\s*parts: hydratedActivityParts,\s*\}\);[\s\S]*?return mergeProgressItemsForTimeline\(/,
    "standalone hydrated message parts must flow through the canonical timeline merge unconditionally (no length guard)",
  );
  assert.match(
    source,
    /const rawTitle = firstNonEmptyString\([\s\S]*?asString\(stateRec\?\.title\)/,
    "task tools must use their SDK state title instead of a generic label",
  );
});

test("rehydrated canonical activity arrays are not concatenated twice", () => {
  assert.match(
    source,
    /Array\.isArray\(candidate\.steps\)\s*&&\s*candidate\.steps\.length\s*>\s*0[\s\S]*?return candidate\.steps;[\s\S]*?return Array\.isArray\(candidate\.progressEvents\)/,
    "hydrated sibling messages should prefer the canonical steps array when progressEvents mirrors it",
  );
  assert.match(
    source,
    /Array\.isArray\(cardMessage\?\.steps\)\s*&&\s*cardMessage\.steps\.length\s*>\s*0[\s\S]*?\?\s*cardMessage\.steps[\s\S]*?:\s*\(cardMessage\?\.progressEvents \?\? \[\]\)/,
    "the current hydrated card should use progressEvents only as a fallback",
  );
});

test("live task tool events use the same SDK state title and streaming activity path", () => {
  assert.match(
    handlerSource,
    /const isProgressPartType =\s*partType === "tool"/,
    "live tool events must be classified as streaming progress",
  );
  assert.match(
    handlerSource,
    /asString\(part\.title\) \|\|\s*asString\(stateObj\?\.title\) \|\|\s*\(tool \? `Running \$\{tool\}\.\.\.`/,
    "live task tools must prefer state.title before the generic running label",
  );
  assert.match(
    handlerSource,
    /const activityMessageID = firstNonEmptyString\(\s*asString\(part\.messageID\),\s*asString\(part\.messageId\),\s*messageId,/,
    "live task tools must prefer the SDK part message ID over stream fallbacks",
  );
  assert.match(
    handlerSource,
    /messageID: step\.messageID \|\| current\.messageID/,
    "streaming step updates must preserve their owning message ID",
  );
});
