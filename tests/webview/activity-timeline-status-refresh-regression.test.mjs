import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const messageComponentsSource = readFileSync(
  new URL("../../webview/shared/src/chat/MessageComponents.tsx", import.meta.url),
  "utf8",
);

test("activity timeline sticky merge refreshes rows when status changes in place", () => {
  assert.match(
    messageComponentsSource,
    /function displayEventNeedsReplacement\(/,
    "sticky activity rows should use a replacement helper for in-place lifecycle updates",
  );

  assert.match(
    messageComponentsSource,
    /existing\.status !== incoming\.status/,
    "status changes should force sticky activity rows to refresh instead of staying on the old icon",
  );

  assert.match(
    messageComponentsSource,
    /existingFingerprint !== fingerprint[\s\S]*incomingPriority > existingPriority[\s\S]*needsReplacement/s,
    "sticky timeline merge should replace rows when lifecycle fields change even if identity and source stay the same",
  );
});
