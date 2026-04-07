import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../../helpers/source-utils.mjs';

const expandableStepSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'ExpandableStep.tsx')],
  'ExpandableStep.tsx',
);

const stepIndicatorSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'StepIndicator.tsx')],
  'StepIndicator.tsx',
);

test('ExpandableStep is a wrapper component', () => {
  assert.match(
    expandableStepSource,
    /React\.forwardRef/,
    'Should be a forwardRef component for proper ref forwarding'
  );

  assert.match(
    expandableStepSource,
    /oc-expandable-step/,
    'Should apply proper CSS class for styling'
  );

  assert.match(
    expandableStepSource,
    /children/,
    'Should render children prop'
  );
});

test('ExpandableStep allows className customization', () => {
  assert.match(
    expandableStepSource,
    /className/,
    'Should accept className prop'
  );

  assert.match(
    expandableStepSource,
    /cn\(/,
    'Should use cn utility for class merging'
  );
});

test('ExpandableStep has TypeScript types', () => {
  assert.match(
    expandableStepSource,
    /ExpandableStepProps/,
    'Should export ExpandableStepProps interface'
  );

  assert.match(
    expandableStepSource,
    /React\.ReactNode/,
    'Should type children as React.ReactNode'
  );
});

test('StepIndicator has aria-label', () => {
  assert.match(
    stepIndicatorSource,
    /aria-label=/,
    'Should have aria-label attribute'
  );

  assert.match(
    stepIndicatorSource,
    /Step status.*\$\{status\}|status.*Step/,
    'Should mention status in aria-label'
  );
});

test('StepIndicator has role="status"', () => {
  assert.match(
    stepIndicatorSource,
    /role=\s*["']status["']/,
    'Should have role="status" for screen readers'
  );
});

test('StepIndicator aria-label is dynamic based on status', () => {
  assert.match(
    stepIndicatorSource,
    /\$\{status\}/,
    'Should include status variable in aria-label'
  );
});
