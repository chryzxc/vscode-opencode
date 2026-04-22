import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

test('tabs source contract', () => {
  const src = readSource([joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'tabs.tsx')], 'tabs');

  assert.match(src, /TabsRoot\s+as\s+Tabs.*TabsList.*TabsTrigger.*TabsContent/s, 'exports Tabs primitives');
  assert.match(src, /TabsContext/, 'creates TabsContext');
  assert.match(src, /Tabs components must be used within a Tabs component/, 'guards missing context usage');
  assert.match(src, /const\s+activeValue\s*=/, 'uses activeValue for controlled/uncontrolled state');
  assert.match(src, /setInternalValue\(/, 'updates internal tab value');
  assert.match(src, /if\s*\(activeValue !== value\) return null/, 'conditionally hides inactive content');
  assert.match(src, /TabsRoot\.displayName\s*=|Tabs\.displayName\s*=/, 'sets tab displayName');
});
