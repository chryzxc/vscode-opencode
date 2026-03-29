import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from '../helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("handleGetModels falls back to cached/selected model after provider list timeout", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private async handleGetModels(): Promise<ChatModelOption[]>",
  );

  assert.match(
    body,
    /providerListTimeoutMs\s*=\s*8000/,
    "handleGetModels should fail fast instead of blocking startup for long provider discovery timeouts",
  );
  assert.match(
    body,
    /Promise\.race\(\s*\[\s*client\.provider\.list\(\)\s*,\s*timeoutPromise/s,
    "handleGetModels should guard provider.list with an explicit timeout",
  );
  assert.match(
    body,
    /const\s+cachedModels\s*=\s*Array\.isArray\(this\.availableModels\)\s*\?\s*this\.availableModels\s*:\s*\[\]/,
    "handleGetModels should normalize cached models before reading length",
  );
  assert.match(
    body,
    /const\s+fallbackModels\s*=\s*[\s\S]*cachedModels\.length\s*>\s*0[\s\S]*this\.getSelectedModelFallbackList\(\)/,
    "handleGetModels should recover with cached or selected-model fallback when discovery fails",
  );
  assert.match(
    body,
    /type:\s*["']modelsList["']\s*,\s*models:\s*fallbackModels/s,
    "fallback model list should still be sent to webview so chat remains usable",
  );
});

test("selected model fallback list provides a usable model entry", () => {
  const body = extractFunctionBody(
    chatProviderSource,
    "private getSelectedModelFallbackList(): ChatModelOption[]",
  );

  assert.match(
    body,
    /providerID\s*=\s*this\.firstNonEmptyString\(selected\.providerID\)/,
    "fallback list should derive provider id from selected model",
  );
  assert.match(
    body,
    /modelID\s*=\s*this\.firstNonEmptyString\(selected\.modelID\)/,
    "fallback list should derive model id from selected model",
  );
  assert.match(
    body,
    /return\s*\[\s*\{[\s\S]*providerID[\s\S]*modelID[\s\S]*name:\s*modelID/s,
    "fallback list should produce a concrete model option for the UI",
  );
});
