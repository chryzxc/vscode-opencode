import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test.skip('assistant metrics render as compact summary line', () => {
  // This feature is not yet implemented
  assert.match(
    source,
    /const compactMetricSummary = useMemo\(\(\) => \{/,
    'should build compact metrics summary text',
  );
  assert.match(
    source,
    /segments\.push\(`Prompt \$\{inputTok\.toLocaleString\(\)\}`\)/,
    'summary should include prompt tokens',
  );
  assert.match(
    source,
    /segments\.push\(`Resp \$\{outputTok\.toLocaleString\(\)\}`\)/,
    'summary should include response tokens',
  );
  assert.match(
    source,
    /className=\"oc-metrics-summary\"/,
    'should render compact metrics summary container',
  );
});
