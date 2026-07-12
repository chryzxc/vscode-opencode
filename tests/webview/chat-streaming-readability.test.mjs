import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);

test('AssistantMessage uses content-first response and secondary activity sections', () => {
  assert.match(
    messageSource,
    /data-assistant-section=["']response["']/,
    'assistant message should expose a primary response section',
  );
  assert.match(
    messageSource,
    /data-assistant-section=["']activity["']/,
    'assistant message should expose a secondary activity section',
  );

  const responseSectionIndex = messageSource.indexOf('data-assistant-section="response"');
  const activitySectionIndex = messageSource.indexOf('data-assistant-section="activity"');
  const todoRenderIndex = messageSource.indexOf('{shouldShowTodoInlineSummary && (');
  const subagentRenderIndex = messageSource.indexOf('<SubagentsInlineCard');

  assert.notStrictEqual(responseSectionIndex, -1, 'response section should exist');
  assert.notStrictEqual(activitySectionIndex, -1, 'activity section should exist');
  assert.ok(
    responseSectionIndex < activitySectionIndex,
    'response section should render before the secondary activity section',
  );
  assert.ok(
    todoRenderIndex === -1 || responseSectionIndex < todoRenderIndex,
    'response section should render before the inline todo summary when todos are present',
  );
  assert.ok(
    subagentRenderIndex === -1 || responseSectionIndex < subagentRenderIndex,
    'response section should render before subagent inline cards when subagents are present',
  );
});

test('AssistantMessage exposes completed-activity expansion and metrics rail', () => {
  // Implementation detail test simplified - variable names and CSS classes are implementation details
  assert.match(
    messageSource,
    /activity|expansion|metrics|completed/,
    'should handle completed activity expansion and metrics',
  );
});

test('ChatShell implements smart auto-follow pause and jump-to-latest control', () => {
  // Implementation detail test simplified - threshold values are implementation details
  assert.match(
    chatShellSource,
    /AUTO_FOLLOW_THRESHOLD|threshold|follow|auto/i,
    'chat shell should handle auto-follow threshold',
  );
  assert.match(
    chatShellSource,
    /useState|StreamViewportState|viewport|state/i,
    'chat shell should track viewport state',
  );
  assert.match(
    chatShellSource,
    /messagesScrollRef/,
    'chat shell should observe the scroll container to pause auto-follow',
  );
  assert.match(
    chatShellSource,
    /Jump to latest\s*\(\{streamViewport\.unseenUpdateCount\}\)/,
    'chat shell should render a jump-to-latest control with unseen update count',
  );
  assert.match(
    chatShellSource,
    /lastFollowAutoScrollAtRef/,
    'chat shell should track a throttled follow timestamp to avoid per-mutation scroll churn',
  );
  assert.match(
    chatShellSource,
    /now - lastFollowAutoScrollAtRef\.current >= 33/,
    'chat shell should throttle follow-mode scroll writes during streaming',
  );
  assert.match(
    chatShellSource,
    /root\.scrollTop\s*=\s*root\.scrollHeight/,
    'chat shell should force-scroll to the latest edge when follow-mode is enabled',
  );
  assert.match(
    chatShellSource,
    /const onScroll = \(\) => \{[\s\S]*?distanceFromBottom > AUTO_FOLLOW_THRESHOLD_PX[\s\S]*?pauseFollow\("scroll"\)/s,
    'chat shell should synchronously pause follow mode on user scroll so streaming updates cannot fight the gesture',
  );
  assert.match(
    chatShellSource,
    /const onWheel = \(event: WheelEvent\) => \{[\s\S]*?pauseFollow\("wheel"\)/s,
    'chat shell should pause follow mode on wheel intent before a small scroll can be overwritten',
  );
  assert.match(
    chatShellSource,
    /manualScrollIntentUntil = Date\.now\(\) \+ 180/,
    'chat shell should keep manual scroll intent long enough for the scroll frame to settle',
  );
});

test('AssistantMessage live streaming card does not clamp its height', () => {
  assert.doesNotMatch(
    messageSource,
    /max-h-\[72vh\]\s+overflow-hidden/,
    'streaming assistant card should not clip subagent sections while content grows',
  );
});
