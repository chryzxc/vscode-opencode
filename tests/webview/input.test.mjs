import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

test('input source contract', () => {
  const src = readSource([joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'input.tsx')], 'input');

  assert.match(src, /export\s*\{[^}]*Input[^}]*\}/, 'exports Input');
  assert.match(src, /export\s+interface\s+InputProps/, 'exports InputProps interface');
  assert.match(src, /focus-visible:ring-oc-accent/, 'includes focus ring styling');
  assert.match(src, /Input\.displayName\s*=\s*["']Input["']/, 'sets Input displayName');
});
