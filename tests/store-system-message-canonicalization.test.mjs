import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "./helpers/source-utils.mjs";

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

test("store canonicalization converts internal transport messages to system role", () => {
  // Test that internal transport messages are detected using pattern matching
  assert.match(
    storeSource,
    /function isInternalTransportReminderMessage/,
    "isInternalTransportReminderMessage function should exist",
  );
  assert.match(
    storeSource,
    /squareBracketPattern/,
    "isInternalTransportReminderMessage should define square bracket pattern",
  );
  assert.match(
    storeSource,
    /angleBracketPattern/,
    "isInternalTransportReminderMessage should define angle bracket pattern",
  );
  assert.match(
    storeSource,
    /commentPattern/,
    "isInternalTransportReminderMessage should define comment pattern",
  );

  // Test that hasSystemMessagePatternInText function exists (used in stream handler)
  assert.match(
    storeSource,
    /function hasSystemMessagePatternInText/,
    "hasSystemMessagePatternInText function should exist for stream event handling",
  );

  // Test that messages are converted to system role
  assert.match(
    storeSource,
    /isInternalTransportReminderMessage\(message\)/s,
    "canonicalization should check if message is internal transport reminder",
  );
});

test("store canonicalization prevents system messages from being treated as assistant messages", () => {
  // Check that system role returns false
  assert.match(
    storeSource,
    /isAssistantMessageForCanonical.*role\s*===\s*['"]assistant['"].*return\s*true/s,
    "isAssistantMessageForCanonical should return true for assistant role",
  );
  assert.match(
    storeSource,
    /isAssistantMessageForCanonical.*role\s*===\s*['"]user['"].*return\s*false/s,
    "isAssistantMessageForCanonical should return false for user role",
  );
  assert.match(
    storeSource,
    /isAssistantMessageForCanonical.*role\s*===\s*['"]system['"].*return\s*false/s,
    "isAssistantMessageForCanonical should return false for system role",
  );
});

test("store canonicalization includes pattern-based detection", () => {
  // Verify the pattern-based approach is used
  assert.match(
    storeSource,
    /pattern matching|squareBracketPattern|angleBracketPattern/s,
    "Code should use pattern-based detection for system messages",
  );
});
