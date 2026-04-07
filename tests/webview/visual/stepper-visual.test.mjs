import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../../helpers/source-utils.mjs';

const terminalBlockSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'TerminalBlock.tsx')],
  'TerminalBlock.tsx',
);

const expandableStepSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'ExpandableStep.tsx')],
  'ExpandableStep.tsx',
);

const stepIndicatorSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'StepIndicator.tsx')],
  'StepIndicator.tsx',
);

test('TerminalBlock has correct CSS classes', () => {
  assert.match(
    terminalBlockSource,
    /oc-bash-command-block/,
    'Should have bash command block class'
  );

  assert.match(
    terminalBlockSource,
    /oc-bash-command-code/,
    'Should have command code class'
  );

  assert.match(
    terminalBlockSource,
    /oc-bash-output/,
    'Should have output class'
  );
});

test('TerminalBlock renders command in code element', () => {
  assert.match(
    terminalBlockSource,
    /<code>/,
    'Should render command in code element'
  );
});

test('ExpandableStep has correct CSS classes for wrapper', () => {
  assert.match(
    expandableStepSource,
    /oc-expandable-step/,
    'Should have expandable step wrapper class'
  );
});

test('ExpandableStep is a forwardRef component', () => {
  assert.match(
    expandableStepSource,
    /React\.forwardRef/,
    'Should be a forwardRef component'
  );
});

test('ExpandableStep accepts children prop', () => {
  assert.match(
    expandableStepSource,
    /children.*React\.ReactNode|React\.ReactNode.*children/,
    'Should accept children prop'
  );
});

test('StepIndicator applies status-specific classes', () => {
  assert.match(
    stepIndicatorSource,
    /oc-step-indicator--\$\{status\}/,
    'Should apply status-specific class using template literal'
  );

  assert.match(
    stepIndicatorSource,
    /oc-step-indicator-done/,
    'Should have done status class referenced'
  );

  assert.match(
    stepIndicatorSource,
    /oc-step-indicator-error/,
    'Should have error status class referenced'
  );

  assert.match(
    stepIndicatorSource,
    /oc-step-indicator-pending/,
    'Should have pending status class referenced'
  );

  assert.match(
    stepIndicatorSource,
    /oc-step-indicator-running/,
    'Should have running status class referenced'
  );

  assert.match(
    stepIndicatorSource,
    /oc-step-indicator"/,
    'Should have base step indicator class'
  );
});

test('StepIndicator has animated classes', () => {
  assert.match(
    stepIndicatorSource,
    /animate-pulse/,
    'Should have pulse animation for pending state'
  );

  assert.match(
    stepIndicatorSource,
    /animate-spin/,
    'Should have spin animation for running state'
  );
});
