import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);
const chatContentBody = extractFunctionBody(chatShellSource, 'function ChatContent()');

test('isConnecting derives from init state and server status', () => {
  assert.match(
    chatContentBody,
    /const isConnecting = false/,
    'ChatShell should compute connecting state from init state and server status',
  );
});

test('connecting state renders a loading indicator', () => {
  assert.match(
    chatContentBody,
    /Connecting…/,
    'ChatShell should display a connecting indicator while waiting for startup',
  );
  assert.match(
    chatContentBody,
    /<SessionLoadingSpinner \/>|Connecting…/,
    'ChatShell should expose a visible loading UI for connection state',
  );
});

test('session switching shows the session loading spinner', () => {
  assert.match(
    chatContentBody,
    /isSwitchingSession \? \([\s\S]*<SessionLoadingSpinner \/>/,
    'session switches should render the loading spinner',
  );
});

test('empty state appears when there are no messages and no streaming activity', () => {
  assert.match(
    chatContentBody,
    /state\.messages\.length === 0[\s\S]*!state\.streaming[\s\S]*!isAiResponding[\s\S]*<EmptyState \/>/,
    'empty chat should show the empty state card',
  );
});

test('message routing sends user and system roles to dedicated components', () => {
  assert.match(chatContentBody, /if \(role === "user"\) \{[\s\S]*<UserMessage message=\{msg\} \/>/, 'user messages should render UserMessage');
  assert.match(chatContentBody, /else if \(role === "system"\) \{[\s\S]*<SystemMessage[\s\S]*accentColor=\{resolveAgentColor\(systemAgentId\)\}/, 'system messages should render SystemMessage with agent color');
});

test('permission responses render PermissionCard and assistants use AssistantMessage', () => {
  assert.match(chatContentBody, /else if \(\(msg as Record<string, unknown>\)\.type === "permission"\) \{[\s\S]*<PermissionCard perm=\{msg\} \/>/s, 'permission messages should render PermissionCard');
  assert.match(chatContentBody, /const pendingAssistantTurnMessageId =[\s\S]*state\.assistantTurnMessageId\s*\?\?\s*null/s, 'ChatShell should track the pending assistant turn message id');
  assert.match(chatContentBody, /const isLiveStreamingAssistantTurn =[\s\S]*state\.assistantTurnPending[\s\S]*pendingAssistantTurnMessageId === messageId/s, 'ChatShell should identify the live assistant turn by either active stream or pending turn state');
  assert.match(chatContentBody, /if \(isLiveStreamingAssistantTurn\) \{[\s\S]*messageNode = null;[\s\S]*\} else \{[\s\S]*<AssistantMessage message=\{msg\} isContiguous=\{isContiguous\} \/>/s, 'ChatShell should skip the in-flight assistant turn in the message list and let the live streaming card own it');
});

test('thinking bubble appears while AI is responding before assistant text arrives', () => {
  assert.match(
    chatContentBody,
    /const hasAssistantText =[\s\S]*state\.streaming\?\.content[\s\S]*state\.streaming\.content\.trim\(\)\.length > 0/s,
    'ChatShell should identify whether streamed assistant text has arrived',
  );
  assert.match(
    chatContentBody,
    /const showAiResponseLoading =[\s\S]*isAiResponding[\s\S]*!state\.isCompacting[\s\S]*!hasAssistantText/s,
    'thinking bubble should remain visible for activity-only streams until assistant text arrives',
  );
  assert.match(
    chatContentBody,
    /<ThinkingBubble \/>/,
    'thinking bubble should be rendered when loading is active',
  );
});

test('streaming card is rendered at the bottom of the message list', () => {
  assert.match(
    chatContentBody,
    /<StreamingCard[\s\S]*isContiguous=\{[\s\S]*\}/s,
    'streaming card should still be rendered at the bottom of the message list',
  );
});

test('jump to latest appears when the viewport is behind', () => {
  assert.match(
    chatContentBody,
    /!streamViewport\.isFollowing &&[\s\S]*streamViewport\.unseenUpdateCount > 0[\s\S]*Jump to latest \(\{streamViewport\.unseenUpdateCount\}\)/,
    'jump-to-latest control should appear only when updates are unseen',
  );
});

test('assistant message grouping checks contiguous agent runs', () => {
  assert.match(
    chatContentBody,
    /const isContiguous =[\s\S]*role === "assistant"[\s\S]*prevMsg\?\.role === "assistant"[\s\S]*prevMsg\.info\?\.agent === msg\.info\?\.agent/s,
    'assistant messages should group contiguous runs with the same agent',
  );
});

test('compaction divider renders around compacted history boundaries', () => {
  assert.match(
    chatContentBody,
    /const compactionDividerIndex =[\s\S]*typeof state\.compactionDividerIndex === "number"/,
    'compaction divider index should be computed from state',
  );
  assert.match(
    chatContentBody,
    /!isCompressed && compactionDividerIndex === idx \?[\s\S]*<CompactionDivider at=\{state\.lastCompactedAt\} \/>/,
    'compaction divider should render at the saved divider index',
  );
  assert.match(
    chatContentBody,
    /!isCompressed && compactionDividerIndex === state\.messages\.length \? \([\s\S]*<CompactionDivider at=\{state\.lastCompactedAt\} \/>/,
    'compaction divider should also render at the end of the message list',
  );
});
