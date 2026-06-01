import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const schemaSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
  'structuredOutputSchema.ts',
);

const validatorSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
  'structuredOutputValidator.ts',
);

test.skip('structured output schema defines changeSummary with per-file diff metadata', () => {
  // This feature is not yet implemented
  assert.match(
    schemaSource,
    /changeSummary:\s*\{/,
    'schema should define top-level changeSummary',
  );
  assert.match(
    schemaSource,
    /filesChanged:/,
    'changeSummary should include filesChanged',
  );
  assert.match(
    schemaSource,
    /files:\s*\{[\s\S]*type:\s*"array"/,
    'changeSummary should include files array',
  );
  assert.match(
    schemaSource,
    /diffExcerpt:\s*\{[\s\S]*lines:/,
    'changeSummary file entries should support diffExcerpt.lines',
  );
});

test.skip('validator requires structured changeSummary when file-edit progress updates exist', () => {
  assert.match(
    validatorSource,
    /const hasFileEditProgressUpdate = Array\.isArray\(record\.progressUpdates\)/,
    'validator should detect final file-edit progress updates',
  );
  assert.match(
    validatorSource,
    /File edits detected: changeSummary\.files is required and must list changed files/,
    'validator should require changeSummary.files when file edits are present',
  );
  assert.match(
    validatorSource,
    /File edits detected: changeSummary\.files should include diffExcerpt\.lines for changed files/,
    'validator should require diff excerpt lines in file-change summaries',
  );
});
