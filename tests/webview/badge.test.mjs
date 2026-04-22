import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

test('badge source contract', () => {
  const src = readSource([joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'badge.tsx')], 'badge');

  assert.match(src, /export\s*\{[^}]*(?:Badge|badgeVariants)[^}]*\}/, 'exports Badge and badgeVariants');
  assert.match(src, /export\s+interface\s+BadgeProps/, 'exports BadgeProps interface');
  assert.match(src, /\bcva\(/, 'uses cva');
  assert.match(src, /oc-badge/, 'includes oc-badge class');
  assert.match(src, /variant:\s*\{[\s\S]*?default.*secondary/s, 'declares badge variants');
});
