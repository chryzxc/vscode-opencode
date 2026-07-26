import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('InputWrapper arms the Stop control on the first Escape press', () => {
  assert.match(
    panelSource,
    /if \(event\.key !== "Escape" \|\| !hasLiveAssistantTurn \|\| isSteering\)/,
    'the Escape shortcut should only be active for a live, non-steering turn',
  );
  assert.match(
    panelSource,
    /setIsEscapeArmed\(true\)/,
    'the first Escape press should arm the shortcut',
  );
  assert.match(
    panelSource,
    /isEscapeArmed \? \([\s\S]*?ESC[\s\S]*?\) : \(/,
    'the Stop control should show ESC while the shortcut is armed',
  );
});

test('InputWrapper stops on the second Escape press within the double-press window', () => {
  assert.match(
    panelSource,
    /const isDoublePress = lastPressAt !== null && now - lastPressAt <= 500;/,
    'the shortcut should require two Escape presses within 500ms',
  );
  assert.match(
    panelSource,
    /if \(isDoublePress\) \{[\s\S]*?setIsEscapeArmed\(false\)[\s\S]*?stopRequest\(\);/,
    'the second Escape press should invoke the canonical stop request',
  );
});
