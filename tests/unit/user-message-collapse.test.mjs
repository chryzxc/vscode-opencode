import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test.skip('UserMessage collapses long text using character threshold', () => {
  // This feature is not yet implemented
  assert.match(
    source,
    /const USER_MESSAGE_COLLAPSE_THRESHOLD = 500;/,
    'UserMessage should define 500-char collapse threshold',
  );
  assert.match(
    source,
    /const shouldCollapse = content\.length > USER_MESSAGE_COLLAPSE_THRESHOLD;/,
    'UserMessage should trigger collapse when content exceeds threshold',
  );
  assert.match(
    source,
    /const visibleContent =[\s\S]*content\.slice\(0, USER_MESSAGE_COLLAPSE_THRESHOLD\)/,
    'UserMessage should show truncated preview when collapsed',
  );
});

test.skip('UserMessage exposes show more/less toggle for long content', () => {
  // This feature is not yet implemented
  assert.match(
    source,
    /\{isExpanded \? "Show less" : "Show more"\}/,
    'UserMessage should render Show more/Show less toggle',
  );
  assert.match(
    source,
    /onClick=\{\(\) => setIsExpanded\(\(prev\) => !prev\)\}/,
    'UserMessage should toggle expanded state on click',
  );
});
