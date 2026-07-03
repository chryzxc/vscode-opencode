import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);
const sessionProcessingSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'sessionProcessing.ts')],
  'sessionProcessing.ts',
);

test('InputWrapper derives stop/send toggle from the active assistant response state', () => {
  assert.match(
    sessionProcessingSource,
    /export function shouldDeferComposerSendInCurrentSession\([\s\S]*if \(isStreamingActive \|\| assistantTurnPending\) \{[\s\S]*return true;[\s\S]*if \(!currentSessionId\) \{[\s\S]*return false;[\s\S]*processingSessionIds\.includes\(currentSessionId\)/s,
    'composer stop/defer mode should require live streaming, pending, or session-scoped processing state',
  );
  assert.match(
    panelSource,
    /const hasLiveAssistantTurn = shouldDeferComposerSendInCurrentSession\([\s\S]*\{hasLiveAssistantTurn \? \([\s\S]*aria-label="Stop"/s,
    'InputWrapper stop button should follow the stricter live-turn signal',
  );
});
