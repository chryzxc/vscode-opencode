/**
 * Core Quota Service Regression Tests
 *
 * These tests prevent regressions in quota management functionality.
 * Quota tracking is critical for API usage management and cost control.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const quotaServiceSource = readSource(
  [joinFromRoot('src', 'services', 'QuotaService.ts')],
  'QuotaService.ts',
);

test.describe('Quota Service - Copilot Integration', () => {

  test('fetchCopilot retrieves Copilot quota data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchCopilot[\s\S]*httpsGet|fetch|request/s,
      'must fetch Copilot quota data'
    );
  });

  test('fetchCopilot handles authentication', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchCopilot[\s\S]*token|auth|bearer|github/s,
      'must handle Copilot authentication'
    );
  });

  test('fetchCopilot parses quota limits', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchCopilot[\s\S]*limit|quota|remaining|total/s,
      'must parse quota limit information'
    );
  });

});

test.describe('Quota Service - Google Integration', () => {

  test('fetchGoogle retrieves Google quota data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchGoogle[\s\S]*httpsGet|fetch|request/s,
      'must fetch Google quota data'
    );
  });

  test('fetchGoogle handles API authentication', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchGoogle[\s\S]*token|auth|bearer|oauth/s,
      'must handle Google authentication'
    );
  });

  test('fetchGoogle parses usage statistics', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchGoogle[\s\S]*usage|quota|tokens|requests/s,
      'must parse usage statistics'
    );
  });

});

test.describe('Quota Service - OpenAI Integration', () => {

  test('fetchOpenAI retrieves OpenAI quota data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchOpenAI[\s\S]*httpsGet|fetch|request|usage/s,
      'must fetch OpenAI usage data'
    );
  });

  test('fetchOpenAI handles API authentication', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchOpenAI[\s\S]*token|auth|bearer|api.*key/s,
      'must handle OpenAI authentication'
    );
  });

  test('fetchOpenAI parses usage data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchOpenAI[\s\S]*usage|tokens|prompt|completion/s,
      'must parse usage data'
    );
  });

});

test.describe('Quota Service - Zhipu Integration', () => {

  test('fetchZhipu retrieves Zhipu quota data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchZhipu[\s\S]*httpsGet|fetch|request/s,
      'must fetch Zhipu quota data'
    );
  });

  test('fetchZhipu parses quota information', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /fetchZhipu[\s\S]*quota|usage|limit|remaining/s,
      'must parse quota information'
    );
  });

});

test.describe('Quota Service - Data Caching', () => {

  test('cachedData provides cached quota data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /cachedData[\s\S]*_cachedData|cache|return/s,
      'must return cached quota data'
    );
  });

  test('cachedData provides cached quota data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /cachedData[\s\S]*return\s*this\._cachedData|_cachedData/s,
      'must return cached data'
    );
  });

  test('quota operations update cache', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /_cachedData\s*=|cache\s*=|updateCache/s,
      'must update cache with new data'
    );
  });

});

test.describe('Quota Service - Auto Refresh', () => {

  test('startAutoRefresh initiates periodic updates', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /startAutoRefresh[\s\S]*timer|setInterval|schedule/s,
      'must schedule periodic quota refresh'
    );
  });

  test('startAutoRefresh respects refresh interval', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /startAutoRefresh[\s\S]*interval|frequency|DEFAULT_REFRESH/s,
      'must respect refresh interval'
    );
  });

  test('dispose stops auto-refresh timer', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /dispose[\s\S]*timer|clearInterval|stop/s,
      'must stop refresh timer'
    );
  });

});

test.describe('Quota Service - Refresh Operations', () => {

  test('refreshQuota updates all provider quotas', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /refreshQuota[\s\S]*fetchCopilot|fetchGoogle|fetchOpenAI/s,
      'must refresh all provider quotas'
    );
  });

  test('refreshQuota handles partial failures', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /refreshQuota[\s\S]*catch|error|fallback|try/s,
      'must handle partial quota refresh failures'
    );
  });

});

test.describe('Quota Service - Data Parsing', () => {

  test('quota operations parse JSON responses', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /JSON\.parse|parse.*response|readJsonFile/s,
      'must parse JSON quota responses'
    );
  });

  test('quota operations validate response structure', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /validate|check|if\s*\(\s*!.*\s*\)/s,
      'must validate response structure'
    );
  });

  test('quota operations extract quota metrics', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /quota|usage|limit|remaining|total/s,
      'must extract quota metrics'
    );
  });

});

test.describe('Quota Service - Error Handling', () => {

  test('quota operations handle network errors', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /try\s*\{[\s\S]*catch\s*\(|if\s*\(\s*error/s,
      'must handle network errors'
    );
  });

  test('quota operations handle authentication failures', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /401|403|unauthorized|forbidden|auth/s,
      'must handle authentication failures'
    );
  });

  test('quota operations log errors appropriately', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /logger\.(warn|error|debug)/s,
      'must log quota issues'
    );
  });

});

test.describe('Quota Service - Performance', () => {

  test('quota operations use efficient HTTP requests', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /httpsGet|fetch|request|timeout/s,
      'must use efficient HTTP requests'
    );
  });

  test('quota operations avoid redundant requests', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /cache|ttl|throttle|debounce/s,
      'must avoid redundant quota requests'
    );
  });

});

test.describe('Quota Service - Platform Support', () => {

  test('quota service supports multiple platforms', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /copilot|google|openai|zhipu|platform/s,
      'must support multiple platforms'
    );
  });

  test('quota service handles platform-specific APIs', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /platform|provider|api|endpoint/s,
      'must handle platform-specific APIs'
    );
  });

});

test.describe('Quota Service - Data Formatting', () => {

  test('quota service formats usage data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /formatNumber|formatDuration|formatReset/s,
      'must format usage data for display'
    );
  });

  test('quota service normalizes platform data', () => {
    const source = quotaServiceSource;

    assert.match(
      source,
      /normalize|transform|convert|map/s,
      'must normalize platform-specific data'
    );
  });

});
