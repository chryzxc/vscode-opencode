import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('InputWrapper treats active streaming as AI responding for stop/send toggle', () => {
  assert.match(
    panelSource,
    /const isAiResponding = isProcessing/,
    'InputWrapper should keep stop/send visibility aligned with isProcessing',
  );
});
