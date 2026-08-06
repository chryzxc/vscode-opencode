import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("malformed stream events are ignored before state processing", () => {
  assert.match(
    source,
    /function handleStreamEvent\([\s\S]*?\): void \{\s*if \(!payload \|\| typeof payload !== "object"\) return;/s,
    "the stream handler must ignore null or missing event payloads",
  );
});
