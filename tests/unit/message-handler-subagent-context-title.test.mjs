import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const handlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test.skip('extractSubagentsFromMessages injects parentMessageId when missing on subagent entries', () => {
  const body = extractFunctionBody(
    handlerSource,
    'function extractSubagentsFromMessages(messages: Message[]): {',
  );

  assert.match(body, /const details = message\.subagents[\s\S]*\.map\(\(entry\) => \{[\s\S]*const rec = asRecord\(entry\);[\s\S]*if \(rec && !asString\(rec\.parentMessageId\)\) \{[\s\S]*rec\.parentMessageId = messageId;[\s\S]*\}[\s\S]*return normalizeSubagentDetail\(rec \?\? entry\);[\s\S]*\}\)/, 'extractSubagentsFromMessages should inject parentMessageId from the message ID when missing on subagent entries before normalizing');
});

test.skip('extractSubagentsFromMessages preserves existing parentMessageId when present', () => {
  const body = extractFunctionBody(
    handlerSource,
    'function extractSubagentsFromMessages(messages: Message[]): {',
  );

  assert.match(body, /if \(rec && !asString\(rec\.parentMessageId\)\)/, 'extractSubagentsFromMessages should only inject parentMessageId when it is missing');
});

test.skip('extractSubagentsFromMessages uses messageId as fallback for parentMessageId', () => {
  const body = extractFunctionBody(
    handlerSource,
    'function extractSubagentsFromMessages(messages: Message[]): {',
  );

  assert.match(body, /rec\.parentMessageId = messageId;/, 'extractSubagentsFromMessages should use the parent message ID as the fallback value');
});

test.skip('extractSubagentsFromMessages calls normalizeSubagentDetail after injection', () => {
  const body = extractFunctionBody(
    handlerSource,
    'function extractSubagentsFromMessages(messages: Message[]): {',
  );

  assert.match(body, /return normalizeSubagentDetail\(rec \?\? entry\)/, 'extractSubagentsFromMessages should call normalizeSubagentDetail with the injected record or original entry');
});

