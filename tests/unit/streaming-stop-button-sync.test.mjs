import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('InputWrapper derives stop/send toggle from the active assistant response state', () => {
  assert.match(
    panelSource,
    /const isAiResponding = isAssistantRespondingInCurrentSession\([\s\S]*Boolean\(streaming\?\.isActive\)[\s\S]*assistantTurnPending/s,
    'InputWrapper should treat the full active-assistant turn state as stop-worthy',
  );
});
