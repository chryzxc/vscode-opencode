import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
  joinFromRoot('src', 'providers', 'chat', '*.ts'),
], 'ChatViewProvider.ts');

test('question popover: structured output no longer special-cases questions', () => {
  // Verify that sanitizeStructuredOutput no longer carries question-specific schema logic
  const validatorSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
    'structuredOutputValidator.ts',
  );

  assert.doesNotMatch(
    validatorSource,
    /sanitized\.question|questionObj|rawQuestionOptions|fallbackQuestion/,
    'sanitizeStructuredOutput should not special-case question structured-output fields anymore',
  );

  assert.match(
    validatorSource,
    /VALID_INTERACTIVE_TYPES = new Set\(\[\s*"confirm",\s*"quick_actions",\s*"message",\s*\]\)/s,
    'sanitizeStructuredOutput should continue supporting non-question interactive event types',
  );
});

test('question popover: webview does not synthesize interactive events from structured question objects', () => {
  // Verify that toInteractiveEvents only uses explicit interactiveEvents data now
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  assert.doesNotMatch(
    messageHandlerSource,
    /responseType === 'question' && questionObj|questionObj\?\.displayPrompt|questionObj\?\.assistantPrompt/,
    'toInteractiveEvents should no longer synthesize interactive events from structured question objects',
  );

  assert.match(
    messageHandlerSource,
    /const contextMessage: string \| undefined =[\s\S]*asOptionalString\(structuredRec\?\.displayPrompt\)[\s\S]*asOptionalString\(structuredRec\?\.assistantPrompt\)/,
    'toInteractiveEvents should only use top-level structured display prompt fields when present',
  );
});

test('question popover: webview renders question correctly', () => {
  // Verify that PanelComponents renders event.question as main content
  const panelSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
    'PanelComponents.tsx',
  );

  // Check that event.question is used as bodyText for question type
  assert.match(
    panelSource,
    /event\?\.type === "message"[\s\S]*\?\s*event\.message/,
    'PanelComponents should use event.message for message type events',
  );

  assert.match(
    panelSource,
    /\?\s*event\.question/,
    'PanelComponents should use event.question for question type events',
  );

  // Check that contextMessage is shown in separate box
  assert.match(
    panelSource,
    /const eventContextMessage = event\?\.contextMessage\?\.trim\(\)/,
    'PanelComponents should extract contextMessage',
  );

  assert.match(
    panelSource,
    /<MarkdownRenderer content=\{eventContextMessage\} \/>/,
    'PanelComponents should render contextMessage in separate box',
  );

  assert.match(
    panelSource,
    /<MarkdownRenderer content=\{eventBodyText\} \/>/,
    'PanelComponents should render bodyText (question) as main content',
  );
});

test('question popover: options are rendered as buttons', () => {
  // Verify that question options are rendered as clickable buttons
  const panelSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
    'PanelComponents.tsx',
  );

  // Check that options are mapped to buttons
  assert.match(
    panelSource,
    /event\.options\.map\(/,
    'PanelComponents should map options to buttons',
  );

  assert.match(
    panelSource,
    /onClick=\{\(\) =>/,
    'PanelComponents should add onClick handlers to option buttons',
  );

  assert.match(
    panelSource,
    /submitInteractiveResponse\(/,
    'PanelComponents should call submitInteractiveResponse on option click',
  );
});

test('question popover: ChatViewProvider forwards stream events with structured output', () => {
  // Verify that enrichStreamEvent extracts structured output from events
  const enrichBody = extractFunctionBody(
    chatProviderSource,
    'private enrichStreamEvent(event: any): any {',
  );

  // The stream enricher should extract structured output directly from event payloads.
  assert.match(
    enrichBody,
    /const structuredOutput = this\.extractStructuredOutput\(/,
    'enrichStreamEvent should extract structured output from stream event payloads',
  );

  // Check that extracted structured output is attached and returned
  assert.match(
    enrichBody,
    /enriched\.structuredOutput = structuredOutput;/,
    'enrichStreamEvent should attach structuredOutput to the enriched event',
  );
  assert.match(
    enrichBody,
    /return enriched;/,
    'enrichStreamEvent should return the enriched event object',
  );
});

test('structured message rendering uses the canonical text/message fields only', () => {
  const messageComponentsSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
    'MessageComponents.tsx',
  );
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  assert.match(
    messageComponentsSource,
    /asString\(structured\?\.text \?\? structured\?\.message\) \?\? ""/,
    'MessageComponents should use the canonical structured text/message fallback',
  );
  assert.match(
    messageComponentsSource,
    /asString\(structured\?\.text \?\? structured\?\.message\) \?\? ""/,
    'MessageComponents should derive structured response text from the canonical text/message pair',
  );
  assert.match(
    messageHandlerSource,
    /const structuredMessage =[\s\S]*structuredOutput\.text \|\|[\s\S]*structuredOutput\.message;/,
    'messageHandler should source stream metadata text from the canonical structured text/message pair',
  );
  assert.match(
    messageHandlerSource,
    /structuredOutput\.text \|\|[\s\S]*structuredOutput\.message/,
    'messageHandler should use the canonical structured text/message pair for final stream text',
  );
});

// ============================================================================
// Regression: Interrupted badge hidden for question messages
// ============================================================================
test('interrupted badge is hidden when message has question-like content', () => {
  const source = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
    'MessageComponents.tsx',
  );

  assert.match(
    source,
    /isAborted && !hasQuestionLikeInteractiveContent\(cardMessage\) &&/,
    'Interrupted badge must check hasQuestionLikeInteractiveContent before showing',
  );
});

// ============================================================================
// Regression: Abort-triggered SSE events blocked for recently-aborted sessions
// ============================================================================
test('recently-aborted session events are skipped in SSE handler', () => {
  const source = readAllSources([
    joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
  ], 'ChatViewProvider.ts');

  assert.match(
    source,
    /recentlyAbortedSessionIds\.has\(/,
    'SSE handler must check recentlyAbortedSessionIds before forwarding events',
  );
  assert.match(
    source,
    /recentlyAbortedSessionIds\.add\(/,
    'schedulePromptDispatch must add session to recentlyAbortedSessionIds after abort',
  );
  assert.match(
    source,
    /recentlyAbortedSessionIds\.delete\(/,
    'handleSendMessage must clear recentlyAbortedSessionIds before prompt',
  );
});

// ============================================================================
// Regression: Question tool steps stay visible in activity timeline
// ============================================================================
test('question tool steps stay visible in activity timeline', () => {
  const source = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
    'MessageComponents.tsx',
  );

  assert.doesNotMatch(
    source,
    /activityTool === "question"/,
    'Activity timeline should not filter question tool steps',
  );
  assert.doesNotMatch(
    source,
    /activityTool === "request_user_input"/,
    'Activity timeline should not filter request_user_input tool steps',
  );
});
