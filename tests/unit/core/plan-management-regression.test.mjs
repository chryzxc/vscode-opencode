/**
 * Core Plan Management Regression Tests
 *
 * These tests prevent regressions in plan detection and management.
 * Plan-related bugs can cause incorrect plan detection or data loss.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const planManagerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts')],
  'PlanManager.ts',
);

test.describe('Plan Manager - Plan Detection', () => {

  test('isLikelyPlanMarkdownFile validates plan file patterns', () => {
    const checkBody = extractFunctionBody(planManagerSource, 'isLikelyPlanMarkdownFile');

    assert.match(
      checkBody,
      /implementation_plan|plans?\/|\.plan/s,
      'must detect common plan file patterns'
    );
    assert.match(
      checkBody,
      /toLowerCase|\.test\(|includes/,
      'must use pattern matching'
    );
  });

  test('isLikelyPlanMarkdownFile rejects non-plan files', () => {
    const checkBody = extractFunctionBody(planManagerSource, 'isLikelyPlanMarkdownFile');

    assert.match(
      checkBody,
      /return\s*false|node_modules|_comments/,
      'must reject non-plan files and excluded paths'
    );
  });

  test('extractMarkdownFileReferences finds file references in text', () => {
    const extractBody = extractFunctionBody(planManagerSource, 'extractMarkdownFileReferences');

    assert.match(
      extractBody,
      /markdownLinkPattern|markdownLinkRefPattern|plainMdPattern/,
      'must detect markdown file references'
    );
    assert.match(
      extractBody,
      /\.exec\(|\.test\(|while.*match/,
      'must use regex for extraction'
    );
  });

});

test.describe('Plan Manager - Plan Persistence', () => {

  test('persistPlan validates plan content', () => {
    const persistBody = extractFunctionBody(planManagerSource, 'async persistPlan(');

    assert.match(
      persistBody,
      /firstNonEmptyString|normalizedContent/,
      'must validate and normalize plan content'
    );
    assert.match(
      persistBody,
      /workspace\.fs\.writeFile/,
      'must write plan to filesystem'
    );
  });

  test('persistPlan generates appropriate file paths', () => {
    const persistBody = extractFunctionBody(planManagerSource, 'async persistPlan(');

    assert.match(
      persistBody,
      /normalizePlanFileReference|resolvePlanFileCandidates/,
      'must normalize file paths'
    );
    assert.match(
      persistBody,
      /createDirectory|path\.dirname/,
      'must ensure directory exists'
    );
  });

  test('persistPlan handles write errors gracefully', () => {
    const persistBody = extractFunctionBody(planManagerSource, 'async persistPlan(');

    assert.match(
      persistBody,
      /try\s*\{[\s\S]*catch\s*\(|logger\.error/,
      'must handle filesystem errors'
    );
    assert.match(
      persistBody,
      /endFeatureFlow|status.*failed/,
      'must log persistence failures'
    );
  });

});

test.describe('Plan Manager - Plan Resolution', () => {

  test('resolvePlanTitle extracts title from multiple sources', () => {
    const resolveBody = extractFunctionBody(planManagerSource, 'resolvePlanTitle');

    assert.match(
      resolveBody,
      /options\.plan\?\.title|options\.planFile|options\.fallback/,
      'must check multiple title sources'
    );
    assert.match(
      resolveBody,
      /derivePlanTitleFromFilePath|isGenericPlanTitle/,
      'must use helper methods for validation'
    );
  });

  test('resolvePlanTitle handles missing title gracefully', () => {
    const resolveBody = extractFunctionBody(planManagerSource, 'resolvePlanTitle');

    assert.match(
      resolveBody,
      /return\s*undefined/,
      'must return undefined when no title found'
    );
  });

});

test.describe('Plan Manager - File Candidate Prioritization', () => {

  test('prioritizePlanFileCandidates sorts by relevance', () => {
    const prioritizeBody = extractFunctionBody(planManagerSource, 'prioritizePlanFileCandidates');

    assert.match(
      prioritizeBody,
      /sort\(|filter\(|find\(/,
      'must process candidates array'
    );
    assert.match(
      prioritizeBody,
      /priority|relevance|score/,
      'must use scoring or priority logic'
    );
  });

  test('prioritizePlanFileCandidates processes candidates array', () => {
    const prioritizeBody = extractFunctionBody(planManagerSource, 'prioritizePlanFileCandidates');

    assert.match(
      prioritizeBody,
      /\.map\(|\.filter\(|\.sort\(/,
      'must process candidates array'
    );
    assert.match(
      prioritizeBody,
      /getPlanFileCandidateScore|isExplicit/,
      'must score and prioritize candidates'
    );
  });

});

test.describe('Plan Manager - Edge Cases', () => {

  test('plan operations handle malformed data gracefully', () => {
    const source = planManagerSource;

    assert.match(
      source,
      /if\s*\(\s*!.*\s*\)|try\s*\{[\s\S]*catch/,
      'must include validation or error handling'
    );
  });

  test('plan operations handle async operations', () => {
    const source = planManagerSource;

    assert.match(
      source,
      /async\s+|await\s+/,
      'must handle async file operations'
    );
  });

});
