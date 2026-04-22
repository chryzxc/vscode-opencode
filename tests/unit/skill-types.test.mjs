import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'services', 'skillTypes.ts')],
  'skillTypes.ts',
);

test('skillTypes: exports SkillDefinition interface', () => {
  assert.match(source, /export\s+interface\s+SkillDefinition/, 'should export SkillDefinition');
  const requiredFields = ['name', 'displayName', 'version', 'description', 'installedAt', 'installedFrom', 'lastUpdated'];
  for (const field of requiredFields) {
    assert.match(source, new RegExp(`${field}:\\s*string`), `SkillDefinition should require ${field}`);
  }
});

test('skillTypes: SkillDefinition has optional agent/model/template/subtask fields', () => {
  const optionalFields = ['agent', 'model', 'template', 'author', 'homepage', 'repository', 'license'];
  for (const field of optionalFields) {
    assert.match(source, new RegExp(`${field}\\?:\\s*string`), `SkillDefinition should have optional ${field}`);
  }
  assert.match(source, /subtask\?:\s*boolean/, 'SkillDefinition should have optional subtask');
});

test('skillTypes: SkillDefinition has optional dependencies with skills array', () => {
  assert.match(source, /dependencies\?:\s*\{/, 'SkillDefinition should have optional dependencies');
  assert.match(source, /skills\?:\s*string\[\]/, 'dependencies should have optional skills array');
  assert.match(source, /minVersion\?:\s*string/, 'dependencies should have optional minVersion');
});

test('skillTypes: exports SkillsMetadata interface', () => {
  assert.match(source, /export\s+interface\s+SkillsMetadata/, 'should export SkillsMetadata');
  assert.match(source, /version:\s*number/, 'SkillsMetadata should require version');
  assert.match(source, /skills:\s*\{/, 'SkillsMetadata should require skills object');
  assert.match(source, /settings:\s*\{/, 'SkillsMetadata should require settings');
  assert.match(source, /autoUpdate:\s*boolean/, 'settings should have autoUpdate');
  assert.match(source, /updateCheckInterval:\s*number/, 'settings should have updateCheckInterval');
});

test('skillTypes: SkillsMetadata skills entries have path/version/timestamps', () => {
  assert.match(source, /\[skillName:\s*string\]:\s*\{/, 'skills should be indexed by skillName');
  assert.match(source, /path:\s*string/, 'skill entry should have path');
  assert.match(source, /version:\s*string/, 'skill entry should have version');
  assert.match(source, /installedAt:\s*string/, 'skill entry should have installedAt');
  assert.match(source, /installedFrom:\s*string/, 'skill entry should have installedFrom');
  assert.match(source, /lastChecked:\s*string/, 'skill entry should have lastChecked');
  assert.match(source, /hash\?:\s*string/, 'skill entry should have optional hash');
});

test('skillTypes: exports InstallResult interface', () => {
  assert.match(source, /export\s+interface\s+InstallResult/, 'should export InstallResult');
  assert.match(source, /success:\s*boolean/, 'InstallResult should require success');
  assert.match(source, /skill\?:\s*SkillDefinition/, 'InstallResult should have optional skill');
  assert.match(source, /error\?:\s*string/, 'InstallResult should have optional error');
  assert.match(source, /details\?:\s*Array\s*<\s*\{/, 'InstallResult should have optional details');
});

test('skillTypes: exports ProgressUpdate interface', () => {
  assert.match(source, /export\s+interface\s+ProgressUpdate/, 'should export ProgressUpdate');
  assert.match(source, /stage:\s*['"]downloading['"]\s*\|/, 'ProgressUpdate should have stage union type');
  assert.match(source, /percent:\s*number/, 'ProgressUpdate should require percent');
  assert.match(source, /message:\s*string/, 'ProgressUpdate should require message');
});

test('skillTypes: exports ValidationResult interface', () => {
  assert.match(source, /export\s+interface\s+ValidationResult/, 'should export ValidationResult');
  assert.match(source, /valid:\s*boolean/, 'ValidationResult should require valid');
  assert.match(source, /errors\?:\s*Array\s*<\s*\{/, 'ValidationResult should have optional errors');
});
