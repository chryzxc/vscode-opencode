import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
  joinFromRoot('src', 'providers', 'chat', '*.ts'),
], 'ChatViewProvider.ts');

test('question popover: structured output is properly sanitized', () => {
  // Verify that sanitizeStructuredOutput handles malformed question structure
  const validatorSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
    'structuredOutputValidator.ts',
  );

  // Check that sanitizeStructuredOutput converts string question to object
  assert.match(
    validatorSource,
    /if \(typeof sanitized\.question === "string"/,
    'sanitizeStructuredOutput should detect string question',
  );

  assert.match(
    validatorSource,
    /const questionObj: Record<string, unknown> = \{/,
    'sanitizeStructuredOutput should create question object',
  );

  assert.match(
    validatorSource,
    /question: questionText,/,
    'sanitizeStructuredOutput should set question field',
  );

  // Check that JSON-stringified options are parsed
  assert.match(
    validatorSource,
    /const rawQuestionOptions =/,
    'sanitizeStructuredOutput should collect top-level option-like fields',
  );

  assert.match(
    validatorSource,
    /questionObj\.options = JSON\.parse/,
    'sanitizeStructuredOutput should parse JSON options',
  );

  assert.doesNotMatch(
    validatorSource,
    /fallbackQuestion/,
    'sanitizeStructuredOutput should not fabricate question text from non-question message content',
  );
});

test('question popover: webview extracts interactive events from question object', () => {
  // Verify that toInteractiveEvents fallback creates events from question object
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  // Check for fallback logic when interactiveEvents array is empty
  assert.match(
    messageHandlerSource,
    /if \(mapped\.length === 0 && questionObj\) \{/,
    'toInteractiveEvents should have fallback for question object',
  );

  // Check that question text is extracted correctly
  assert.match(
    messageHandlerSource,
    /const questionText =[\s\S]*asOptionalString\(questionObj\.question\)[\s\S]*asOptionalString\(questionObj\.text\)/,
    'toInteractiveEvents should extract question text from question.question or question.text',
  );

  // Check that event is created with correct question field
  assert.match(
    messageHandlerSource,
    /question: questionText,/,
    'toInteractiveEvents should set event.question from extracted text',
  );

  // Check that contextMessage is derived only from question display prompt fields
  assert.match(
    messageHandlerSource,
    /asOptionalString\(questionObj\?\.displayPrompt\)[\s\S]*asOptionalString\(questionObj\?\.assistantPrompt\)/,
    'toInteractiveEvents should use question displayPrompt/assistantPrompt as contextMessage',
  );

  assert.match(
    messageHandlerSource,
    /else if \(options\.length >= 2 \|\| questionObj\.allowCustomInput === true\) \{/,
    'toInteractiveEvents should synthesize question events for choices or explicit free-form input',
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

test('structured message rendering uses message field only', () => {
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
    /return part\.message \?\? part\.text \?\? part\.content \?\? "";/,
    'MessageComponents should use part.message as the only structured message field',
  );
  assert.match(
    messageComponentsSource,
    /const isMessageResponseType = responseType === "message";[\s\S]*const structuredMessage = firstNonEmptyString\(structured\?\.message\);[\s\S]*return structuredMessage;/,
    'MessageComponents should use structured.message as the canonical text for responseType=message',
  );
  assert.match(
    messageHandlerSource,
    /const structuredText =[\s\S]*asString\(structuredRecord\?\.message\)\s*\|\|[\s\S]*asString\(structuredRecord\?\.text\)/,
    'messageHandler should source stream metadata text from structured.message',
  );
  assert.match(
    messageHandlerSource,
    /const structuredMessage =[\s\S]*structuredQuestionText \|\|[\s\S]*structuredOutput\.message;/,
    'messageHandler should use structuredOutput.message for final stream text',
  );
});
