import test from "node:test";
import assert from "node:assert/strict";
import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

const typesSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "types.ts")],
  "types.ts",
);

test("message types include message-level change summary payload", () => {
  assert.match(
    typesSource,
    /export\s+interface\s+MessageChangeSummary/,
    "types should define MessageChangeSummary",
  );
  assert.match(
    typesSource,
    /changeSummary\?:\s*MessageChangeSummary/,
    "Message should include optional changeSummary payload",
  );
});

test("assistant message renders completion change summary card with actions", () => {
  assert.match(
    messageComponentsSource,
    /const\s+changeSummary\s*=\s*message\?\.changeSummary/,
    "AssistantMessage should read message.changeSummary",
  );
  assert.match(
    messageComponentsSource,
    /type:\s*"undoMessageChanges"/,
    "card should post undoMessageChanges action",
  );
  assert.match(
    messageComponentsSource,
    /type:\s*"reviewMessageChanges"/,
    "card should post reviewMessageChanges action",
  );
  assert.match(
    messageComponentsSource,
    /changeSummary\.files\.slice\(0,\s*12\)\.map/,
    "card should render changed file rows",
  );
});

test("file change summary normalizes .sisyphus absolute and relative paths to avoid duplicates", () => {
  assert.match(
    messageComponentsSource,
    /const\s+hiddenSisyphusMarker\s*=\s*["']\/\.sisyphus\/["']/,
    "path normalization should detect hidden .sisyphus absolute marker",
  );
  assert.match(
    messageComponentsSource,
    /return\s+`sisyphus\/\$\{lower\.slice\(hiddenIdx\s*\+\s*hiddenSisyphusMarker\.length\)\}`/,
    "hidden .sisyphus paths should be canonicalized to sisyphus/*",
  );
  assert.match(
    messageComponentsSource,
    /const\s+plainSisyphusMarker\s*=\s*["']\/sisyphus\/["']/,
    "path normalization should also detect plain sisyphus marker",
  );
});
