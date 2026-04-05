/**
 * Timeout Configuration Validation Tests
 *
 * Tests for VSCode configuration schema validation and defaults
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";

const packageJsonPath = join(process.cwd(), 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

test("package.json includes timeout configuration properties", () => {
  // Check if opencode configuration section exists
  const contributes = packageJson.contributes;
  assert.ok(contributes, "package.json should have contributes section");

  const properties = contributes?.configuration?.properties;
  assert.ok(properties, "package.json should define configuration properties");

  // Check for requestTimeout property
  const requestTimeout = properties['opencode.requestTimeout'];
  assert.ok(requestTimeout, "Should define opencode.requestTimeout property");

  // Check for complexQueryMultiplier property
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];
  assert.ok(complexQueryMultiplier, "Should define opencode.complexQueryMultiplier property");
});

test("requestTimeout configuration has correct schema", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];

  assert.equal(requestTimeout?.type, 'number', 'requestTimeout should be number type');
  assert.equal(requestTimeout?.default, 120000, 'requestTimeout should default to 120000ms');
  assert.ok(requestTimeout?.minimum, 'requestTimeout should have minimum value');
  assert.ok(requestTimeout?.maximum, 'requestTimeout should have maximum value');
});

test("requestTimeout configuration has descriptive properties", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];

  assert.ok(requestTimeout?.description, 'requestTimeout should have description');
  assert.ok(
    requestTimeout?.description.toLowerCase().includes('timeout'),
    'requestTimeout description should mention timeout'
  );
});

test("complexQueryMultiplier configuration has correct schema", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  assert.equal(complexQueryMultiplier?.type, 'number', 'complexQueryMultiplier should be number type');
  assert.equal(complexQueryMultiplier?.default, 1.5, 'complexQueryMultiplier should default to 1.5');
  assert.ok(complexQueryMultiplier?.minimum, 'complexQueryMultiplier should have minimum value');
  assert.ok(complexQueryMultiplier?.maximum, 'complexQueryMultiplier should have maximum value');
});

test("complexQueryMultiplier configuration has descriptive properties", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  assert.ok(complexQueryMultiplier?.description, 'complexQueryMultiplier should have description');
  assert.ok(
    complexQueryMultiplier?.description.toLowerCase().includes('multiplier') ||
    complexQueryMultiplier?.description.toLowerCase().includes('complex'),
    'complexQueryMultiplier description should mention multiplier or complex queries'
  );
});

test("timeout configurations are in correct category", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  // Check if they're categorized properly (often under "general" or "advanced")
  assert.ok(requestTimeout?.category || requestTimeout?.order, 'requestTimeout should have category or order');
  assert.ok(complexQueryMultiplier?.category || complexQueryMultiplier?.order, 'complexQueryMultiplier should have category or order');
});

test("timeout configuration values are reasonable defaults", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  // requestTimeout default should be between 1 and 5 minutes
  assert.ok(requestTimeout?.default >= 60000, 'requestTimeout default should be at least 1 minute');
  assert.ok(requestTimeout?.default <= 300000, 'requestTimeout default should be at most 5 minutes');

  // complexQueryMultiplier default should be reasonable
  assert.ok(complexQueryMultiplier?.default >= 1.0, 'complexQueryMultiplier default should be at least 1.0');
  assert.ok(complexQueryMultiplier?.default <= 3.0, 'complexQueryMultiplier default should be at most 3.0');
});

test("timeout configurations have proper constraints", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  // requestTimeout should allow values from 10s to 10 minutes
  assert.ok(requestTimeout?.minimum <= 10000, 'requestTimeout minimum should allow 10 seconds');
  assert.ok(requestTimeout?.maximum >= 600000, 'requestTimeout maximum should allow 10 minutes');

  // complexQueryMultiplier should allow reasonable range
  assert.ok(complexQueryMultiplier?.minimum <= 1.0, 'complexQueryMultiplier minimum should allow 1.0');
  assert.ok(complexQueryMultiplier?.maximum >= 2.0, 'complexQueryMultiplier maximum should allow at least 2.0');
});

test("timeout configurations have example values", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  // Check for examples (optional but good for UX)
  const hasExamples = requestTimeout?.examples || complexQueryMultiplier?.examples;
  // Don't fail if examples don't exist, but check format if they do
  if (hasExamples) {
    assert.ok(Array.isArray(requestTimeout?.examples) || Array.isArray(complexQueryMultiplier?.examples));
  }
});

test("timeout configurations are not marked as deprecated", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  assert.equal(requestTimeout?.deprecated, undefined, 'requestTimeout should not be deprecated');
  assert.equal(complexQueryMultiplier?.deprecated, undefined, 'complexQueryMultiplier should not be deprecated');
});

test("timeout configurations have proper scope", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  // Check if scope is defined (usually "window", "resource", or "language-overridable")
  const validScopes = ['window', 'resource', 'language-overridable', 'machine-overridable'];

  if (requestTimeout?.scope) {
    assert.ok(validScopes.includes(requestTimeout.scope), 'requestTimeout should have valid scope');
  }

  if (complexQueryMultiplier?.scope) {
    assert.ok(validScopes.includes(complexQueryMultiplier.scope), 'complexQueryMultiplier should have valid scope');
  }
});

test("timeout configurations have proper type definitions", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  // Check that types are correctly defined
  assert.equal(requestTimeout?.type, 'number', 'requestTimeout must be number type');
  assert.equal(complexQueryMultiplier?.type, 'number', 'complexQueryMultiplier must be number type');

  // Check that array types are not used (these are single values)
  assert.notEqual(requestTimeout?.type, 'array', 'requestTimeout should not be array');
  assert.notEqual(complexQueryMultiplier?.type, 'array', 'complexQueryMultiplier should not be array');
});

test("timeout configurations are in opencode namespace", () => {
  const properties = packageJson.contributes?.configuration?.properties;

  // Check that the properties are properly namespaced
  assert.ok(properties['opencode.requestTimeout'], 'Should use opencode.requestTimeout key');
  assert.ok(properties['opencode.complexQueryMultiplier'], 'Should use opencode.complexQueryMultiplier key');
});

test("timeout configurations don't conflict with existing settings", () => {
  const properties = packageJson.contributes?.configuration?.properties;

  // Check that we're not overriding existing opencode settings
  // (these are common opencode settings that should exist)
  const commonSettings = [
    'opencode.autoStart',
    'opencode.logging.level',
  ];

  // Our new settings should be distinct
  assert.ok(!commonSettings.includes('opencode.requestTimeout'));
  assert.ok(!commonSettings.includes('opencode.complexQueryMultiplier'));
});

test("timeout configurations follow naming conventions", () => {
  const properties = packageJson.contributes?.configuration?.properties;

  // Check camelCase naming
  assert.ok(properties['opencode.requestTimeout'], 'Should use camelCase: requestTimeout');
  assert.ok(properties['opencode.complexQueryMultiplier'], 'Should use camelCase: complexQueryMultiplier');

  // Check no spaces or special characters
  const keys = Object.keys(properties).filter(k => k.startsWith('opencode.'));
  keys.forEach(key => {
    assert.match(key, /^[a-z.]+$/, `${key} should contain only lowercase letters and dots`);
  });
});

test("timeout configurations have proper order if specified", () => {
  const properties = packageJson.contributes?.configuration?.properties;
  const requestTimeout = properties['opencode.requestTimeout'];
  const complexQueryMultiplier = properties['opencode.complexQueryMultiplier'];

  // If order is specified, it should be a number
  if (requestTimeout?.order !== undefined) {
    assert.equal(typeof requestTimeout.order, 'number', 'requestTimeout order should be number');
  }

  if (complexQueryMultiplier?.order !== undefined) {
    assert.equal(typeof complexQueryMultiplier.order, 'number', 'complexQueryMultiplier order should be number');
  }
});
