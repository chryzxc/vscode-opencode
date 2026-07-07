import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const serverManagerSource = readSource(
  [joinFromRoot("src", "services", "OpencodeServerManager.ts")],
  "OpencodeServerManager.ts",
);
const chatProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("server manager classifies MaxListeners warnings as non-fatal stderr noise", () => {
  assert.match(
    serverManagerSource,
    /const NON_FATAL_SERVER_STDERR_PATTERNS = \[[\s\S]*MaxListenersExceededWarning/i,
    "server manager should keep a non-fatal stderr pattern list that includes MaxListeners warnings",
  );

  const logChunkBody = extractFunctionBody(
    serverManagerSource,
    "      const logServerChunk = (\n        channel: \"stdout\" | \"stderr\",\n        chunk: string,\n        state: { loggedChars: number; suppressed: boolean },\n      ) => {",
  );
  assert.match(
    logChunkBody,
    /if \(this\.isNonFatalServerStderrSnippet\(snippet\)\) \{[\s\S]*log\.warn\("Server stderr warning", \{ snippet \}\);[\s\S]*return;[\s\S]*\}/s,
    "non-fatal stderr warnings should be downgraded to warn logs and stop before UI surfacing",
  );
  assert.match(
    logChunkBody,
    /this\._onServerErrorOutput\.fire\(snippet\);/,
    "fatal stderr snippets should still be surfaced through the server error event",
  );
});

test("chat provider suppresses MaxListeners warnings before posting error toasts", () => {
  assert.match(
    chatProviderSource,
    /private shouldSuppressErrorToast\(message: string\): boolean \{[\s\S]*MaxListenersExceededWarning/i,
    "chat provider should recognize MaxListeners warnings as suppressible toasts",
  );

  const postErrorToastBody = extractFunctionBody(
    chatProviderSource,
    "  private postErrorToast(rawMessage: unknown): void {",
  );
  assert.match(
    postErrorToastBody,
    /if \(this\.shouldSuppressErrorToast\(message\)\) \{[\s\S]*Suppressing non-fatal error toast[\s\S]*return;[\s\S]*\}/s,
    "postErrorToast should short-circuit suppressed server warnings before notifying the webview",
  );
});
