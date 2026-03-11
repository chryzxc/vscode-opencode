/**
 * BudgetIndicator Component Tests
 *
 * Tests for BudgetIndicator component:
 * - Component structure
 * - Budget display
 * - Warning indicators
 * - Progress bar
 * - Compact variant
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const budgetIndicatorSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'BudgetIndicator.tsx')],
  'BudgetIndicator.tsx',
);

test('BudgetIndicator is exported', () => {
  assert.match(
    budgetIndicatorSource,
    /export\s+function\s+BudgetIndicator\(\)/,
    'BudgetIndicator should be exported'
  );
});

test('BudgetIndicator uses app state', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /useAppState\(\)/,
    'Should use app state'
  );
  assert.match(
    indicatorBody,
    /state\.budgetInfo/,
    'Should access budgetInfo'
  );
});

test('BudgetIndicator returns null when disabled', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /if\s*\(!budget\s*\|\|\s*!budget\.enabled\)\s*\{[\s\S]*return\s+null/,
    'Should return null when disabled'
  );
});

test('BudgetIndicator calculates usage percentage', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget\.dailyAllowance\s*>\s*0/,
    'Should check for positive allowance'
  );
  assert.match(
    indicatorBody,
    /\(budget\.usedToday\s*\/\s*budget\.dailyAllowance\)\s*\*\s*100/,
    'Should calculate percentage'
  );
});

test('BudgetIndicator displays plan name', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget\.planName/,
    'Should show plan name'
  );
});

test('BudgetIndicator displays daily usage', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget\.usedToday/,
    'Should show used today'
  );
  assert.match(
    indicatorBody,
    /budget\.dailyAllowance/,
    'Should show daily allowance'
  );
});

test('BudgetIndicator displays remaining today', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget\.remainingToday/,
    'Should show remaining'
  );
});

test('BudgetIndicator shows monthly stats', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /This Month/,
    'Should show monthly section'
  );
  assert.match(
    indicatorBody,
    /budget\.daysRemaining/,
    'Should show days remaining'
  );
  assert.match(
    indicatorBody,
    /budget\.projectedMonthlyUsage/,
    'Should show projected usage'
  );
});

test('BudgetIndicator determines bar color by warning level', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget\.warningLevel\s*===\s*['\"]critical['\"]/,
    'Should check critical level'
  );
  assert.match(
    indicatorBody,
    /bg-red-500/,
    'Should use red for critical'
  );
  assert.match(
    indicatorBody,
    /budget\.warningLevel\s*===\s*['\"]warning['\"]/,
    'Should check warning level'
  );
  assert.match(
    indicatorBody,
    /bg-yellow-500/,
    'Should use yellow for warning'
  );
  assert.match(
    indicatorBody,
    /bg-green-500/,
    'Should use green for ok'
  );
});

test('BudgetIndicator determines text color by warning level', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /text-red-500/,
    'Should use red text for critical'
  );
  assert.match(
    indicatorBody,
    /text-yellow-500/,
    'Should use yellow text for warning'
  );
  assert.match(
    indicatorBody,
    /text-green-500/,
    'Should use green text for ok'
  );
});

test('BudgetIndicator shows warning icons', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget\.warningLevel\s*!==\s*['\"]ok['\"]/,
    'Should check non-ok levels'
  );
  assert.match(
    indicatorBody,
    /⚠️/,
    'Should show warning icon'
  );
  assert.match(
    indicatorBody,
    /⚡/,
    'Should show critical icon'
  );
});

test('BudgetIndicator renders progress bar', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /h-1\.5/,
    'Should render progress bar'
  );
  assert.match(
    indicatorBody,
    /Math\.min\(100/,
    'Should clamp at 100%'
  );
  assert.match(
    indicatorBody,
    /Math\.round\(usagePercent\).*%.*used/,
    'Should show percentage'
  );
});

test('BudgetIndicator renders advice items', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget\.advice\.length\s*>\s*0/,
    'Should check for advice'
  );
  assert.match(
    indicatorBody,
    /budget\.advice\.map\(/,
    'Should map over advice'
  );
});

test('CompactBudgetIndicator is exported', () => {
  assert.match(
    budgetIndicatorSource,
    /export\s+function\s+CompactBudgetIndicator\(/,
    'CompactBudgetIndicator should be exported'
  );
});

test('CompactBudgetIndicator has correct props interface', () => {
  assert.match(
    budgetIndicatorSource,
    /interface\s+CompactBudgetIndicatorProps/,
    'Should have props interface'
  );
  assert.match(
    budgetIndicatorSource,
    /usedToday:\s*number/,
    'Should accept usedToday'
  );
  assert.match(
    budgetIndicatorSource,
    /dailyAllowance:\s*number/,
    'Should accept dailyAllowance'
  );
  assert.match(
    budgetIndicatorSource,
    /warningLevel:\s*['\"]ok['\"]\s*\|\s*['\"]warning['\"]\s*\|\s*['\"]critical['\"]/,
    'Should accept warningLevel'
  );
});

test('CompactBudgetIndicator calculates usage percentage', () => {
  const compactBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function CompactBudgetIndicator('
  );

  assert.match(
    compactBody,
    /\(usedToday\s*\/\s*dailyAllowance\)\s*\*\s*100/,
    'Should calculate percentage'
  );
});

test('CompactBudgetIndicator determines bar color', () => {
  const compactBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function CompactBudgetIndicator('
  );

  assert.match(
    compactBody,
    /warningLevel\s*===\s*['\"]critical['\"]/,
    'Should check critical'
  );
  assert.match(
    compactBody,
    /bg-red-500/,
    'Should use red for critical'
  );
  assert.match(
    compactBody,
    /bg-yellow-500/,
    'Should use yellow for warning'
  );
  assert.match(
    compactBody,
    /bg-green-500/,
    'Should use green for ok'
  );
});

test('CompactBudgetIndicator renders compact layout', () => {
  const compactBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function CompactBudgetIndicator('
  );

  assert.match(
    compactBody,
    /inline-flex/,
    'Should use inline-flex'
  );
  assert.match(
    compactBody,
    /Today:/,
    'Should show today label'
  );
  assert.match(
    compactBody,
    /\{usedToday\}/,
    'Should show used value'
  );
  assert.match(
    compactBody,
    /\{dailyAllowance\}/,
    'Should show allowance'
  );
  assert.match(
    compactBody,
    /h-1/,
    'Should render progress bar'
  );
});

test('CompactBudgetIndicator has title attribute', () => {
  const compactBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function CompactBudgetIndicator('
  );

  assert.match(
    compactBody,
    /title=/,
    'Should have title attribute'
  );
  assert.match(
    compactBody,
    /requests\s*used\s*today/,
    'Should describe usage in title'
  );
});
