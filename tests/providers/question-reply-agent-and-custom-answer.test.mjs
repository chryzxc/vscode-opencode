/**
 * Regression: questionReply promptAsync must include agent, and custom answer
 * field must not default to visible when the server doesn't allow it.
 *
 * Bug A: The promptAsync fallback in the questionReply handler omitted the
 * `agent` parameter. The server fell back to the workspace-configured default
 * agent, which may not exist, producing:
 *   Error: default agent "Sisyphus - Ultraworker" not found
 *
 * Bug B: `interactiveEventsFromQuestionAskedPayload` defaulted
 * `asBoolean(question.custom, true)`, making the "Custom Answer..." button
 * visible for every question even when the server sent concrete options and
 * did not enable custom input.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

function readSource(relPath) {
  return readFileSync(join(repoRoot, relPath), "utf-8");
}

function extractFunctionBody(source, signaturePattern) {
  const startIdx = source.indexOf(signaturePattern);
  if (startIdx === -1) return null;
  const braceStart = source.indexOf("{", startIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return source.slice(braceStart + 1, end);
}

// ---------------------------------------------------------------------------
// FIX A: questionReply promptAsync must include agent parameter
// ---------------------------------------------------------------------------

test("questionReply handler — promptAsync fallback includes agent parameter", () => {
  const source = readSource("src/providers/ChatViewProvider.ts");

  // Locate the promptAsync call inside the stale-question fallback path.
  const promptAsyncIdx = source.indexOf("asyncSession.promptAsync.call(");
  assert.notEqual(promptAsyncIdx, -1, "the async session prompt path should exist in ChatViewProvider");

  // Grab a generous window around the call to inspect its arguments.
  const window = source.slice(Math.max(0, promptAsyncIdx - 220), promptAsyncIdx + 600);

  assert.match(
    window,
    /const selectedAgent\s*=\s*this\.modelAndAgentManager\.getSelectedAgent\(\)[\s\S]*?shouldSendAgentToServer\(\)[\s\S]*?agent:\s*selectedAgent/,
    "promptAsync call must pass the selected agent when the server compatibility contract allows it",
  );
  assert.match(window, /sessionID:\s*replySessionId/, "promptAsync call must include sessionID");
  assert.match(window, /parts:\s*\[/, "promptAsync call must include parts");
});

// ---------------------------------------------------------------------------
// FIX B: interactiveEventsFromQuestionAskedPayload must not default custom to true
// ---------------------------------------------------------------------------

test("interactiveEventsFromQuestionAskedPayload defaults question.custom to false, not true", () => {
  const source = readSource("webview/shared/src/chat/lib/messageHandler.ts");

  const body = extractFunctionBody(
    source,
    "function interactiveEventsFromQuestionAskedPayload(",
  );
  assert.ok(body, "interactiveEventsFromQuestionAskedPayload should exist");

  // The allowCustomInput derivation inside this function must NOT use `true`
  // as the default for question.custom.
  const allowCustomMatch = body.match(
    /allowCustomInput\s*=\s*([\s\S]*?)(?:;\s*\n|;\s*$)/,
  );
  assert.ok(allowCustomMatch, "allowCustomInput derivation should exist in function body");

  const derivation = allowCustomMatch[1];
  assert.match(derivation, /allowCustomInput.*false/, "allowCustomInput should default from allowCustomInput: false");
  assert.match(derivation, /allow_custom_input.*false/, "allowCustomInput should default from allow_custom_input: false");

  // The critical regression assertion: question.custom must default to false.
  assert.doesNotMatch(
    derivation,
    /question\.custom,\s*true/,
    "question.custom must NOT default to true — this causes the custom answer button to appear for every question",
  );
  assert.match(
    derivation,
    /question\.custom,\s*false/,
    "question.custom must default to false so custom answer only appears when the server explicitly enables it",
  );
});

test("interactiveEventsFromQuestionAskedPayload still allows custom input when server explicitly sets it", () => {
  const source = readSource("webview/shared/src/chat/lib/messageHandler.ts");
  const body = extractFunctionBody(
    source,
    "function interactiveEventsFromQuestionAskedPayload(",
  );
  assert.ok(body);

  // Ensure the function still respects explicit allowCustomInput from server.
  assert.match(body, /allowCustomInput/, "allowCustomInput field should be set on the event");
  assert.match(body, /allowCustomInput,$/m, "allowCustomInput should be passed through to the event object");
});
