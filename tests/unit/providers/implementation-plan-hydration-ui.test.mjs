/**
 * Implementation Plan Hydration UI Tests
 *
 * Tests for the fix that ensures implementation plan UI is rendered correctly
 * when messages are loaded from storage (hydration).
 *
 * Bug: When messages were hydrated from storage, the implementation plan UI was not
 * showing even though the message had a plan field and was an implementation_plan type.
 * This happened because the code was removing the plan field during hydration if
 * the structured output recognition failed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../../helpers/source-utils.mjs';

const structuredOutputProcessorSource = readAllSources([
  joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
], 'StructuredOutputProcessor');

test.skip('implementation plan preserves valid plan during hydration when structured output fails', () => {
  // Verify that enrichMessageWithPlan preserves valid plan fields during hydration
  // even when structured output recognition fails
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // Check for the logic that preserves valid plans
  assert.match(
    enrichBody,
    /if\s*\(\s*structuredResponseType\s*!==\s*"implementation_plan"\s*\)\s*\{[\s\S]*if\s*\(\s*message\.plan\s*\)\s*\{[\s\S]*hasValidPlanFields[\s\S]*return\s+message/,
    'should preserve existing valid plan when structuredResponseType is not implementation_plan',
  );
});

test.skip('implementation plan validation checks for plan file or content', () => {
  // Verify that the plan validation checks for essential plan fields
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  assert.match(
    enrichBody,
    /hasValidPlanFields[\s\S]*firstNonEmptyString\(planRec\?\.file\)[\s\S]*firstNonEmptyString\(planRec\?\.content\)/,
    'should check for plan file or content field',
  );

  assert.match(
    enrichBody,
    /hasValidPlanFields[\s\S]*firstNonEmptyString\(planRec\?\.title\)[\s\S]*firstNonEmptyString\(planRec\?\.summary\)/,
    'should check for plan title or summary field',
  );
});

test.skip('implementation plan removes invalid plan objects', () => {
  // Verify that invalid plan objects (missing essential fields) are removed
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // Check that the logic for handling invalid plans exists
  assert.match(
    enrichBody,
    /hasValidPlanFields/,
    'should check if plan fields are valid',
  );

  assert.match(
    enrichBody,
    /Remove invalid plan objects/,
    'should have comment about removing invalid plan objects',
  );

  assert.match(
    enrichBody,
    /delete\s+nextMessage\.plan/,
    'should remove invalid plan objects',
  );
});

test.skip('implementation plan hydration preserves plan structure', () => {
  // Verify that the overall structure of plan enrichment is preserved
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // Check that the main plan enrichment logic still exists
  assert.match(
    enrichBody,
    /if\s*\(\s*hasPlanFile\s*\|\|\s*hasPlanKeywords\s*\)/,
    'should still detect plans from files or keywords',
  );

  assert.match(
    enrichBody,
    /plan:\s*\{[\s\S]*file:[\s\S]*content:/,
    'should still create plan objects with file and content fields',
  );
});

test.skip('implementation plan UI contract uses responseType check', () => {
  // Verify that the UI contract for implementation plans is based on responseType
  const messageComponentsSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
    'MessageComponents.tsx',
  );

  // Check that the UI looks for responseType === "implementation_plan"
  assert.match(
    messageComponentsSource,
    /responseType\s*===\s*"implementation_plan"\s*\?\s*message\?\.plan\s*:\s*undefined/,
    'UI should check for responseType === "implementation_plan" to display plan',
  );

  // Check that responseType is extracted from the correct locations
  assert.match(
    messageComponentsSource,
    /const\s+responseType\s*=\s*firstNonEmptyString\([\s\S]*message\?\.responseType[\s\S]*structured\?\.responseType/,
    'UI should extract responseType from message or structuredOutput',
  );
});

test.skip('implementation plan preserves structured output during persistence', () => {
  // Verify that the persistence layer preserves the structured output field
  const sessionServiceSource = readSource(
    [joinFromRoot('src', 'services', 'SessionService.ts')],
    'SessionService.ts',
  );

  // Check that sanitizeForPersistence preserves object keys
  assert.match(
    sessionServiceSource,
    /function\s+sanitizeForPersistence[\s\S]*result\[key\]\s*=\s*sanitizeForPersistence/,
    'sanitizeForPersistence should recursively preserve all object keys',
  );
});
