import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

test('search block source contract', () => {
  const src = readSource([joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'SearchBlock.tsx')], 'search block');

  assert.match(src, /export\s+(?:const|function)\s+SearchBlock/, 'exports SearchBlock');
  assert.match(src, /SearchBlockProps[\s\S]*?pattern:\s*string/, 'declares pattern in SearchBlockProps');
  assert.match(src, /if\s*\(\s*!pattern/, 'guards against missing pattern');
  assert.match(src, /return\s+null/, 'returns null for empty pattern');
  assert.match(src, /oc-search-block["'\s]/, 'includes oc-search-block class');
  assert.match(src, /oc-search-block-code/, 'includes oc-search-block-code class');
  assert.match(src, /oc-search-block-header/, 'renders search block header conditionally');
  assert.match(src, /SearchBlock\.displayName\s*=\s*["']SearchBlock["']/, 'sets SearchBlock displayName');
});
