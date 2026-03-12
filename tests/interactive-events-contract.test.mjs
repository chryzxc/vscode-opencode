import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);
const handlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const typesSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
  'types.ts',
);

test('structured output schema supports interactive event types', () => {
  const schemaSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
    'structuredOutputSchema.ts',
  );
  const schemaText = schemaSource;
  assert.match(schemaText, /interactiveEvents/, 'schema should declare interactiveEvents');
  assert.match(schemaText, /"question"/, 'schema should allow question response type');
  assert.match(schemaText, /"quick_actions"/, 'schema should allow quick_actions interactive event type');
  assert.match(schemaText, /"confirm"/, 'schema should allow confirm interactive event type');
  assert.match(schemaText, /"message"/, 'schema should allow message interactive event type');
  assert.match(schemaText, /options/, 'schema should declare question options payload');
});

test('structured output schema is defined in shared module', () => {
  assert.match(
    providerSource,
    /structuredOutputSchema/,
    'provider should reference shared structuredOutputSchema'
  );
});

test('provider accepts interactive responses from webview', () => {
  assert.match(providerSource, /case "interactiveResponse"/, 'provider should handle interactiveResponse webview messages');
  assert.match(providerSource, /interactive:/, 'interactive responses should include event context prefix');
});

test('frontend normalizes and stores interactive events', () => {
  assert.match(handlerSource, /toInteractiveEvents\(/, 'message handler should map structured output to interactive events');
  assert.match(handlerSource, /SET_INTERACTIVE_EVENTS/, 'message handler should update interactive event state');
  assert.match(handlerSource, /typeRaw\s*===\s*'question'\s*\|\|\s*typeRaw\s*===\s*'interactive'/, 'interactive payloads should be gated by typed responseType');
  assert.match(handlerSource, /typeRaw\s*===\s*'message'/, 'message handler should normalize message interactive event type');
  assert.match(handlerSource, /options\.length < 2/, 'question interactive events should require at least two options');
  assert.doesNotMatch(handlerSource, /return\s+detectInteractiveEventsFromText\(/, 'plain assistant text should not auto-generate interactive popups');
  assert.doesNotMatch(handlerSource, /const\s+interactiveEvents\s*=\s*detectInteractiveEventsFromText\(/, 'streaming completion should not infer popup questions from text heuristics');
});

test('structured question outputs dispatch popup interactive state', () => {
  assert.match(
    handlerSource,
    /const interactiveEvents = toInteractiveEvents\(structuredOutput\);[\s\S]*dispatch\(\{ type: 'SET_INTERACTIVE_EVENTS', payload: interactiveEvents \}\);/s,
    'message completion path should dispatch interactive popup events from structured output',
  );
  assert.match(
    handlerSource,
    /type:\s*'question',[\s\S]*question,\s*options,/s,
    'question responses should preserve question text and options for popup rendering',
  );
  assert.match(
    providerSource,
    /Coerced interactive response into fallback question event/,
    'provider should coerce malformed interactive responses into picker-safe question events',
  );
});

test('input wrapper renders top popup choices and posts batchInteractiveResponse', () => {
  const inputBody = extractFunctionBody(
    panelSource,
    'export function InputWrapper()',
  );

  assert.match(inputBody, /activeInteractiveEvent/, 'input wrapper should compute active interactive event');
  assert.match(inputBody, /Quick Input/, 'input wrapper should render a top prompt popup');
  assert.match(inputBody, /event\.type === "question"/, 'popup should support question-type interactive events');
  assert.match(inputBody, /event\.type === "message"/, 'popup should support message-type interactive events');
  assert.match(inputBody, /event\.options\.map\(/, 'question popup should render clickable option buttons');
  assert.match(inputBody, /type:\s*"batchInteractiveResponse"/, 'popup choice clicks should post batchInteractiveResponse');
});

test('interactive event domain types are defined', () => {
  assert.match(typesSource, /export interface InteractiveQuestionEvent/, 'types should define InteractiveQuestionEvent');
  assert.match(typesSource, /export interface InteractiveConfirmEvent/, 'types should define InteractiveConfirmEvent');
  assert.match(typesSource, /export interface InteractiveQuickActionsEvent/, 'types should define InteractiveQuickActionsEvent');
  assert.match(typesSource, /export interface InteractiveMessageEvent/, 'types should define InteractiveMessageEvent');
});
