import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'types', 'Plan.ts')],
  'Plan.ts',
);

test('Plan types: exports PlanFile interface', () => {
  assert.match(source, /export\s+interface\s+PlanFile/, 'should export PlanFile interface');
  assert.match(source, /path:\s*string/, 'PlanFile should require path');
  assert.match(source, /type:\s*['"]MODIFY['"]\s*\|\s*['"]NEW['"]\s*\|\s*['"]DELETE['"]/, 'PlanFile should have type union');
  assert.match(source, /summary\?:\s*string/, 'PlanFile should have optional summary');
});

test('Plan types: exports PlanStep interface', () => {
  assert.match(source, /export\s+interface\s+PlanStep/, 'should export PlanStep interface');
  assert.match(source, /title:\s*string/, 'PlanStep should require title');
  assert.match(source, /description\?:\s*string/, 'PlanStep should have optional description');
  assert.match(source, /completed:\s*boolean/, 'PlanStep should require completed');
});

test('Plan types: exports VerificationStep interface', () => {
  assert.match(source, /export\s+interface\s+VerificationStep/, 'should export VerificationStep interface');
  assert.match(source, /type:\s*['"]Automated['"]\s*\|\s*['"]Manual['"]/, 'VerificationStep should have type union');
  assert.match(source, /description:\s*string/, 'VerificationStep should require description');
});

test('Plan types: exports ImplementationPlan interface', () => {
  assert.match(source, /export\s+interface\s+ImplementationPlan/, 'should export ImplementationPlan interface');
  assert.match(source, /goal:\s*string/, 'ImplementationPlan should require goal');
  assert.match(source, /description\?:\s*string/, 'ImplementationPlan should have optional description');
  assert.match(source, /files:\s*PlanFile\[\]/, 'ImplementationPlan should require files array');
  assert.match(source, /steps:\s*PlanStep\[\]/, 'ImplementationPlan should require steps array');
  assert.match(source, /verification:\s*VerificationStep\[\]/, 'ImplementationPlan should require verification array');
  assert.match(source, /rawContent:\s*string/, 'ImplementationPlan should require rawContent');
});
