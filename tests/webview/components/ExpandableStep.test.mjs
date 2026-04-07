import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const expandableStepSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'ui', 'ExpandableStep.tsx')],
  'ExpandableStep.tsx',
);

test('ExpandableStep component exists and is exported', () => {
  assert.match(
    expandableStepSource,
    /export\s+const\s+ExpandableStep/,
    'ExpandableStep should be exported'
  );
});

test('ExpandableStep has correct props interface', () => {
  assert.match(
    expandableStepSource,
    /export\s+interface\s+ExpandableStepProps/,
    'Should have ExpandableStepProps interface'
  );

  assert.match(
    expandableStepSource,
    /children:\s*React\.ReactNode/,
    'Should have children prop of type React.ReactNode'
  );

  assert.match(
    expandableStepSource,
    /className\?:\s*string/,
    'Should have optional className prop'
  );
});

test('ExpandableStep uses React.forwardRef', () => {
  assert.match(
    expandableStepSource,
    /React\.forwardRef/,
    'Should use React.forwardRef for ref forwarding'
  );
});

test('ExpandableStep has toggle button', () => {
  assert.match(
    expandableStepSource,
    /oc-expandable-toggle/,
    'Should have toggle button class'
  );
});

test('ExpandableStep has chevron icons', () => {
  assert.match(
    expandableStepSource,
    /ChevronDown/,
    'Should have ChevronDown icon for expanded state'
  );

  assert.match(
    expandableStepSource,
    /ChevronRight/,
    'Should have ChevronRight icon for collapsed state'
  );
});

test('ExpandableStep has expand/collapse state', () => {
  assert.match(
    expandableStepSource,
    /isExpanded/,
    'Should have isExpanded state'
  );

  assert.match(
    expandableStepSource,
    /oc-expandable-content--expanded/,
    'Should have expanded state class'
  );

  assert.match(
    expandableStepSource,
    /oc-expandable-content--collapsed/,
    'Should have collapsed state class'
  );
});

test('ExpandableStep renders correct structure', () => {
  assert.match(
    expandableStepSource,
    /oc-expandable-content/,
    'Should have content container'
  );
});

test('ExpandableStep has displayName', () => {
  assert.match(
    expandableStepSource,
    /ExpandableStep\.displayName\s*=\s*["']ExpandableStep["']/,
    'Should have displayName for better debugging'
  );
});

test('ExpandableStep uses cn utility for className merging', () => {
  assert.match(
    expandableStepSource,
    /cn\(\s*["']oc-expandable-step["']\s*,\s*className\s*\)/,
    'Should use cn utility to merge class names'
  );
});
