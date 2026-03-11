/**
 * Type Contract Regression Tests
 *
 * Critical regression tests for type definitions to prevent interface bugs:
 * - QuotaData interface structure
 * - BudgetInfo interface structure
 * - Type exports
 * - Required vs optional fields
 * - Field types and constraints
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../../../helpers/source-utils.mjs';

const typesSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
  'types.ts',
);

test('types.ts exports QuotaData interface', () => {
  assert.match(
    typesSource,
    /export\s+interface\s+QuotaData/,
    'QuotaData interface should be exported'
  );
});

test('QuotaData has platforms field', () => {
  assert.match(
    typesSource,
    /platforms:\s*PlatformQuota\[\]/,
    'QuotaData should have platforms array'
  );
});

test('QuotaData has lastUpdated field', () => {
  assert.match(
    typesSource,
    /lastUpdated:\s*number/,
    'QuotaData should have lastUpdated number'
  );
});

test('types.ts exports PlatformQuota interface', () => {
  assert.match(
    typesSource,
    /export\s+interface\s+PlatformQuota/,
    'PlatformQuota interface should be exported'
  );
});

test('PlatformQuota has platform field', () => {
  assert.match(
    typesSource,
    /platform:\s*string/,
    'PlatformQuota should have required platform string'
  );
});

test('PlatformQuota has quotas field', () => {
  assert.match(
    typesSource,
    /quotas:\s*QuotaItem\[\]/,
    'PlatformQuota should have quotas array'
  );
});

test('PlatformQuota has status field', () => {
  assert.match(
    typesSource,
    /status:\s*['"]ok['"]\s*\|\s*['"]warning['"]\s*\|\s*['"]error['"]/,
    'PlatformQuota should have status field'
  );
});

test('PlatformQuota has accountLabel field', () => {
  assert.match(
    typesSource,
    /accountLabel\?:\s*string/,
    'PlatformQuota should have optional accountLabel'
  );
});

test('types.ts exports QuotaItem interface', () => {
  assert.match(
    typesSource,
    /export\s+interface\s+QuotaItem/,
    'QuotaItem interface should be exported'
  );
});

test('QuotaItem has usedTotalDisplay field', () => {
  assert.match(
    typesSource,
    /usedTotalDisplay\?:\s*string/,
    'QuotaItem should have optional usedTotalDisplay string'
  );
});

test('types.ts exports BudgetInfo interface', () => {
  assert.match(
    typesSource,
    /export\s+interface\s+BudgetInfo/,
    'BudgetInfo interface should be exported'
  );
});

test('BudgetInfo has planName field', () => {
  assert.match(
    typesSource,
    /planName:\s*string/,
    'BudgetInfo should have required planName string'
  );
});

test('BudgetInfo has monthlyQuota field', () => {
  assert.match(
    typesSource,
    /monthlyQuota:\s*number/,
    'BudgetInfo should have required monthlyQuota number'
  );
});

test('BudgetInfo has usedToday field', () => {
  assert.match(
    typesSource,
    /usedToday:\s*number/,
    'BudgetInfo should have required usedToday number'
  );
});

test('BudgetInfo has dailyAllowance field', () => {
  assert.match(
    typesSource,
    /dailyAllowance:\s*number/,
    'BudgetInfo should have required dailyAllowance number'
  );
});

test('BudgetInfo has availableToday field', () => {
  assert.match(
    typesSource,
    /availableToday:\s*number/,
    'BudgetInfo should have required availableToday number'
  );
});

test('BudgetInfo has remainingToday field', () => {
  assert.match(
    typesSource,
    /remainingToday:\s*number/,
    'BudgetInfo should have required remainingToday number'
  );
});

test('BudgetInfo has daysRemaining field', () => {
  assert.match(
    typesSource,
    /daysRemaining:\s*number/,
    'BudgetInfo should have required daysRemaining number'
  );
});

test('BudgetInfo has projectedMonthlyUsage field', () => {
  assert.match(
    typesSource,
    /projectedMonthlyUsage:\s*number/,
    'BudgetInfo should have required projectedMonthlyUsage number'
  );
});

test('BudgetInfo has warningLevel field', () => {
  assert.match(
    typesSource,
    /warningLevel:\s*['"]ok['"]\s*\|\s*['"]warning['"]\s*\|\s*['"]critical['"]/,
    'BudgetInfo should have warningLevel with specific values'
  );
});

test('BudgetInfo has advice field', () => {
  assert.match(
    typesSource,
    /advice:\s*string\[\]/,
    'BudgetInfo should have required advice array'
  );
});

test('QuotaData platforms is required', () => {
  assert.match(
    typesSource,
    /platforms:\s*PlatformQuota\[\]/,
    'platforms field should be required'
  );
});

test('PlatformQuota quotas is required', () => {
  assert.match(
    typesSource,
    /quotas:\s*QuotaItem\[\]/,
    'quotas field should be required'
  );
});

test('PlatformQuota status is required', () => {
  assert.match(
    typesSource,
    /status:\s*['"]ok['"]\s*\|\s*['"]warning['"]\s*\|\s*['"]error['"]/,
    'status field should be required'
  );
});

test('QuotaItem usedTotalDisplay is optional', () => {
  assert.match(
    typesSource,
    /usedTotalDisplay\?:\s*string/,
    'usedTotalDisplay field should be optional'
  );
});

test('BudgetInfo all fields are required', () => {
  assert.match(
    typesSource,
    /planName:\s*string/,
    'planName should not be optional'
  );
  assert.match(
    typesSource,
    /monthlyQuota:\s*number/,
    'monthlyQuota should not be optional'
  );
});

test('BudgetInfo advice is array type', () => {
  assert.match(
    typesSource,
    /advice:\s*string\[\]/,
    'advice should be string array'
  );
});

test('BudgetInfo warningLevel has correct union type', () => {
  assert.match(
    typesSource,
    /['"]ok['"]\s*\|\s*['"]warning['"]\s*\|\s*['"]critical['"]/,
    'warningLevel should be ok | warning | critical'
  );
});

test('PlatformQuota status has correct union type', () => {
  assert.match(
    typesSource,
    /['"]ok['"]\s*\|\s*['"]warning['"]\s*\|\s*['"]error['"]/,
    'status should be ok | warning | error'
  );
});

test('types.ts exports all quota/budget types', () => {
  assert.match(
    typesSource,
    /export\s+interface\s+QuotaData/,
    'Should export QuotaData'
  );
  assert.match(
    typesSource,
    /export\s+interface\s+PlatformQuota/,
    'Should export PlatformQuota'
  );
  assert.match(
    typesSource,
    /export\s+interface\s+QuotaItem/,
    'Should export QuotaItem'
  );
  assert.match(
    typesSource,
    /export\s+interface\s+BudgetInfo/,
    'Should export BudgetInfo'
  );
});

test('QuotaData interfaces match structure', () => {
  assert.match(
    typesSource,
    /platforms:\s*PlatformQuota\[\]/,
    'Should have platforms array structure'
  );
  assert.match(
    typesSource,
    /quotas:\s*QuotaItem\[\]/,
    'Should have quotas array structure'
  );
});

test('BudgetInfo interface matches sendBudgetInfo output', () => {
  assert.match(
    typesSource,
    /planName.*monthlyQuota.*usedToday.*dailyAllowance/s,
    'Should have all budget fields'
  );
});

test('AppState includes core infrastructure fields', () => {
  assert.match(
    typesSource,
    /mcpServers:\s*McpServerInfo\[\]/,
    'AppState should have mcpServers array'
  );
  assert.match(
    typesSource,
    /lspServers:\s*LspServerInfo\[\]/,
    'AppState should have lspServers array'
  );
});

test('type definitions use TypeScript syntax', () => {
  assert.match(
    typesSource,
    /interface\s+\w+/,
    'Should use interface keyword'
  );
  assert.match(
    typesSource,
    /:\s*string/,
    'Should use type annotations'
  );
  assert.match(
    typesSource,
    /:\s*number/,
    'Should use number type'
  );
  assert.match(
    typesSource,
    /:\s*boolean/,
    'Should use boolean type'
  );
});

test('type names are PascalCase', () => {
  assert.match(
    typesSource,
    /interface\s+[A-Z]\w+/,
    'Interface names should be PascalCase'
  );
});

test('array types use proper syntax', () => {
  assert.match(
    typesSource,
    /\w+\[\]/,
    'Should use array syntax Type[]'
  );
});

test('union types use proper syntax', () => {
  assert.match(
    typesSource,
    /\|\s*['"]/,
    'Should use pipe for union types'
  );
});

test('optional fields use question mark', () => {
  assert.match(
    typesSource,
    /\w+\?:/,
    'Should use ? for optional fields'
  );
});
