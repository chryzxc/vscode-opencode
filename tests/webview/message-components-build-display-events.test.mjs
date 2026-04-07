import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('buildDisplayEvents adds isImportant flag for error events', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
  assert.ok(body, 'buildDisplayEvents should exist');

  assert.match(
    body,
    /status\s*===\s*['"]error['"]/,
    'Should check for error status when determining importance'
  );
});

test('buildDisplayEvents adds isImportant flag for events with filePath', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');

  assert.ok(
    body.includes('filePath') && body.includes('isImportant'),
    'Should check for filePath when determining importance'
  );
});

test('buildDisplayEvents adds isImportant flag for events with diffStats', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');

  assert.ok(
    body.includes('diffStats') && body.includes('isImportant'),
    'Should check for diffStats when determining importance'
  );
});

test('buildDisplayEvents adds isImportant flag for events with viewDiffFile', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');

  assert.ok(
    body.includes('viewDiffFile') && body.includes('isImportant'),
    'Should check for viewDiffFile when determining importance'
  );
});
