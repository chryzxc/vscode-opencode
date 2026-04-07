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

test('ExpandableStep has proper ARIA attributes', () => {
  assert.match(
    expandableStepSource,
    /aria-expanded=/,
    'Should have aria-expanded attribute on toggle button'
  );

  assert.match(
    expandableStepSource,
    /aria-label=/,
    'Should have aria-label attribute on toggle button'
  );
});

test('ExpandableStep has dynamic aria-expanded based on state', () => {
  assert.match(
    expandableStepSource,
    /aria-expanded=\{isExpanded\}/,
    'Should bind aria-expanded to isExpanded state'
  );
});

test('ExpandableStep has descriptive aria-label', () => {
  assert.match(
    expandableStepSource,
    /Collapse.*Expand|Expand.*Collapse/,
    'Should mention both collapse and expand in aria-label'
  );
});

test('ExpandableStep toggle button has type="button"', () => {
  assert.match(
    expandableStepSource,
    /type=\s*["']button["']/,
    'Should have type="button" to prevent form submission'
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
