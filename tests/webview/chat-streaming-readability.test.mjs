import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

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
});

test('AssistantMessage supports condensed completed activity and local toggles', () => {
  assert.match(
    messageSource,
    /const\s+MAX_VISIBLE_COMPLETED_ACTIVITY\s*=\s*5/,
    'completed activity should default to a 5-row condensed threshold',
  );
  assert.match(
    messageSource,
    /showAllCompletedActivity/,
    'assistant message should keep per-message local expansion state for completed activity',
  );
  assert.match(
    messageSource,
    /showActivityDetails/,
    'assistant message should expose a per-message details toggle',
  );
  assert.match(
    messageSource,
    /showThinkingDetails/,
    'assistant message should expose a per-message thinking toggle',
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
});
