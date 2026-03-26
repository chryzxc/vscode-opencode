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
  // Test that internal transport messages are detected
  assert.match(
    storeSource,
    /function isInternalTransportReminderMessage/,
    "isInternalTransportReminderMessage function should exist",
  );
  assert.match(
    storeSource,
    /isInternalTransportReminderMessage.*normalizedText\.includes\("<system-reminder>"\)/s,
    "isInternalTransportReminderMessage should recognize <system-reminder> payloads",
  );
  assert.match(
    storeSource,
    /isInternalTransportReminderMessage.*normalizedText\.includes\("<auto-slash-command>"\)/s,
    "isInternalTransportReminderMessage should recognize <auto-slash-command> payloads",
  );
  assert.match(
    storeSource,
    /isInternalTransportReminderMessage.*hasBracketPrefix/s,
    "isInternalTransportReminderMessage should use bracket prefix detection",
  );

  // Test that messages are converted to system role
  assert.match(
    storeSource,
    /isInternalTransportReminderMessage\(message\).*role:\s*['"]system['"]/s,
    "canonicalization should convert message role to 'system'",
  );
  assert.match(
    storeSource,
    /isInternalTransportReminderMessage\(message\).*responseType:\s*['"]system['"]/s,
    "canonicalization should set responseType to 'system'",
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

test("store canonicalization includes debug logging for system message conversion", () => {
  assert.match(
    storeSource,
    /console\.log.*\[DEBUG\].*Converted to system role/s,
    "canonicalization should log when converting internal transport messages",
  );
});

test("store canonicalization logs messages at each stage", () => {
  assert.match(
    storeSource,
    /console\.log.*\[DEBUG\]/s,
    "canonicalizeMessagesForRender should include debug logging",
  );
});
