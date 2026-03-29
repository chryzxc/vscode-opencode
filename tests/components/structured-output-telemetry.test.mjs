import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('chat provider tracks structured validation failure counters by responseType/provider/model', () => {
  assert.match(
    providerSource,
    /structuredValidationFailureCounters\s*=\s*new Map<string,\s*number>\(\)/,
    'provider should keep structured validation failure counters',
  );
  assert.match(
    providerSource,
    /private recordStructuredValidationFailure\(/,
    'provider should define structured validation failure telemetry helper',
  );
  const helperBody = extractFunctionBody(
    providerSource,
    'private recordStructuredValidationFailure(',
  );
  assert.match(
    helperBody,
    /const key = `\$\{responseType\}\|\$\{providerID\}\/\$\{modelID\}`;/,
    'telemetry key should include responseType and provider/model dimensions',
  );
  assert.match(
    helperBody,
    /Structured output validation failure aggregate/,
    'telemetry helper should emit aggregate warning logs',
  );
});

test('normalizeStructuredOutput forwards validation failures to telemetry', () => {
  const normalizeBody = extractFunctionBody(
    providerSource,
    'private normalizeStructuredOutput(',
  );
  assert.match(
    normalizeBody,
    /this\.recordStructuredValidationFailure\(\s*canonicalRec,\s*validation\.errors,\s*diagnostics,?\s*\)/,
    'normalizer should record structured validation failures with diagnostics metadata',
  );
});
