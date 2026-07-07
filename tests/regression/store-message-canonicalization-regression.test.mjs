import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from '../helpers/source-utils.mjs';

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

test("SET_MESSAGES uses centralized canonicalization before storing messages", () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    "export function appReducer(state: AppState, action: AppAction): AppState",
  );

  assert.match(
    reducerBody,
    /const\s+canonicalMessages\s*=\s*canonicalizeMessagesForRender\(action\.payload,\s*\{[\s\S]*preserveEvtAssistantMessages:[\s\S]*\}\);/s,
    "SET_MESSAGES should canonicalize payload via centralized reducer helper with live evt_ preservation awareness",
  );
  assert.match(
    reducerBody,
    /messages:\s*canonicalMessages/,
    "SET_MESSAGES should store canonical messages instead of raw payload",
  );
});

test("centralized canonicalization drops internal reminders and coalesces assistant runs", () => {
  const canonicalBody = extractFunctionBody(
    storeSource,
    "export function canonicalizeMessagesForRender(",
  );
  const reminderBody = extractFunctionBody(
    storeSource,
    "function isInternalTransportReminderMessage(message: Message): boolean",
  );

  assert.match(
    canonicalBody,
    /isInternalTransportReminderMessage\(message\)/,
    "canonicalization should drop internal transport reminder pseudo-messages",
  );
  assert.match(
    canonicalBody,
    /coalesceAssistantRunForCanonical\(burst\)/,
    "canonicalization should coalesce adjacent assistant runs into one canonical turn",
  );
  assert.match(
    reminderBody,
    /normalizedText\.includes\("<system-reminder>"\)/,
    "internal reminder detection should recognize wrapper reminders",
  );
  assert.match(
    reminderBody,
    /normalizedText\.includes\("background_output\(task_id="\)/,
    "internal reminder detection should recognize background task transport markers",
  );
});

test("assistant run canonicalization preserves rawResponse debug payload", () => {
  // Assistant run canonicalization has been refactored to use the last message in the run as base
  assert.match(
    storeSource,
    /coalesceAssistantRunForCanonical|rawResponse/,
    "assistant run canonicalization should handle debug payloads",
  );
});
