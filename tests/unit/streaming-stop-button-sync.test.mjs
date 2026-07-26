import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);
const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
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
  assert.match(
    chatShellSource,
    /const showExtendedLoading\s*=\s*!state\.isCompacting\s*&&\s*\(hasLiveAssistantTurn \|\| showAiResponseLoading\);/,
    'the rendered loading ticker must directly use the same live-turn condition as Stop, gated off while compaction owns the live-response surface',
  );
  assert.doesNotMatch(
    chatShellSource,
    /const showAiResponseLoading =[\s\S]*hasRenderableStreamingContent/s,
    'stream content or activity must not hide the loading ticker while Stop remains available',
  );
  assert.match(
    chatShellSource,
    /const hasNewLiveTurnBeforeAssistantIdentity =[\s\S]*Boolean\(state\.streaming\?\.isActive\)[\s\S]*state\.assistantTurnPending[\s\S]*visiblePendingUserMessages\.length > 0[\s\S]*!hasNewLiveTurnBeforeAssistantIdentity/s,
    'a previous terminal assistant message must not hide the next turn\'s loading ticker before its message identity arrives',
  );
});
