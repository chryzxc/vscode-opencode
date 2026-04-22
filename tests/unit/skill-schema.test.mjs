import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const schemaSource = readSource(
  [joinFromRoot('src', 'services', 'skillSchema.ts')],
  'skillSchema.ts',
);

test('skillSchema: exports JSON Schema object for skill validation', () => {
  assert.match(schemaSource, /export\s+const\s+skillSchema/, 'should export skillSchema');
  assert.match(schemaSource, /type:\s*['"]object['"]/, 'schema should be object type');
  assert.match(schemaSource, /additionalProperties:\s*false/, 'schema should disallow additional properties');
});

test('skillSchema: requires core fields', () => {
  assert.match(
    schemaSource,
    /required:\s*\[['"]name['"],\s*['"]displayName['"],\s*['"]version['"],\s*['"]description['"],\s*['"]installedAt['"],\s*['"]installedFrom['"],\s*['"]lastUpdated['"]\]/,
    'schema should require name, displayName, version, description, installedAt, installedFrom, lastUpdated',
  );
});

test('skillSchema: name field constraints', () => {
  assert.match(schemaSource, /name:\s*\{[^}]*type:\s*['"]string['"]/, 'name should be string');
  assert.match(schemaSource, /pattern:\s*['"]\^\\?\[a-z0-9-\]\+\\?\$['"]/, 'name should have pattern constraint');
  assert.match(schemaSource, /minLength:\s*1/, 'name should have minLength');
  assert.match(schemaSource, /maxLength:\s*50/, 'name should have maxLength');
});

test('skillSchema: version field uses semver pattern', () => {
  assert.match(schemaSource, /version:\s*\{[^}]*pattern:/s, 'version should have pattern');
  assert.match(schemaSource, /\^\\\\d\+\\\\\.\\\\d\+\\\\\.\\\\d\+/, 'version pattern should match semver format');
});

test('skillSchema: description field has length bounds', () => {
  assert.match(schemaSource, /description:\s*\{[^}]*minLength:\s*1/s, 'description should have minLength 1');
  assert.match(schemaSource, /description:\s*\{[^}]*maxLength:\s*500/s, 'description should have maxLength 500');
});

test('skillSchema: optional metadata fields', () => {
  const optionalFields = ['agent', 'model', 'template', 'subtask', 'author', 'license'];
  for (const field of optionalFields) {
    assert.match(schemaSource, new RegExp(`${field}:\\s*\\{[^}]*type:`), `should define ${field} property`);
  }
});

test('skillSchema: URI fields use format: uri', () => {
  assert.match(schemaSource, /homepage:\s*\{[^}]*format:\s*['"]uri['"]/s, 'homepage should use uri format');
  assert.match(schemaSource, /repository:\s*\{[^}]*format:\s*['"]uri['"]/s, 'repository should use uri format');
});

test('skillSchema: timestamp fields use format: date-time', () => {
  assert.match(schemaSource, /installedAt:\s*\{[^}]*format:\s*['"]date-time['"]/s, 'installedAt should use date-time format');
  assert.match(schemaSource, /lastUpdated:\s*\{[^}]*format:\s*['"]date-time['"]/s, 'lastUpdated should use date-time format');
});

test('skillSchema: dependencies is nested object with skills array and minVersion', () => {
  assert.match(schemaSource, /dependencies:\s*\{/, 'should define dependencies');
  assert.match(schemaSource, /skills:\s*\{\s*type:\s*['"]array['"]/, 'dependencies should have skills array');
  assert.match(schemaSource, /minVersion:\s*\{\s*type:\s*['"]string['"]/, 'dependencies should have minVersion string');
});
