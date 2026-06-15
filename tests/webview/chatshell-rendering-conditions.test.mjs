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
    /state\.messages\.length === 0[\s\S]*!state\.streaming[\s\S]*!isAiResponding[\s\S]*<EmptyState[\s\S]*currentSessionId=\{state\.currentSessionId\}/s,
    'empty chat should show the empty state card',
  );
});

test('message routing sends user and system roles to dedicated components', () => {
  assert.match(chatContentBody, /if \(role === "user"\) \{[\s\S]*<UserMessage message=\{msg\} \/>/, 'user messages should render UserMessage');
  assert.match(chatContentBody, /else if \(role === "system"\) \{[\s\S]*<SystemMessage[\s\S]*accentColor=\{resolveAgentColor\(systemAgentId\)\}/, 'system messages should render SystemMessage with agent color');
});

test('permission responses render PermissionCard and assistants use AssistantMessage', () => {
  assert.match(chatContentBody, /else if \(\(msg as Record<string, unknown>\)\.type === "permission"\) \{[\s\S]*<PermissionCard perm=\{msg\} \/>/s, 'permission messages should render PermissionCard');
  assert.match(chatContentBody, /const isLiveStreamingAssistantTurn =[\s\S]*state\.streaming\?\.isActive[\s\S]*streamingMessageId === messageId/s, 'ChatShell should identify the live assistant turn from the active stream message id');
  assert.match(chatContentBody, /<StreamingCard[\s\S]*assistantTurnMessageId=\{state\.assistantTurnMessageId\}/s, 'ChatShell should pass the assistant turn message id into the live streaming card');
  assert.match(chatContentBody, /if \(isLiveStreamingAssistantTurn\) \{\s*messageNode = null;/s, 'ChatShell should skip the in-flight assistant turn in the message list');
});

test('thinking bubble appears while AI is responding before assistant text arrives', () => {
  assert.match(
    chatContentBody,
    /const hasAssistantText =[\s\S]*state\.streaming\?\.content[\s\S]*state\.streaming\.content\.trim\(\)\.length > 0/s,
    'ChatShell should identify whether streamed assistant text has arrived',
  );
  assert.match(
    chatContentBody,
    /const isAiStillResponding = isAssistantRespondingInCurrentSession\([\s\S]*Boolean\(state\.streaming\?\.isActive\)[\s\S]*state\.assistantTurnPending/s,
    'ChatShell should treat live stream activity and assistant-turn pending state as still responding',
  );
  assert.match(
    chatContentBody,
    /const showAiResponseLoading =[\s\S]*isAiStillResponding[\s\S]*!state\.isCompacting/s,
    'thinking bubble should remain visible while the assistant turn is still active',
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
    /<StreamingCard[\s\S]*streaming=\{state\.streaming\}/s,
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
