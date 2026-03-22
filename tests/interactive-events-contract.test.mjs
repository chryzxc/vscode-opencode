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
  assert.match(schemaText, /question:\s*{/, 'schema should declare top-level question payload');
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
  assert.match(providerSource, /case "batchInteractiveResponse"/, 'provider should handle batchInteractiveResponse webview messages');
  assert.match(providerSource, /dispatchInteractiveResponse\(/, 'interactive responses should route through dedicated dispatch helper');
  assert.match(providerSource, /\[interactive:\$\{eventType\}:\$\{eventId\}\]/, 'batch interactive responses should preserve event context in the composed prompt');
});

test('provider suppresses timeout errors while awaiting interactive answers', () => {
  assert.match(
    providerSource,
    /hasBlockingInteractiveInStreamPayload\(/,
    'provider should detect blocking interactive payloads from stream events',
  );
  assert.match(
    providerSource,
    /awaitingInteractiveAnswer\s*=\s*true/,
    'provider should mark interactive wait state when a blocking question is streamed',
  );
  assert.match(
    providerSource,
    /awaitingInteractiveAnswer[\s\S]*isLikelyInteractiveAwaitTimeoutError\(errorMessage\)[\s\S]*Suppressing timeout error while awaiting interactive response/s,
    'provider should suppress timeout errors caused by interactive-wait turns',
  );
});

test('frontend normalizes and stores interactive events', () => {
  assert.match(handlerSource, /toInteractiveEvents\(/, 'message handler should map structured output to interactive events');
  assert.match(handlerSource, /SET_INTERACTIVE_EVENTS/, 'message handler should update interactive event state');
  assert.match(handlerSource, /typeRaw\s*===\s*'question'/, 'question payloads should be gated by typed responseType');
  assert.match(handlerSource, /typeRaw\s*===\s*'message'/, 'message handler should normalize message interactive event type');
  assert.match(handlerSource, /options\.length < 2/, 'question interactive events should require at least two options');
  assert.doesNotMatch(handlerSource, /return\s+detectInteractiveEventsFromText\(/, 'plain assistant text should not auto-generate interactive popups');
  assert.doesNotMatch(handlerSource, /const\s+interactiveEvents\s*=\s*detectInteractiveEventsFromText\(/, 'streaming completion should not infer popup questions from text heuristics');
});

test('interactive wait timeout is suppressed instead of rendering a hard error banner', () => {
  assert.match(
    handlerSource,
    /function isLikelyInteractiveAwaitTimeout\(/,
    'message handler should classify timeout errors that occur while waiting for interactive responses',
  );
  assert.match(
    handlerSource,
    /pendingBlockingInteractive[\s\S]*isLikelyInteractiveAwaitTimeout\(errorMsg\)/s,
    'error handler should gate timeout suppression on active blocking interactive events',
  );
  assert.match(
    handlerSource,
    /suppressAsAwaitingInteractive[\s\S]*SET_PROCESSING[\s\S]*FINISH_STREAMING[\s\S]*break;/s,
    'interactive-timeout suppression path should end loading state without showing request failure',
  );
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
  assert.doesNotMatch(
    providerSource,
    /Coerced question response into fallback question event/,
    'provider should not coerce malformed question responses into synthetic fallback events',
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
