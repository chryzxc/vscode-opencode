import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("activity timeline excludes low-level file notifications", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function progressItemsFromRawEventPayloads(",
  );

  assert.match(
    body,
    /if \(eventType === "file\.edited" \|\| eventType === "file\.watcher\.updated"\)/,
    "top-level file notifications must be handled explicitly",
  );
  assert.match(
    body,
    /rememberSkipped\("filesystem_notification", event, index\);\s*continue;/s,
    "filesystem notifications must never be projected as timeline activity",
  );
});

test("activity timeline keeps actual tool activity separate from filesystem notifications", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function progressItemsFromRawEventPayloads(",
  );

  assert.doesNotMatch(
    body,
    /buildSyntheticFileActivityStep/,
    "the raw mapper must not synthesize File.Edited or File.Watcher.Updated rows",
  );
  assert.match(
    body,
    /if \(partType === "text"\)/,
    "normal raw-part projection remains in place for meaningful SDK tool activity",
  );
});
