import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageJump.ts')],
  'messageJump.ts',
);

test('messageJump exports jumpToMessage function', () => {
  assert.match(
    source,
    /export\s+function\s+jumpToMessage\s*\(\s*messageId\s*:\s*string\s*\)\s*:\s*void/,
    'messageJump should export jumpToMessage(messageId): void',
  );
});

test('messageJump constructs element ID from messageId', () => {
  assert.match(
    source,
    /msg-\$\{messageId\}/,
    'jumpToMessage should construct element ID msg-${messageId}',
  );
});

test('messageJump queries by data-message-id attribute', () => {
  assert.match(
    source,
    /data-message-id.*\$\{messageId\}/,
    'jumpToMessage should query [data-message-id="${messageId}"]',
  );
});

test('messageJump adds focus CSS class to target element', () => {
  assert.match(
    source,
    /oc-message-focus/,
    'jumpToMessage should add oc-message-focus CSS class',
  );
});

test('messageJump uses scrollIntoView with smooth behavior', () => {
  assert.match(
    source,
    /scrollIntoView\s*\(\s*\{[\s\S]*?behavior\s*:\s*['"]smooth['"]/,
    'jumpToMessage should use scrollIntoView with smooth behavior',
  );
  assert.match(
    source,
    /block\s*:\s*['"]center['"]/,
    'jumpToMessage should use block: center alignment',
  );
});

test('messageJump implements timeout-based cleanup of focus class', () => {
  assert.match(
    source,
    /setTimeout\s*\(\s*\(\s*\)\s*=>/,
    'jumpToMessage should use setTimeout for cleanup',
  );
  assert.match(
    source,
    /\d{4}/,
    'jumpToMessage should have a numeric timeout value',
  );
});

test('messageJump removes focus class after timeout', () => {
  assert.match(
    source,
    /classList\.remove\s*\(\s*['"]oc-message-focus['"]\s*\)/,
    'jumpToMessage should remove oc-message-focus class after timeout',
  );
});

test('messageJump guards against missing element', () => {
  assert.match(
    source,
    /if\s*\(\s*!target\s*\)\s*\{[\s\S]*?return/,
    'jumpToMessage should guard against null target element',
  );
});
