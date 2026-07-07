import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("activity timeline promotes file.edited events into edit rows", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function progressItemsFromRawEventPayloads(",
  );

  assert.match(
    body,
    /if \(eventType === "file\.edited" \|\| eventType === "file\.watcher\.updated"\)/,
    "top-level file system events should be normalized into activity timeline rows",
  );
  assert.match(
    body,
    /if \(eventType === "file\.edited"\) \{\s*title = "edit";/s,
    "file.edited events should use the existing edit-style activity row label",
  );
});

test("activity timeline uses watcher event names as row labels", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function progressItemsFromRawEventPayloads(",
  );

  assert.match(
    body,
    /title = watcherEvent \|\| "file watcher updated";/,
    "file.watcher.updated rows should surface the watcher event verb such as add",
  );
  assert.doesNotMatch(
    body,
    /tool:\s*"file_watcher"/,
    "file watcher rows should not force a generic file_watcher label when a more specific verb is available",
  );
});
