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
    /THIS MONTH/,
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
    /case\s+['"]critical['"]:\s*return\s*['"]#ff3333['"]/, 
    'Should set critical color'
  );
  assert.match(
    indicatorBody,
    /case\s+['"]warning['"]:\s*return\s*['"]#ffaa00['"]/, 
    'Should set warning color'
  );
  assert.match(
    indicatorBody,
    /default:\s*return\s*['"]#00ff88['"]/, 
    'Should set default ok color'
  );
});

test('BudgetIndicator determines text color by warning level', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /style=\{\{\s*borderColor:\s*themeColor,\s*color:\s*themeColor\s*\}\}/,
    'Should use theme color in status badge'
  );
  assert.match(
    indicatorBody,
    /style=\{\{\s*color:\s*themeColor\s*\}\}/,
    'Should use theme color in projected value'
  );
});

test('BudgetIndicator shows warning indicators', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget\.warningLevel\s*!==\s*['"]ok['"]/, 
    'Should check non-ok levels'
  );
  assert.match(
    indicatorBody,
    /budget-status-dot/,
    'Should show status dot'
  );
  assert.match(
    indicatorBody,
    /budget\.warningLevel === 'critical' \? 'CRITICAL' : 'WARNING'/,
    'Should show warning/critical label'
  );
});

test('BudgetIndicator renders progress bar', () => {
  const indicatorBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function BudgetIndicator()'
  );

  assert.match(
    indicatorBody,
    /budget-progress-bar/,
    'Should render progress bar'
  );
  assert.match(
    indicatorBody,
    /Math\.min\(100/,
    'Should clamp at 100%'
  );
  assert.match(
    indicatorBody,
    /Math\.round\(usagePercent\)/,
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
    /warningLevel:\s*['"]ok['"]\s*\|\s*['"]warning['"]\s*\|\s*['"]critical['"]/, 
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
    /case\s+['"]critical['"]:\s*return\s*['"]#ff3333['"]/, 
    'Should set critical color'
  );
  assert.match(
    compactBody,
    /case\s+['"]warning['"]:\s*return\s*['"]#ffaa00['"]/, 
    'Should set warning color'
  );
  assert.match(
    compactBody,
    /default:\s*return\s*['"]#00ff88['"]/, 
    'Should set default ok color'
  );
});

test('CompactBudgetIndicator renders compact layout', () => {
  const compactBody = extractFunctionBody(
    budgetIndicatorSource,
    'export function CompactBudgetIndicator('
  );

  assert.match(
    compactBody,
    /compact-budget-indicator/,
    'Should render compact container'
  );
  assert.match(
    compactBody,
    /TODAY:/,
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
    /compact-progress-track/,
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
