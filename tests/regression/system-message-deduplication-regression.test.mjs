/**
 * System Message Deduplication Regression Test
 *
 * Tests for the fix that prevents duplicate system messages (like <auto-slash-command>)
 * from appearing in the chat.
 *
 * Bug: When internal transport messages are converted to system role, they were not
 * being deduplicated, causing duplicates to appear.
 *
 * Fix: Extended deduplication logic in dedupeMirrorMessagesForCanonical to include
 * system role messages in text-based deduplication.
 */

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

test("system message deduplication includes system role in text-based deduplication", () => {
  const dedupeBody = extractFunctionBody(
    storeSource,
    "function dedupeMirrorMessagesForCanonical(messages: Message[]): Message[]",
  );

  // Check that the deduplication logic includes system role
  assert.match(
    dedupeBody,
    /role\s*===\s*["']system["']/,
    "dedupeMirrorMessagesForCanonical should check for system role in deduplication",
  );

  // Verify the comment explains the fix
  assert.match(
    dedupeBody,
    /deduplicate.*system.*messages/i,
    "dedupeMirrorMessagesForCanonical should have a comment explaining system message deduplication",
  );
});

test("system message deduplication prevents duplicate <auto-slash-command> messages", () => {
  const canonicalizeBody = extractFunctionBody(
    storeSource,
    "function canonicalizeMessagesForRender(messages: Message[]): Message[]",
  );

  // Verify that internal transport messages are converted to system role
  assert.match(
    canonicalizeBody,
    /isInternalTransportReminderMessage/,
    "canonicalizeMessagesForRender should check for internal transport reminder messages",
  );
  assert.match(
    canonicalizeBody,
    /role:\s*['"]system["']/,
    "canonicalizeMessagesForRender should convert message role to 'system'",
  );

  // Verify deduplication is called
  assert.match(
    canonicalizeBody,
    /dedupeMirrorMessagesForCanonical/,
    "canonicalizeMessagesForRender should deduplicate messages",
  );
});

test("system message deduplication uses normalized text for comparison", () => {
  const dedupeBody = extractFunctionBody(
    storeSource,
    "function dedupeMirrorMessagesForCanonical(messages: Message[]): Message[]",
  );

  // Check that text normalization is used
  assert.match(
    dedupeBody,
    /normalizedText/,
    "dedupeMirrorMessagesForCanonical should use normalized text for comparison",
  );

  // Check that comparison uses text
  assert.match(
    dedupeBody,
    /entryText/,
    "dedupeMirrorMessagesForCanonical should compare entry text",
  );
});
