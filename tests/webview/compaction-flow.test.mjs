import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const chatShell = readSource([
  joinFromRoot('webview/shared/src/chat/ChatShell.tsx'),
], 'ChatShell');

const messageHandler = readSource([
  joinFromRoot('webview/shared/src/chat/lib/messageHandler.ts'),
], 'messageHandler');

const compactionManager = readSource([
  joinFromRoot('src/providers/chat/CompactionManager.ts'),
], 'CompactionManager');

test('tracks compaction divider state in the shell', () => {
  assert.match(chatShell, /const compactionDividerIndex =/, 'compaction divider index state is missing');
  assert.match(chatShell, /state\.compactedMessagesCollapsed/, 'collapsed compaction state is missing');
});

test('renders the divider at the computed index', () => {
  assert.match(chatShell, /!isCompressed && compactionDividerIndex === idx/, 'inline divider render is missing');
  assert.match(chatShell, /!isCompressed && compactionDividerIndex === state\.messages\.length/, 'terminal divider render is missing');
});

test('clicking the divider toggles collapsed history', () => {
  assert.match(chatShell, /const nextCollapsed = !state\.compactedMessagesCollapsed;/, 'collapse toggle is missing');
  assert.match(chatShell, /type: "SET_COMPACTED_MESSAGES_COLLAPSED"/, 'collapse dispatch is missing');
  assert.match(chatShell, /setCompactionViewState/, 'compaction persistence message is missing');
});

test('preserves recent messages by slicing from the divider onward', () => {
  assert.match(chatShell, /const visibleMessages = state\.messages\.slice\(visibleStartIndex\);/, 'visible message slice is missing');
  assert.match(chatShell, /const visibleStartIndex = isCompressed \? compactionDividerIndex : 0;/, 'visible start index guard is missing');
});

test('shows compacting indicators in the shell while processing', () => {
  assert.match(chatShell, /state\.isCompacting/, 'compacting state indicator is missing');
  assert.match(chatShell, /Compacting conversation\.\.\./, 'compacting status banner is missing');
});

test('forwards compaction status from stream events', () => {
  assert.match(compactionManager, /forwardCompactionStatusFromStreamEvent\(event: unknown\): void/, 'forwarding helper is missing');
  assert.match(compactionManager, /type: "compactionStatus"/, 'compaction status postMessage is missing');
});

test('handles compacted stream events and status fields', () => {
  assert.match(compactionManager, /const compacted = rec\.compacted === true;/, 'compacted field handling is missing');
  assert.match(compactionManager, /const normalizedStatus = status === "completed" \? "done" : status;/, 'status normalization is missing');
});

test('keeps message ordering by using direct divider indexes', () => {
  assert.match(compactionManager, /const beforeMessage = messages\[dividerIndex\];/, 'before-message index lookup is missing');
  assert.match(compactionManager, /const afterMessage = messages\[dividerIndex \+ 1\];/, 'after-message index lookup is missing');
});

test('uses a threshold to trigger auto compaction', () => {
  assert.match(compactionManager, /const threshold = Math\.floor\(contextLimit \* 0\.8\);/, 'auto-compaction threshold is missing');
  assert.match(compactionManager, /if \(totalTokens < threshold\) \{/, 'auto-compaction guard is missing');
});

test('retains recent history after compaction and persists metadata', () => {
  assert.match(compactionManager, /lastCompactedAt: Date\.now\(\)/, 'last compacted timestamp is missing');
  assert.match(compactionManager, /compactionDividerBeforeMessageId:/, 'divider-before metadata is missing');
  assert.match(compactionManager, /compactionDividerAfterMessageId:/, 'divider-after metadata is missing');
  const body = extractFunctionBody(compactionManager, 'async handleCompactSession(');
  assert.match(body, /persistAndPublishCompactionViewState/, 'compaction persistence path is missing');
});
