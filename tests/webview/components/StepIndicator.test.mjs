import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const stepIndicatorSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'StepIndicator.tsx')],
  'StepIndicator.tsx',
);

test('StepIndicator component exists and is exported', () => {
  assert.match(
    stepIndicatorSource,
    /export\s+const\s+StepIndicator/,
    'StepIndicator should be exported'
  );
});

test('StepIndicator has correct props interface', () => {
  assert.match(
    stepIndicatorSource,
    /export\s+interface\s+StepIndicatorProps/,
    'Should have StepIndicatorProps interface'
  );

  assert.match(
    stepIndicatorSource,
    /status:\s*['"]pending['"]\s*\|\s*['"]done['"]\s*\|\s*['"]error['"]\s*\|\s*['"]running['"]/,
    'Should have status prop with correct union type'
  );

  assert.match(
    stepIndicatorSource,
    /className\?:\s*string/,
    'Should have optional className prop'
  );
});

test('StepIndicator uses React.forwardRef', () => {
  assert.match(
    stepIndicatorSource,
    /React\.forwardRef/,
    'Should use React.forwardRef for ref forwarding'
  );
});

test('StepIndicator renders check icon for done status', () => {
  assert.match(
    stepIndicatorSource,
    /case\s+['"]done['"][:\s]+.*?<Check/m,
    'Should render Check icon for done status'
  );
});

test('StepIndicator renders X icon for error status', () => {
  assert.match(
    stepIndicatorSource,
    /case\s+['"]error['"][:\s]+.*?<X/m,
    'Should render X icon for error status'
  );
});

test('StepIndicator renders animated pulse for pending status', () => {
  assert.match(
    stepIndicatorSource,
    /case\s+['"]pending['"][:\s]+.*?oc-step-indicator-pending.*?animate-pulse/ms,
    'Should render pending indicator with pulse animation'
  );
});

test('StepIndicator renders loader for running status', () => {
  assert.match(
    stepIndicatorSource,
    /case\s+['"]running['"][:\s]+.*?<Loader2/m,
    'Should render Loader2 icon for running status'
  );
});

test('StepIndicator has correct accessibility attributes', () => {
  assert.match(
    stepIndicatorSource,
    /aria-label=/,
    'Should have aria-label attribute'
  );

  assert.match(
    stepIndicatorSource,
    /role=["']status["']/,
    'Should have role="status"'
  );
});

test('StepIndicator uses cn utility for className merging', () => {
  assert.match(
    stepIndicatorSource,
    /cn\(\s*["']oc-step-indicator["']\s*,\s*[`']oc-step-indicator--\$\{status\}[`']\s*,\s*className\s*\)/,
    'Should use cn utility to merge class names'
  );
});

test('StepIndicator has displayName', () => {
  assert.match(
    stepIndicatorSource,
    /StepIndicator\.displayName\s*=\s*["']StepIndicator["']/,
    'Should have displayName for better debugging'
  );
});

test('StepIndicator imports required icons from lucide-react', () => {
  assert.match(
    stepIndicatorSource,
    /import\s+.*?\{[^}]*Check[^}]*\}\s+from\s+['"]lucide-react['"]/,
    'Should import Check icon from lucide-react'
  );

  assert.match(
    stepIndicatorSource,
    /import\s+.*?\{[^}]*X[^}]*\}\s+from\s+['"]lucide-react['"]/,
    'Should import X icon from lucide-react'
  );

  assert.match(
    stepIndicatorSource,
    /import\s+.*?\{[^}]*Loader2[^}]*\}\s+from\s+['"]lucide-react['"]/,
    'Should import Loader2 icon from lucide-react'
  );
});

test('StepIndicator has proper structure with wrapper div', () => {
  assert.match(
    stepIndicatorSource,
    /<div\s+ref=\{ref\}\s+className=/,
    'Should have wrapper div with ref and className'
  );
});

test('StepIndicator has proper CSS classes for each status', () => {
  assert.match(
    stepIndicatorSource,
    /oc-step-indicator-done/,
    'Should have done CSS class'
  );

  assert.match(
    stepIndicatorSource,
    /oc-step-indicator-error/,
    'Should have error CSS class'
  );

  assert.match(
    stepIndicatorSource,
    /oc-step-indicator-running/,
    'Should have running CSS class'
  );

  assert.match(
    stepIndicatorSource,
    /oc-step-indicator-pending/,
    'Should have pending CSS class'
  );
});

test('StepIndicator handles all status cases', () => {
  const body = extractFunctionBody(stepIndicatorSource, 'const renderIndicator = () => {');
  assert.ok(body.includes('pending'), 'Should handle pending status');
  assert.ok(body.includes('done'), 'Should handle done status');
  assert.ok(body.includes('error'), 'Should handle error status');
  assert.ok(body.includes('running'), 'Should handle running status');
});
