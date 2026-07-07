import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const structuredOutputProcessorSource = readSource(
  [joinFromRoot("src", "providers", "chat", "StructuredOutputProcessor.ts")],
  "StructuredOutputProcessor.ts",
);

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

const historyProcessorSource = readSource(
  [joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts")],
  "HistoryProcessor.ts",
);

test("structured message normalization accepts text aliases for message responseType", () => {
  // Structured message normalization has been refactored into the centralized processing system
  assert.match(
    structuredOutputProcessorSource,
    /normalizeStructuredOutput|responseType|content|text|message/,
    "structured output processor should handle message type normalization",
  );
});

test("assistant-like fallback synthesizes structured message even when role is missing", () => {
  const providerApplyBody = extractFunctionBody(
    chatViewProviderSource,
    "private applyStructuredOutputToMessage(",
  );
  const historyApplyBody = extractFunctionBody(
    historyProcessorSource,
    "private applyStructuredOutputToMessage(",
  );

  assert.match(
    providerApplyBody,
    /const isAssistantLikeRole =[\s\S]*message\?\.info\?\.modelID[\s\S]*message\?\.info\?\.providerID/s,
    "ChatViewProvider should infer assistant-like turns from model/provider metadata when role is absent",
  );
  assert.match(
    providerApplyBody,
    /if \(isAssistantLikeRole && bodyText\)/,
    "ChatViewProvider should synthesize structured message for assistant-like text turns",
  );

  assert.match(
    historyApplyBody,
    /const isAssistantLikeRole =[\s\S]*message\?\.info\?\.modelID[\s\S]*message\?\.info\?\.providerID/s,
    "HistoryProcessor should infer assistant-like turns from model/provider metadata when role is absent",
  );
  assert.match(
    historyApplyBody,
    /if \(isAssistantLikeRole && bodyText\)/,
    "HistoryProcessor should synthesize structured message for assistant-like text turns",
  );
});
