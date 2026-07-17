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
    /const fromSnapshotParts = progressItemsFromRawResponseParts\(\{\s*parts: cardMessage\?\.parts,\s*\}\);[\s\S]*?if \(fromSnapshotParts\.length > 0\)/,
    "standalone hydrated message parts must become progress items when no event tape is available",
  );
  assert.match(
    source,
    /const rawTitle = firstNonEmptyString\([\s\S]*?asString\(stateRec\?\.title\)/,
    "task tools must use their SDK state title instead of a generic label",
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
