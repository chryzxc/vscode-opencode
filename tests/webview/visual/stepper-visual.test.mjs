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
    /oc-bash-prompt/,
    'Should have prompt class'
  );

  assert.match(
    terminalBlockSource,
    /oc-bash-copy-btn/,
    'Should have copy button class'
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

test('ExpandableStep has correct CSS classes for toggle button', () => {
  assert.match(
    expandableStepSource,
    /oc-expandable-toggle/,
    'Should have toggle button class'
  );
});

test('ExpandableStep has correct CSS classes for expanded state', () => {
  assert.match(
    expandableStepSource,
    /oc-expandable-content--expanded/,
    'Should have expanded content class'
  );
});

test('ExpandableStep has correct CSS classes for collapsed state', () => {
  assert.match(
    expandableStepSource,
    /oc-expandable-content--collapsed/,
    'Should have collapsed content class'
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
