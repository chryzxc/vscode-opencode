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
  assert.match(
    messageSource,
    /const\s+MAX_VISIBLE_COMPLETED_ACTIVITY\s*=\s*5/,
    'completed activity uses a 5-row local threshold for condensing',
  );
  assert.match(
    messageSource,
    /showAllCompletedActivity/,
    'assistant message keeps local expansion state for completed activity rows',
  );
  assert.match(
    messageSource,
    /oc-metrics-rail[\s\S]*oc-token-chip[\s\S]*oc-token-chip-secondary/s,
    'assistant message should expose metrics rail with token chips for activity context',
  );
});

test('ChatShell implements smart auto-follow pause and jump-to-latest control', () => {
  assert.match(
    chatShellSource,
    /const\s+AUTO_FOLLOW_THRESHOLD_PX\s*=\s*96/,
    'chat shell should use a near-bottom threshold for follow mode',
  );
  assert.match(
    chatShellSource,
    /useState<StreamViewportState>\(/,
    'chat shell should track stream viewport state in component state',
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
});

test('AssistantMessage live streaming card does not clamp its height', () => {
  assert.doesNotMatch(
    messageSource,
    /max-h-\[72vh\]\s+overflow-hidden/,
    'streaming assistant card should not clip subagent sections while content grows',
  );
});
