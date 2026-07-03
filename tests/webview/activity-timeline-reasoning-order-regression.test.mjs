import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const messageComponentsSource = readFileSync(
  new URL("../../webview/shared/src/chat/MessageComponents.tsx", import.meta.url),
  "utf8",
);

test("finalized reasoning rows use centralized raw order before key timestamp fallback", () => {
  assert.match(
    messageComponentsSource,
    /upsertThoughtItem\(\{[\s\S]*streamSeq: index,[\s\S]*source: "final"/s,
    "reasoning rows from centralized data should capture their raw tape index",
  );

  assert.match(
    messageComponentsSource,
    /seq:\s*typeof item\.streamSeq === "number"[\s\S]*item\.streamSeq[\s\S]*seqFromThoughtKey\(item\.key\)/s,
    "display-event assembly should prefer centralized raw order for reasoning before falling back to key timestamps",
  );
});
