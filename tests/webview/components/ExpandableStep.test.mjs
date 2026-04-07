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
    'Should have ExpandableProps interface'
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

  // Check that removed props don't exist
  const hasIsImportant = expandableStepSource.includes('isImportant');
  const hasDefaultExpanded = expandableStepSource.includes('defaultExpanded');
  assert.equal(hasIsImportant || hasDefaultExpanded, false, 'Should NOT have isImportant or defaultExpanded props (removed)');
});

test('ExpandableStep uses React.forwardRef', () => {
  assert.match(
    expandableStepSource,
    /React\.forwardRef/,
    'Should use React.forwardRef for ref forwarding'
  );
});

test('ExpandableStep does NOT have toggle button', () => {
  const match = expandableStepSource.match(/oc-expandable-toggle/);
  assert.equal(match, null, 'Should NOT have toggle button class');
});

test('ExpandableStep does NOT have chevron icons', () => {
  const match = expandableStepSource.match(/ChevronDown|ChevronRight/);
  assert.equal(match, null, 'Should NOT have chevron icons');
});

test('ExpandableStep does NOT have collapse state', () => {
  const match1 = expandableStepSource.match(/isExpanded|setIsExpanded/);
  const match2 = expandableStepSource.match(/oc-expandable-content--expanded|oc-expandable-content--collapsed/);
  assert.equal(match1, null, 'Should NOT have isExpanded state');
  assert.equal(match2, null, 'Should NOT have expanded/collapsed classes');
});

test('ExpandableStep renders correct structure', () => {
  assert.match(
    expandableStepSource,
    /oc-expandable-step/,
    'Should have expandable-step container class'
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
