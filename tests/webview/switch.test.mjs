import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

test('switch source contract', () => {
  const src = readSource([joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'switch.tsx')], 'switch');

  assert.match(src, /export\s*\{[^}]*Switch[^}]*\}/, 'exports Switch');
  assert.match(src, /role\s*=\s*["']switch["']/, 'sets switch role');
  assert.match(src, /aria-checked/, 'includes aria-checked');
  assert.match(src, /data-state.*checked.*unchecked/s, 'toggles data-state');
  assert.match(src, /onClick.*onCheckedChange/s, 'calls onCheckedChange on click');
});
