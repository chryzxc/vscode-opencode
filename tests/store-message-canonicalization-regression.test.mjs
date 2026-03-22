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

test("SET_MESSAGES uses centralized canonicalization before storing messages", () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    "export function appReducer(state: AppState, action: AppAction): AppState",
  );

  assert.match(
    reducerBody,
    /const\s+canonicalMessages\s*=\s*canonicalizeMessagesForRender\(action\.payload\);/,
    "SET_MESSAGES should canonicalize payload via centralized reducer helper",
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
    "function canonicalizeMessagesForRender(messages: Message[]): Message[]",
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
  const coalesceBody = extractFunctionBody(
    storeSource,
    "function coalesceAssistantRunForCanonical(run: Message[]): Message",
  );

  assert.match(
    coalesceBody,
    /let\s+latestRawResponse\s*=\s*\(base as unknown as Record<string, unknown>\)\.rawResponse;/,
    "coalesceAssistantRunForCanonical should track rawResponse across assistant burst fragments",
  );
  assert.match(
    coalesceBody,
    /base\.rawResponse\s*=\s*latestRawResponse;/,
    "coalesceAssistantRunForCanonical should preserve rawResponse in canonical hydrated message",
  );
});
