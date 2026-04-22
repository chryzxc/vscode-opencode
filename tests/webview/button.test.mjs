import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

test('button source contract', () => {
  const src = readSource([joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'button.tsx')], 'button');

  assert.match(src, /export\s*\{[^}]*(?:Button|buttonVariants)[^}]*\}/, 'exports Button and buttonVariants');
  assert.match(src, /export\s+interface\s+ButtonProps/, 'exports ButtonProps interface');
  assert.match(src, /asChild\s*\?\s*Slot\s*:\s*["']button["']/, 'uses Slot for asChild');
  assert.match(src, /Button\.displayName\s*=\s*["']Button["']/, 'sets Button displayName');
  assert.match(src, /forwardRef/, 'uses forwardRef');
  assert.match(src, /send:|stop:|ghost:/, 'includes send stop and ghost variants');
});
