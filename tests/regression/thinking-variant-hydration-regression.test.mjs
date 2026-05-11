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

test("variant-bearing final message is persisted and sent to webview", () => {
  assert.match(
    providerSource,
    /await this\.sessionService\.appendMessage\(session\.id,\s*\{[\s\S]*\.\.\.finalMessage[\s\S]*\}\);/,
    "appendMessage should persist the variant-enriched final message",
  );
  assert.match(
    providerSource,
    /await this\.persistSessionMessageOverride\(session\.id,\s*\{[\s\S]*\.\.\.debugMessage[\s\S]*\}\);/,
    "message override should persist rawResponse + variant for hydrated reload parity",
  );
  assert.match(
    providerSource,
    /type:\s*"messageResponse"[\s\S]*message:\s*\{[\s\S]*\.\.\.debugMessage[\s\S]*\}/,
    "webview messageResponse should include debugMessage carrying variant metadata",
  );
});

