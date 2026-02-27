import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('plan detection enriches assistant messages from plan files and structured plan content', () => {
  // Verify the core enrichMessageWithPlan heuristic and output contract.
  const enrichBody = extractFunctionBody(
    chatProviderSource,
    'private enrichMessageWithPlan(message: any): any',
  );

  assert.match(enrichBody, /edits\.some\([\s\S]*implementation_plan\.md/, 'plan detection should scan edits for implementation_plan.md');
  assert.match(enrichBody, /parts\.some\([\s\S]*p\.type\s*===\s*"patch"[\s\S]*implementation_plan\.md/, 'plan detection should scan patch parts for implementation_plan.md');
  assert.match(enrichBody, /basicPlanKeywordMatch/, 'plan detection should include keyword checks');
  assert.match(enrichBody, /hasStructuralMarkers/, 'plan detection should include structural marker checks to reduce false positives');
  assert.match(enrichBody, /const\s+hasPlanKeywords\s*=\s*basicPlanKeywordMatch\s*&&\s*hasStructuralMarkers/, 'plan detection should require keywords plus structure');
  assert.match(enrichBody, /plan:\s*\{[\s\S]*file:\s*"implementation_plan\.md"[\s\S]*content:\s*planContent/, 'enriched messages must include plan metadata with file + content');
});

test('plan detection preserves safety guards and persistence behavior', () => {
  // Verify false-positive and failure-path guards remain in place.
  const enrichBody = extractFunctionBody(
    chatProviderSource,
    'private enrichMessageWithPlan(message: any): any',
  );

  assert.match(enrichBody, /if\s*\(!message\)\s*return\s+message;/, 'plan detection should no-op on empty messages');
  assert.match(enrichBody, /planContent\.length\s*<\s*200/, 'plan detection should reject short plan-like responses');
  assert.match(enrichBody, /this\.persistPlan\(planContent\)\.catch\(/, 'plan detection should attempt plan persistence with error handling');
  assert.match(enrichBody, /return\s+message;/, 'plan detection should return the original message when no valid plan is found');
});

test('assistant message UI renders plan buttons and core plan card affordances', () => {
  // Verify the two plan entry points in message UI are present.
  assert.match(messageSource, /title="Core Feature: View Implementation Plan"/, 'header-level plan button must keep core-feature tooltip');
  assert.match(messageSource, /onClick=\{\(\)\s*=>\s*vscode\.postMessage\(\{\s*type:\s*'viewPlan',\s*plan\s*\}\)\}/, 'plan button should dispatch viewPlan event');
  assert.match(messageSource, /className="plan-card[^"]*"/, 'assistant message should render plan card container');
  assert.match(messageSource, /View Implementation Plan/, 'plan card must expose View Implementation Plan call-to-action');
});
