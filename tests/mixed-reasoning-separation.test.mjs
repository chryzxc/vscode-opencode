import test from "node:test";
import assert from "node:assert/strict";
import * as ts from "typescript";

import { joinFromRoot, readSource } from "./helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

function loadReasoningHarness(source) {
  const moduleSource = `${source}
export { splitMixedReasoningFromContent, shouldPreferStreamingContent };`;
  const transpiled = ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const module = { exports: {} };
  const requireMock = (specifier) => {
    if (specifier === "./structuredOutputValidator") {
      return {
        sanitizeStructuredOutput: (value) => value,
        validateStructuredOutput: () => ({ valid: true, errors: [] }),
      };
    }
    if (specifier === "./vscode") {
      return { __esModule: true, default: { postMessage: () => undefined } };
    }
    return {};
  };

  const execute = new Function(
    "module",
    "exports",
    "require",
    "window",
    transpiled,
  );
  execute(module, module.exports, requireMock, undefined);
  return module.exports;
}

const { splitMixedReasoningFromContent, shouldPreferStreamingContent } =
  loadReasoningHarness(messageHandlerSource);

test("splitMixedReasoningFromContent detaches leaked reasoning from normal response text", () => {
  const mixed =
    "I'm here. What do you need? The user keeps saying \"hey\" without a concrete task. I should respond briefly and directly.";
  const result = splitMixedReasoningFromContent(mixed);

  assert.ok(result, "expected mixed content to be split");
  assert.equal(result.content, "I'm here. What do you need?");
  assert.match(result.reasoning, /The user keeps saying/i);
  assert.match(result.reasoning, /\bI should respond\b/i);
});

test("splitMixedReasoningFromContent detects compacted no-space reasoning leaks", () => {
  const compactLeak =
    "Hey! How can I help you today?Theuserjustsaid\"hey\"-thisisasimplegreeting.Ishouldrespondconciselyanddirectly.";
  const result = splitMixedReasoningFromContent(compactLeak);

  assert.ok(result, "expected compact mixed content to be split");
  assert.equal(result.content, "Hey! How can I help you today?");
  assert.match(result.reasoning, /Theuserjustsaid|The user just said/i);
});

test("splitMixedReasoningFromContent does not split clean assistant content", () => {
  const clean =
    "Hey! How can I help you today? I can review your code, explain errors, or propose a plan.";
  const result = splitMixedReasoningFromContent(clean);
  assert.equal(result, null);
});

test("shouldPreferStreamingContent rejects contaminated mixed stream snapshots", () => {
  const finalContent = "I'm here. What do you need?";
  const streamingMixed =
    "I'm here. What do you need? The user keeps saying hey without providing a concrete request, so I should keep this concise.";

  assert.equal(
    shouldPreferStreamingContent(finalContent, streamingMixed),
    false,
    "mixed response+reasoning stream content must never override clean final content",
  );
});

test("shouldPreferStreamingContent still prefers richer clean stream snapshots", () => {
  const finalContent = "Implemented authentication and tests.";
  const streamingRich =
    "Implemented authentication and tests.\n- Added JWT validation middleware.\n- Added integration tests for login and refresh paths.\n- Updated setup documentation for environment variables.";

  assert.equal(
    shouldPreferStreamingContent(finalContent, streamingRich),
    true,
    "clean richer stream content should still be preferred when overlap is high",
  );
});
