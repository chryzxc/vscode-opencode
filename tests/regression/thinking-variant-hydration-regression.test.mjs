import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("final assistant message stamps prompt variant for hydration parity", () => {
  assert.match(
    providerSource,
    /if \(promptVariant\) \{[\s\S]*variant:\s*promptVariant[\s\S]*info:\s*\{[\s\S]*variant:\s*promptVariant[\s\S]*\}/,
    "ChatViewProvider should inject variant into final assistant message and info before persistence",
  );
});

test("variant-bearing final message is sent live without a local hydration override", () => {
  assert.doesNotMatch(providerSource, /persistSessionMessageOverride/);
  assert.match(
    providerSource,
    /type:\s*"messageResponse"[\s\S]*message:\s*\{[\s\S]*\.\.\.debugMessage[\s\S]*\}/,
    "webview messageResponse should include debugMessage carrying variant metadata",
  );
});
