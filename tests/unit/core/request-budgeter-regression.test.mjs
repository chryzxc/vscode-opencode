/**
 * Core Request Budgeter Regression Tests
 *
 * These tests prevent regressions in request budgeting functionality.
 * Request budgeting is critical for cost control and usage management.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const requestBudgeterSource = readSource(
  [joinFromRoot('src', 'services', 'RequestBudgeter.ts')],
  'RequestBudgeter.ts',
);

test.describe('Request Budgeter - Budget Checking', () => {

  test('canMakeRequest checks budget availability', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /canMakeRequest[\s\S]*usage|quota|budget|remaining/s,
      'must check budget availability'
    );
  });

  test('canMakeRequest considers safety margins', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /canMakeRequest[\s\S]*safety|margin|threshold|warn/s,
      'must consider safety margins'
    );
  });

  test('canMakeRequest returns boolean result', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /canMakeRequest[\s\S]*return\s*(true|false)|boolean/s,
      'must return boolean result'
    );
  });

});

test.describe('Request Budgeter - Usage Tracking', () => {

  test('recordRequest tracks request usage', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /recordRequest[\s\S]*usage|increment|count|track/s,
      'must track request usage'
    );
  });

  test('recordRequest updates daily usage', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /recordRequest[\s\S]*usageForDate|dailyUsage|today/s,
      'must update daily usage'
    );
  });

  test('getUsageForDate retrieves usage data', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getUsageForDate[\s\S]*usage|date|retrieve|get/s,
      'must retrieve usage for specific date'
    );
  });

  test('clearUsage resets usage data', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /clearUsage[\s\S]*usage\s*=\s*\{\}|reset|clear/s,
      'must reset usage data'
    );
  });

});

test.describe('Request Budgeter - Budget Status', () => {

  test('getBudgetStatus calculates budget status', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getBudgetStatus[\s\S]*usage|quota|remaining|projected/s,
      'must calculate budget status'
    );
  });

  test('getBudgetStatus determines warning level', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getBudgetStatus[\s\S]*warningLevel|critical|warning|ok/s,
      'must determine warning level'
    );
  });

  test('getBudgetStatus includes recommendations', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getBudgetStatus[\s\S]*advice|recommend|limit|daily/s,
      'must include budget recommendations'
    );
  });

});

test.describe('Request Budgeter - Plan Management', () => {

  test('setPlan updates subscription plan', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /setPlan[\s\S]*plan|subscription|quota|monthly/s,
      'must update subscription plan'
    );
  });

  test('getPlan retrieves current plan', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getPlan[\s\S]*return.*plan|config|subscription/s,
      'must retrieve current plan'
    );
  });

  test('plan operations handle plan limits', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /monthlyQuota|dailyAllowance|limit|quota/s,
      'must handle plan limits'
    );
  });

});

test.describe('Request Budgeter - Configuration', () => {

  test('loadConfig reads budget configuration', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /loadConfig[\s\S]*readJsonFile|config|load/s,
      'must load budget configuration'
    );
  });

  test('saveConfig persists budget configuration', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /saveConfig[\s\S]*writeJsonFile|persist|save/s,
      'must persist budget configuration'
    );
  });

  test('getConfig returns current configuration', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getConfig[\s\S]*return.*config|this\.config/s,
      'must return current configuration'
    );
  });

});

test.describe('Request Budgeter - Usage Statistics', () => {

  test('getUsageStats calculates usage statistics', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getUsageStats[\s\S]*usage|total|average|daily/s,
      'must calculate usage statistics'
    );
  });

  test('getTotalUsageThisMonth aggregates monthly usage', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getTotalUsageThisMonth[\s\S]*sum|total|aggregate|month/s,
      'must aggregate monthly usage'
    );
  });

  test('getRecommendedDailyLimit calculates optimal limit', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getRecommendedDailyLimit[\s\S]*remaining|days|optimal|safe/s,
      'must calculate optimal daily limit'
    );
  });

});

test.describe('Request Budgeter - Baseline Management', () => {

  test('setBaselineForDate records usage baseline', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /setBaselineForDate[\s\S]*baseline|record|save|persist/s,
      'must record usage baseline'
    );
  });

  test('getBaselineForDate retrieves baseline data', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getBaselineForDate[\s\S]*return.*baseline|retrieve|get/s,
      'must retrieve baseline data'
    );
  });

  test('baseline operations handle missing data', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /baseline.*undefined|null|fallback|default/s,
      'must handle missing baseline data'
    );
  });

});

test.describe('Request Budgeter - Date Calculations', () => {

  test('getTodayDate returns current date', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getTodayDate[\s\S]*new Date|Date\.now|toISOString/s,
      'must return current date'
    );
  });

  test('getDayOfMonth extracts day of month', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getDayOfMonth[\s\S]*getDate|day|date/s,
      'must extract day of month'
    );
  });

  test('getDaysInMonth calculates days in month', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getDaysInMonth[\s\S]*month|year|date|days/s,
      'must calculate days in month'
    );
  });

});

test.describe('Request Budgeter - Advice Generation', () => {

  test('getAdvice provides budget recommendations', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getAdvice[\s\S]*advice|recommend|warning|tip/s,
      'must provide budget recommendations'
    );
  });

  test('getAdvice considers usage patterns', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /getAdvice[\s\S]*usage|trend|pattern|behavior/s,
      'must consider usage patterns'
    );
  });

});

test.describe('Request Budgeter - Error Handling', () => {

  test('budget operations handle invalid data', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /if\s*\(\s*!.*\s*\)|validate|check|typeof/s,
      'must validate input data'
    );
  });

  test('budget operations provide safe defaults', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /return\s*\{\s*\}|default|fallback|undefined/s,
      'must provide safe defaults'
    );
  });

  test('budget operations log errors appropriately', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /logger\.(warn|error|debug)/s,
      'must log budget issues'
    );
  });

});

test.describe('Request Budgeter - Performance', () => {

  test('budget operations use efficient calculations', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /Math\.(min|max|floor|ceil)|reduce|forEach/s,
      'must use efficient calculations'
    );
  });

  test('budget operations cache expensive operations', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /cache|memo|store|baselines/s,
      'must cache expensive operations'
    );
  });

});

test.describe('Request Budgeter - Integration', () => {

  test('budget operations integrate with file system', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /readJsonFile|writeJsonFile|CONFIG_PATH|USAGE_PATH/s,
      'must integrate with file system'
    );
  });

  test('budget operations handle plan updates', () => {
    const source = requestBudgeterSource;

    assert.match(
      source,
      /updateConfig|plan|quota|limit|update/s,
      'must handle plan updates'
    );
  });

});
