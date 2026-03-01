import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('AssistantMessage renders MarkdownRenderer correctly for AI response markdown rendering', () => {
  // Ensure that AssistantMessage uses MarkdownRenderer with 'content={block.html}'
  // and does not incorrectly use 'isPreParsed={true}', which causes markdown regressions.
  
  const assistantMsgBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  
  assert.match(
    assistantMsgBody, 
    /<MarkdownRenderer\s+content=\{block\.html\}\s*\/>/, 
    'AssistantMessage should correctly use MarkdownRenderer with raw block content without forcing isPreParsed.'
  );
});
