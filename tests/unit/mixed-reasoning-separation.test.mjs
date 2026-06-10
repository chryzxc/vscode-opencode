import test from "node:test";
import assert from "node:assert/strict";
import * as ts from "typescript";

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

function loadReasoningHarness(source) {
  const moduleSource = `${source}
export { splitMixedReasoningFromContent, shouldPreferStreamingContent, resolveStreamingContentUpdate, hasDuplicateTokenPattern, comparableTokens };`;
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

const {
  splitMixedReasoningFromContent,
  shouldPreferStreamingContent,
  resolveStreamingContentUpdate,
  hasDuplicateTokenPattern,
  comparableTokens,
} = loadReasoningHarness(messageHandlerSource);

test("splitMixedReasoningFromContent detaches leaked reasoning from normal response text", () => {
  const mixed =
    "I'm here. What do you need?<thought>The user keeps saying \"hey\" without a concrete task. I should respond briefly and directly.</thought>";
  const result = splitMixedReasoningFromContent(mixed);

  assert.ok(result, "expected mixed content to be split");
  assert.equal(result.content, "I'm here. What do you need?");
  assert.match(result.reasoning, /The user keeps saying/i);
  assert.match(result.reasoning, /\bI should respond\b/i);
});

test("splitMixedReasoningFromContent detects compacted no-space reasoning leaks", () => {
  const compactLeak =
    "Hey! How can I help you today?<thought>Theuserjustsaid\"hey\"-thisisasimplegreeting.Ishouldrespondconciselyanddirectly.</thought>";
  const result = splitMixedReasoningFromContent(compactLeak);

  assert.ok(result, "expected compact mixed content to be split");
  assert.equal(result.content, "Hey! How can I help you today?");
  assert.match(result.reasoning, /Theuserjustsaid|The user just said/i);
});

test("splitMixedReasoningFromContent detaches instruction-check reasoning leaks", () => {
  const instructionLeak =
    "I am doing well. Looking at my instructions: Be concise. No flattery. No status updates. Match user's style. I need to use the StructuredOutput tool for my final response.";
  const result = splitMixedReasoningFromContent(instructionLeak);

  // splitMixedReasoningFromContent only handles <thought>...</thought> tags.
  // Plain text is no longer heuristically classified as reasoning.
  assert.equal(result, null, "instruction-check leak without <thought> tags not handled by this function");
});

test("shouldPreferStreamingContent preserves plain-text instruction discussion without explicit tags", () => {
  const finalContent = "I'm doing well!";
  const instructionLeak =
    "I am doing well. Looking at my instructions: Be concise. No flattery. No status updates. Match user's style.";
  assert.equal(
    shouldPreferStreamingContent(finalContent, instructionLeak),
    true,
    "plain text should not be treated as reasoning without explicit SDK reasoning markers",
  );
});

test("shouldPreferStreamingContent preserves plain-text 'looking at' preambles without explicit tags", () => {
  const finalContent = "Here's the fix.";
  const reasoningLeak =
    "Looking at the codebase, I can see the issue is in the parser. Here's the fix.";
  assert.equal(
    shouldPreferStreamingContent(finalContent, reasoningLeak),
    true,
    "plain text should not be treated as reasoning based on wording alone",
  );
});

test("shouldPreferStreamingContent preserves plain-text instruction references without explicit tags", () => {
  const finalContent = "I'll help with that.";
  const reasoningLeak =
    "The instructions say to be concise and avoid flattery. I'll help with that.";

  assert.equal(
    shouldPreferStreamingContent(finalContent, reasoningLeak),
    true,
    "plain text should not be filtered just because it references instructions",
  );
});

test("shouldPreferStreamingContent preserves plain-text user analysis without explicit tags", () => {
  const finalContent = "Hey!";
  const userAnalysisLeak =
    'The user is just saying "hey" again. This is a simple greeting. I should respond briefly and directly.';

  assert.equal(
    shouldPreferStreamingContent(finalContent, userAnalysisLeak),
    true,
    "plain text should not be classified as reasoning based on user-analysis phrasing",
  );
});

test("splitMixedReasoningFromContent does not split clean assistant content", () => {
  const clean =
    "Hey! How can I help you today? I can review your code, explain errors, or propose a plan.";
  const result = splitMixedReasoningFromContent(clean);
  assert.equal(result, null);
});

test("shouldPreferStreamingContent prefers richer stream snapshots unless explicit thought tags present", () => {
  const finalContent = "I'm here. What do you need?";
  const streamingMixed =
    "I'm here. What do you need? The user keeps saying hey without providing a concrete request, so I should keep this concise.";

  assert.equal(
    shouldPreferStreamingContent(finalContent, streamingMixed),
    true,
    "stream snapshots containing final content plus extra text are preferred when no explicit <thought> tags exist",
  );
});

test("shouldPreferStreamingContent still rejects unrelated plain-text snapshots", () => {
  const finalContent = "Hey! How can I help?";
  const reasoningLeak =
    'The user just said "hey". According to the instructions, no flattery and be concise. I should respond directly.';

  assert.equal(
    shouldPreferStreamingContent(finalContent, reasoningLeak),
    false,
    "unrelated plain-text snapshots should not override the final assistant answer",
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

test("shouldPreferStreamingContent rejects streaming content with duplicate adjacent tokens", () => {
  const finalContent = "Yes. It shows a UI card.";
  const garbledContent =
    "The user user asked,,\"\"Can you you see this?\"?\"";

  assert.equal(
    shouldPreferStreamingContent(finalContent, garbledContent),
    false,
    "must reject streaming content with word-level duplicate patterns (e.g. 'user user', 'you you')",
  );
});

test("shouldPreferStreamingContent still accepts clean rich content near duplicate threshold", () => {
  const finalContent = "Hey!";
  const cleanRich =
    "The user just said hey again. This is a simple greeting. I should respond briefly and directly.";

  assert.equal(
    shouldPreferStreamingContent(finalContent, cleanRich),
    true,
    "clean content without adjacent duplicates should still be preferred",
  );
});

test("resolveStreamingContentUpdate returns raw data for non-delta snapshot", () => {
  const result = resolveStreamingContentUpdate(
    "old content here",
    "brand new content",
    false,
  );
  assert.deepEqual(result, { content: "brand new content", append: false });
});

test("resolveStreamingContentUpdate appends raw data for delta", () => {
  const result = resolveStreamingContentUpdate(
    "existing content",
    " more text",
    true,
  );
  assert.deepEqual(result, { content: " more text", append: true });
});

test("resolveStreamingContentUpdate returns null for identical content", () => {
  const result = resolveStreamingContentUpdate(
    "same content",
    "same content",
    false,
  );
  assert.equal(result, null);
});

test("resolveStreamingContentUpdate returns null for empty incoming chunk", () => {
  const result = resolveStreamingContentUpdate(
    "some content",
    "",
    false,
  );
  assert.equal(result, null);
});

test("resolveStreamingContentUpdate returns null for stale snapshot", () => {
  const result = resolveStreamingContentUpdate(
    "newer and longer content here",
    "newer",
    false,
  );
  assert.equal(result, null);
});

test("resolveStreamingContentUpdate extracts remainder from continuation snapshot", () => {
  const result = resolveStreamingContentUpdate(
    "base text",
    "base text with extra content",
    false,
  );
  assert.deepEqual(
    result,
    { content: " with extra content", append: true },
  );
});

test("resolveStreamingContentUpdate sets raw content when current is empty", () => {
  const result = resolveStreamingContentUpdate(
    "",
    "fresh content",
    false,
  );
  assert.deepEqual(result, { content: "fresh content", append: false });
});

test("resolveStreamingContentUpdate delta does not add boundary space", () => {
  const result = resolveStreamingContentUpdate(
    "text",
    "more",
    true,
  );
  assert.deepEqual(
    result,
    { content: "more", append: true },
    "delta should append raw 'more' without prepending space",
  );
});

test("hasDuplicateTokenPattern detects adjacent duplicate tokens", () => {
  assert.equal(hasDuplicateTokenPattern(["the", "user", "user", "asked", "asked"]), true);
  assert.equal(hasDuplicateTokenPattern(["the", "user", "asked"]), false);
  assert.equal(hasDuplicateTokenPattern(["the", "the", "user", "user"]), true);
  assert.equal(hasDuplicateTokenPattern(["a", "b", "c", "d"]), false);
  assert.equal(hasDuplicateTokenPattern([]), false);
  assert.equal(hasDuplicateTokenPattern(["only"]), false);
});

test("comparableTokens extracts meaningful tokens from text", () => {
  const tokens = comparableTokens("The user said hello world!");
  assert.ok(tokens.includes("hello"));
  assert.ok(tokens.includes("world"));
  assert.ok(tokens.includes("user"));
});
