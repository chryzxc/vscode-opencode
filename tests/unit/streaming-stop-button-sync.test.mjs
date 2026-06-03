import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('InputWrapper limits stop/send toggle to abortable assistant response state', () => {
  assert.match(
    panelSource,
    /const isAiResponding = !!\([\s\S]*isProcessing[\s\S]*streaming\?\.isActive[\s\S]*!\s*hasCompletedAssistantReplyForLatestTurn[\s\S]*\);/,
    'InputWrapper should only treat active or pre-reply streaming as stop-worthy',
  );
});
