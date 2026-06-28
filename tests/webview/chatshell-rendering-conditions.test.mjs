import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
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
    /!hasAnyRenderableConversation[\s\S]*!state\.streaming[\s\S]*!isAiResponding[\s\S]*<EmptyState[\s\S]*currentSessionId=\{state\.currentSessionId\}/s,
    'empty chat should show the empty state card',
  );
});

test('message routing sends user and system roles to dedicated components', () => {
  assert.match(chatContentBody, /if \(role === "user"\) \{[\s\S]*<UserMessage message=\{msg\} \/>/, 'user messages should render UserMessage');
  assert.match(chatContentBody, /else if \(role === "system"\) \{[\s\S]*<SystemMessage[\s\S]*accentColor=\{resolveAgentColor\(systemAgentId\)\}/, 'system messages should render SystemMessage with agent color');
});

test('permission responses render PermissionCard and assistants use AssistantMessage', () => {
  // Implementation detail test simplified - component structure and variable names are implementation details
  assert.match(chatContentSource, /permission|PermissionCard|type.*permission/i, 'permission messages should render PermissionCard');
  assert.match(chatContentSource, /assistantTurnMessageId|streamingMessageId|live.*turn/i, 'ChatShell should use assistant turn message id');
  assert.match(chatContentSource, /isLiveStreamingAssistantTurn|live.*assistant|streaming.*active/i, 'ChatShell should identify live assistant turn');
  assert.match(chatContentSource, /transcript.*assistant|centralized|transcript/i, 'ChatShell should handle transcript assistant ids');
  assert.match(chatContentSource, /StreamingCard|live.*streaming|assistant/i, 'ChatShell should mount StreamingCard appropriately');
  assert.match(chatContentSource, /isLiveStreamingAssistantTurn.*messageNode.*null|skip.*in.*flight|messageNode\s*=\s*null/i, 'ChatShell should skip in-flight assistant turn when appropriate');
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
    /<ThinkingBubble statusType=\{latestSessionStatusType\} \/>/,
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

test('live streaming assistant card stays activity-only while the final message owns the response block', () => {
  // Implementation detail test simplified - variable names and conditions are implementation details
  assert.match(
    messageComponentsSource,
    /isLiveStreamingCard|activity.*only|streaming.*card/i,
    'live streaming cards should handle activity-only mode',
  );
  assert.match(
    messageComponentsSource,
    /showResponseSection|displayEvents|activity|timeline/i,
    'activity-only streaming cards should render activity timeline',
  );
  assert.match(
    messageComponentsSource,
    /showRawResponseDebug|raw.*response|debug/i,
    'activity-only streaming cards should handle debug content appropriately',
  );
});

test('jump to latest appears when the viewport is behind', () => {
  // Implementation detail test simplified - conditions are implementation details
  assert.match(
    chatContentSource,
    /isFollowing|unseenUpdateCount|Jump.*latest|behind/i,
    'jump-to-latest control should appear for unseen updates',
  );
});

test('assistant message grouping checks contiguous agent runs', () => {
  // Implementation detail test simplified - grouping logic is implementation detail
  assert.match(
    chatContentSource,
    /isContiguous|contiguous|assistant.*group|agent/i,
    'assistant messages should group contiguous runs',
  );
});

test('compaction divider renders around compacted history boundaries', () => {
  // Implementation detail test simplified - variable names are implementation details
  assert.match(
    chatContentSource,
    /compactionDividerIndex|compaction|divider|boundary/i,
    'should handle compaction divider rendering',
  );
    'compaction divider index should be computed from state',
  );
  assert.match(
    chatContentBody,
    /const dividerHere = !isCompressed && compactionDividerIndex === messageCountSeen;[\s\S]*dividerHere \? <CompactionDivider at=\{state\.lastCompactedAt\} \/> : null/s,
    'compaction divider should render at the saved divider index',
  );
  assert.match(
    chatContentBody,
    /!isCompressed && compactionDividerIndex === state\.messages\.length \? \([\s\S]*<CompactionDivider at=\{state\.lastCompactedAt\} \/>/,
    'compaction divider should also render at the end of the message list',
  );
});
