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
  const schemaBody = extractFunctionBody(
    providerSource,
    'private getStructuredOutputFormat(): Record<string, unknown>',
  );

  assert.match(schemaBody, /interactiveEvents/, 'schema should declare interactiveEvents');
  assert.match(schemaBody, /"question"/, 'schema should allow question response type');
  assert.match(schemaBody, /"quick_actions"/, 'schema should allow quick_actions interactive event type');
  assert.match(schemaBody, /"confirm"/, 'schema should allow confirm interactive event type');
});

test('provider accepts interactive responses from webview', () => {
  assert.match(providerSource, /case "interactiveResponse"/, 'provider should handle interactiveResponse webview messages');
  assert.match(providerSource, /interactive:/, 'interactive responses should include event context prefix');
});

test('frontend normalizes and stores interactive events', () => {
  assert.match(handlerSource, /toInteractiveEvents\(/, 'message handler should map structured output to interactive events');
  assert.match(handlerSource, /SET_INTERACTIVE_EVENTS/, 'message handler should update interactive event state');
  assert.match(handlerSource, /detectInteractiveEventsFromText\(/, 'message handler should detect interactive events from plain assistant text');
  assert.match(handlerSource, /collectOptionsInDirection\(/, 'question detection should scan option lists around the question');
  assert.match(handlerSource, /extractInlineOrChoices\(/, 'question detection should parse inline A-or-B options');
  assert.match(handlerSource, /isLikelyYesNoQuestion\(/, 'question detection should classify yes-no prompts');
  assert.match(handlerSource, /stripMarkdownFormatting\(/, 'question detection should sanitize markdown noise in choices');
  assert.match(handlerSource, /auto-question-/, 'auto-detected questions should be assigned deterministic ids');
});

test('input wrapper renders top popup choices and posts interactiveResponse', () => {
  const inputBody = extractFunctionBody(
    panelSource,
    'export function InputWrapper()',
  );

  assert.match(inputBody, /activeInteractiveEvent/, 'input wrapper should compute active interactive event');
  assert.match(inputBody, /Quick Input/, 'input wrapper should render a top prompt popup');
  assert.match(inputBody, /type: "interactiveResponse"/, 'popup choice clicks should post interactiveResponse');
});

test('interactive event domain types are defined', () => {
  assert.match(typesSource, /export interface InteractiveQuestionEvent/, 'types should define InteractiveQuestionEvent');
  assert.match(typesSource, /export interface InteractiveConfirmEvent/, 'types should define InteractiveConfirmEvent');
  assert.match(typesSource, /export interface InteractiveQuickActionsEvent/, 'types should define InteractiveQuickActionsEvent');
});
