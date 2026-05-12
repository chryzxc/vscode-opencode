/**
 * Implementation Plan File Persistence Tests
 *
 * Tests for the fix that ensures implementation plan files are created
 * even when a file path is provided in structured output.
 *
 * Bug: When AI provided a filePath in structured output, the code assumed
 * the file was already written to disk and skipped persistence. This test
 * verifies that file existence is checked before skipping persistence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readAllSources } from '../../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
  joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'),
  joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
], 'ChatViewProvider (Modularized)');

const structuredOutputProcessorSource = readAllSources([
  joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
], 'StructuredOutputProcessor');

test('implementation plan checks file existence before skipping persistence', () => {
  // Verify that enrichMessageWithPlan now checks if the file actually exists
  // before deciding whether to skip persistence
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // Check for file existence verification logic
  assert.match(
    enrichBody,
    /planFileExists\s*=\s*false/,
    'should initialize planFileExists flag',
  );

  assert.match(
    enrichBody,
    /vscode\.workspace\.fs\.stat\(\s*vscode\.Uri\.file\(candidate\)\s*\)/,
    'should check file existence using vscode.workspace.fs.stat',
  );

  assert.match(
    enrichBody,
    /catch\s*\{[\s\S]*planFileExists\s*=\s*false/,
    'should set planFileExists to false when stat fails (file does not exist)',
  );
});

test('implementation plan persists when file path exists but file does not exist', () => {
  // Verify the critical fix: when a file path is provided but the file
  // doesn't exist on disk, the plan should still be persisted
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // The old logic was: if (!resolvedPlanFile) { persistPlan(...) }
  // The new logic is: if (!planFileExists) { persistPlan(...) }
  assert.match(
    enrichBody,
    /if\s*\(\s*!planFileExists\s*\)\s*\{[\s\S]*persistPlan\(/,
    'should persist plan when file does not exist on disk (even if file path is provided)',
  );

  // Ensure the old broken pattern is NOT present
  assert.doesNotMatch(
    enrichBody,
    /if\s*\(\s*!resolvedPlanFile\s*\)\s*\{[\s\S]*persistPlan\(/,
    'should NOT use the old broken logic that only persisted when no file path was provided',
  );
});

test('implementation plan skips persistence when file already exists', () => {
  // Verify that persistence is skipped when the file already exists
  // (no duplicate writes)
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // The logic should be: if (!planFileExists) { persistPlan(...) }
  // which means it DOES persist when planFileExists is false
  // and DOES NOT persist when planFileExists is true
  assert.match(
    enrichBody,
    /planFileExists\s*=\s*true[\s\S]*if\s*\(\s*!planFileExists\s*\)/,
    'should check planFileExists flag and skip persistence when file exists',
  );
});

test('file-only implementation plans also check file existence', () => {
  // Verify that file-only plans (structuredResponseType === "implementation_plan" && structuredPlanFile)
  // also check file existence before skipping persistence
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // Look for the file-only plan handling section
  assert.match(
    enrichBody,
    /if\s*\(\s*structuredResponseType\s*===\s*"implementation_plan"\s*&&\s*structuredPlanFile\s*\)/,
    'should have branch for file-only implementation plans',
  );

  // Check that this branch also uses planFileExists
  assert.match(
    enrichBody,
    /if\s*\(\s*!planFileExists\s*&&\s*structuredPlanContent\s*\)\s*\{[\s\S]*persistPlan\(/,
    'file-only plans should also check file existence before persisting',
  );
});

test('enrichMessageWithPlan is async to support file system operations', () => {
  // Verify that the method signature is async
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // The function body should contain await operations
  assert.match(
    enrichBody,
    /await\s+vscode\.workspace\.fs\.stat/,
    'should await file system stat operation',
  );
});

test('plan persistence has error handling', () => {
  // Verify that persistence attempts have proper error handling
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  assert.match(
    enrichBody,
    /persistPlan\([\s\S]*?\)\.catch\(\s*\(err\s*\)\s*=>\s*\{[\s\S]*logger\.error/,
    'should catch and log persistence errors',
  );
});

test('structured plan persistence is awaited before returning a viewable plan card', () => {
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  assert.match(
    enrichBody,
    /try\s*\{[\s\S]*await\s+this\.persistPlan\([\s\S]*structuredPlanContent[\s\S]*\)[\s\S]*\}\s*catch\s*\(err\)\s*\{[\s\S]*logger\.error/,
    'should await structured plan persistence before returning the plan card',
  );

  assert.doesNotMatch(
    enrichBody,
    /this\.persistPlan\([\s\S]*structuredPlanContent[\s\S]*\)\.catch\(\(err\) => \{[\s\S]*Failed to auto-persist structured plan/,
    'should not persist structured plans in the background because View Plan can race the write',
  );
});

test('plan file existence checks use resolved workspace candidates', () => {
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  assert.match(
    enrichBody,
    /const planFileExistenceCandidates = resolvedPlanFile\s*\? this\.planManager\.resolvePlanFileCandidates\(resolvedPlanFile\)\s*:\s*\[\];/,
    'should resolve workspace-relative plan paths before checking disk existence',
  );

  assert.match(
    enrichBody,
    /for\s*\(const candidate of planFileExistenceCandidates\)\s*\{[\s\S]*vscode\.workspace\.fs\.stat\(vscode\.Uri\.file\(candidate\)\)/,
    'should stat each resolved candidate rather than only the raw plan.file string',
  );
});

test('file existence check handles missing files gracefully', () => {
  // Verify that when a file doesn't exist, the code handles it gracefully
  // and proceeds to persist the plan
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // The try-catch pattern for file existence check
  assert.match(
    enrichBody,
    /try\s*\{[\s\S]*await\s+vscode\.workspace\.fs\.stat/,
    'should wrap file existence check in try-catch',
  );

  // When stat fails, it should set planFileExists to false
  assert.match(
    enrichBody,
    /catch\s*\{[\s\S]*planFileExists\s*=\s*false/,
    'should set planFileExists to false when stat throws (file missing)',
  );
});

test('implementation plan persistence works for both structured and fallback plans', () => {
  // Verify that the fix applies to both:
  // 1. Plans with structured output (structuredPlanContent)
  // 2. Plans detected via heuristics (cleanPlanContent)
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // Check for structured plan persistence
  assert.match(
    enrichBody,
    /if\s*\(\s*!planFileExists\s*\)\s*\{[\s\S]*persistPlan\([\s\S]*structuredPlanContent/,
    'should persist structured plans when file does not exist',
  );

  // Check for fallback/plan-parser persistence
  assert.match(
    enrichBody,
    /if\s*\(\s*!extractedPlanFiles\[0\]\s*\)\s*\{[\s\S]*persistPlan\([\s\S]*cleanPlanContent/,
    'should persist heuristic-detected plans when no file path exists',
  );
});

test('implementation plan UI contract is preserved after fix', () => {
  // Verify that the fix doesn't break the plan UI contract
  const enrichBody = extractFunctionBody(
    structuredOutputProcessorSource,
    'async enrichMessageWithPlan(message: any): Promise<any>'
  );

  // Plan object should still be created with proper structure
  assert.match(
    enrichBody,
    /plan:\s*\{[\s\S]*file:\s*fallbackPlanFile[\s\S]*content:/,
    'should create plan object with file and content fields',
  );

  assert.match(
    enrichBody,
    /structuredOutput:\s*structured[\s\S]*plan:/,
    'should attach plan to both plan and structuredOutput',
  );
});
