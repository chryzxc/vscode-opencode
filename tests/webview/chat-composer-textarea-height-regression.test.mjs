import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

test('chat composer textarea grows for whitespace-only draft input', () => {
  const src = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
    'PanelComponents.tsx',
  );

  assert.match(
    src,
    /const textareaHasValue = inputValue\.length > 0;/,
    'textarea sizing should treat whitespace-only drafts as non-empty so the max row limit expands',
  );
  assert.match(
    src,
    /const textareaMaxRows = textareaHasValue \? 8 : 3;/,
    'textarea should keep the taller max-row limit for active drafts',
  );
  assert.doesNotMatch(
    src,
    /const textareaHasValue = inputValue\.trim\(\)\.length > 0;/,
    'textarea sizing should no longer depend on trimmed input',
  );
});
