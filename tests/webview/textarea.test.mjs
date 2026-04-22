import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

test('textarea source contract', () => {
  const src = readSource([joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'textarea.tsx')], 'textarea');

  assert.match(src, /export\s*\{[^}]*Textarea[^}]*\}/, 'exports Textarea');
  assert.match(src, /export\s+interface\s+TextareaProps/, 'exports TextareaProps interface');
  assert.match(src, /oc-textarea/, 'includes oc-textarea class');
  assert.match(src, /Textarea\.displayName\s*=\s*['"]Textarea['"]/, 'sets Textarea displayName');
});
