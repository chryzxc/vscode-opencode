/**
 * QuotaService Unit Tests
 *
 * Tests for QuotaService class functionality:
 * - EventEmitter capabilities
 * - Data caching
 * - Quota refresh logic
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const quotaServiceSource = readSource(
  [joinFromRoot('src', 'services', 'QuotaService.ts')],
  'QuotaService.ts',
);

test('QuotaService extends EventEmitter for update broadcasts', () => {
  assert.match(
    quotaServiceSource,
    /export\s+class\s+QuotaService\s+extends\s+EventEmitter/,
    'QuotaService should extend EventEmitter'
  );
});

test('refreshQuota caches latest quota data', () => {
  const refreshBody = extractFunctionBody(
    quotaServiceSource,
    'public async refreshQuota(): Promise<QuotaData>'
  );

  assert.match(
    refreshBody,
    /this\._cachedData\s*=\s*data;/,
    'refreshQuota should cache data'
  );
});

test('refreshQuota emits quotaUpdate event', () => {
  const refreshBody = extractFunctionBody(
    quotaServiceSource,
    'public async refreshQuota(): Promise<QuotaData>'
  );

  assert.match(
    refreshBody,
    /this\.emit\("quotaUpdate",\s*data\)/,
    'refreshQuota should emit quotaUpdate'
  );
});

test('refreshQuota constructs normalized QuotaData payload', () => {
  const refreshBody = extractFunctionBody(
    quotaServiceSource,
    'public async refreshQuota(): Promise<QuotaData>'
  );

  assert.match(
    refreshBody,
    /const\s+data:\s*QuotaData\s*=\s*\{[\s\S]*platforms,[\s\S]*lastUpdated:\s*Date\.now\(\)/,
    'refreshQuota should construct QuotaData'
  );
});

test('QuotaService provides cachedData accessor', () => {
  assert.match(
    quotaServiceSource,
    /get\s+cachedData\(\)/,
    'QuotaService should have cachedData getter'
  );
});