test.skip('messageResponse accumulates input tokens for context usage calculation', () => {
  const messageResponseBody = extractFunctionBody(
    handlerSource,
    'case "messageResponse": {',
  );

  assert.match(messageResponseBody, /const tokensInput = msg\.tokens\?\.input \|\| msg\.info\?\.tokens\?\.input \|\| 0;/, 'messageResponse should extract input tokens from message');
  assert.match(messageResponseBody, /type: "ACCUMULATE_SESSION_STATS",[\s\S]*payload: \{[\s\S]*input: tokensInput,/, 'messageResponse should dispatch ACCUMULATE_SESSION_STATS with input tokens');
});

test.skip('messageResponse calculates and dispatches context usage percentage', () => {
  const messageResponseBody = extractFunctionBody(
    handlerSource,
    'case "messageResponse": {',
  );

  assert.match(messageResponseBody, /if \(tokensInput > 0\) \{[\s\S]*const \{ selectedModel, availableModels \} = getState\(\);[\s\S]*const matched = selectedModel[\s\S]*\? availableModels\.find\(/, 'messageResponse should get the selected model from state when tokens are present');
  assert.match(messageResponseBody, /const contextLimit = matched\?\.contextLimit;[\s\S]*if \(contextLimit && contextLimit > 0\) \{[\s\S]*type: "SET_CONTEXT_USAGE_PCT",[\s\S]*payload: Math\.min\(100, Math\.round\(\(tokensInput \/ contextLimit\) \* 100\)\),/, 'messageResponse should calculate and dispatch context usage percentage when context limit is available');
});

test.skip('messageResponse uses fallback token sources for input calculation', () => {
  const messageResponseBody = extractFunctionBody(
    handlerSource,
    'case "messageResponse": {',
  );

  assert.match(messageResponseBody, /const tokensInput = msg\.tokens\?\.input \|\| msg\.info\?\.tokens\?\.input \|\| 0;/, 'messageResponse should check msg.tokens.input first, then msg.info.tokens.input, then default to 0');
});

test.skip('messageResponse clamps context usage percentage to maximum of 100', () => {
  const messageResponseBody = extractFunctionBody(
    handlerSource,
    'case "messageResponse": {',
  );

  assert.match(messageResponseBody, /Math\.min\(100, Math\.round\(\(tokensInput \/ contextLimit\) \* 100\)\)/, 'messageResponse should clamp the calculated percentage to a maximum of 100');
});

test.skip('sessionTitleUpdated message handler dispatches UPDATE_SESSION_TITLE action', () => {
  assert.match(
    handlerSource,
    /case "sessionTitleUpdated": \{[\s\S]*const sessionId = asString\(data\.sessionId\);[\s\S]*const title = asString\(data\.title\);[\s\S]*if \(sessionId && title\) \{[\s\S]*dispatch\(\{ type: "UPDATE_SESSION_TITLE", payload: \{ sessionId, title \} \}\);[\s\S]*\}[\s\S]*break;/,
    'sessionTitleUpdated message should extract sessionId and title, then dispatch UPDATE_SESSION_TITLE action'
  );
});

test.skip('sessionTitleUpdated message handler validates both sessionId and title', () => {
  assert.match(
    handlerSource,
    /const sessionId = asString\(data\.sessionId\);[\s\S]*const title = asString\(data\.title\);[\s\S]*if \(sessionId && title\) \{/,
    'sessionTitleUpdated message should validate that both sessionId and title are present before dispatching'
  );
});

test.skip('messageHandler continues to dispatch ACCUMULATE_SESSION_STATS for all token types', () => {
  const messageResponseBody = extractFunctionBody(
    handlerSource,
    'case "messageResponse": {',
  );

  assert.match(messageResponseBody, /type: "ACCUMULATE_SESSION_STATS",[\s\S]*payload: \{[\s\S]*input: tokensInput,[\s\S]*output: msg\.tokens\?\.output \|\| msg\.info\?\.tokens\?\.output \|\| 0,[\s\S]*read: msg\.tokens\?\.cache\?\.read \|\| msg\.info\?\.tokens\?\.cache\?\.read \|\| 0,[\s\S]*write:/, 'messageResponse should continue to dispatch ACCUMULATE_SESSION_STATS with input, output, read, and write tokens');
});

test.skip('context usage calculation only happens when tokensInput is greater than zero', () => {
  const messageResponseBody = extractFunctionBody(
    handlerSource,
    'case "messageResponse": {',
  );

  assert.match(messageResponseBody, /if \(tokensInput > 0\) \{[\s\S]*type: "SET_CONTEXT_USAGE_PCT"[\s\S]*\}/, 'messageResponse should only calculate context usage when tokensInput > 0');
});

test.skip('context usage calculation finds matching model from availableModels', () => {
  const messageResponseBody = extractFunctionBody(
    handlerSource,
    'case "messageResponse": {',
  );

  assert.match(messageResponseBody, /const matched = selectedModel[\s\S]*\? availableModels\.find\([\s\S]*m\.providerID === selectedModel\.providerID &&[\s\S]*m\.modelID === selectedModel\.modelID,[\s\S]*\)/, 'context usage calculation should find the matching model by providerID and modelID');
});

test.skip('context usage calculation handles missing contextLimit gracefully', () => {
  const messageResponseBody = extractFunctionBody(
    handlerSource,
    'case "messageResponse": {',
  );

  assert.match(messageResponseBody, /const contextLimit = matched\?\.contextLimit;[\s\S]*if \(contextLimit && contextLimit > 0\) \{[\s\S]*\}/, 'context usage calculation should only dispatch SET_CONTEXT_USAGE_PCT when contextLimit exists and is greater than 0');
});
