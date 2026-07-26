import { test } from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('structured-output fallback renders as an inline warning rather than an error card', () => {
  assert.match(
    source,
    /cardMessage\?\.displayError\?\.type === "structured_output_failure"/,
    'the typed structured-output fallback must be classified separately from request failures',
  );
  assert.match(
    source,
    /const showDisplayErrorBanner =\s*!!cardMessage\?\.displayError && !structuredOutputWarning/,
    'the red display-error card must be suppressed for structured-output fallback',
  );
  assert.match(
    source,
    /\{structuredOutputWarning && \([\s\S]*?oc-refined-file-link-with-tooltip[\s\S]*?role="tooltip"[\s\S]*?<button[\s\S]*?title="Copy message"/,
    'the fallback warning must use the rendered hover tooltip immediately to the left of the copy control',
  );
});
