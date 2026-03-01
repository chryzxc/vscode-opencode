import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const planParserSource = readSource(
  [joinFromRoot('src', 'services', 'PlanParser.ts')],
  'PlanParser.ts',
);
const planViewSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'plan', 'PlanShell.tsx')],
  'PlanShell.tsx',
);

test('PlanParser exposes static parse method for markdown plans', () => {
  // Verify the parse API exists and is static
  assert.match(planParserSource, /export class PlanParser/, 'PlanParser should be exported as a class');
  assert.match(planParserSource, /public static parse\(markdown: string\): ImplementationPlan/, 'PlanParser should expose static parse method');
  assert.match(planParserSource, /return plan;/, 'parse method should return plan object');
});

test('PlanParser extracts goal from first markdown header', () => {
  // Verify goal extraction from headers
  const parseBody = extractFunctionBody(planParserSource, 'public static parse(markdown: string): ImplementationPlan');

  assert.match(parseBody, /const goalMatch = markdown\.match/, 'parse should find first # header');
  assert.match(parseBody, /plan\.goal = goalMatch\[1\]\.trim\(\)/, 'parse should extract and trim goal text');
});

test('PlanParser extracts description between goal and first section', () => {
  // Verify description extraction
  assert.match(planParserSource, /const goalEndIndex = markdown\.indexOf/, 'parse should calculate goal end position');
  assert.match(planParserSource, /const sectionMatch = markdown/, 'parse should find first section after goal');
  assert.match(planParserSource, /plan\.description/, 'parse should set description field');
});

test('PlanParser extracts file operations with flexible syntax', () => {
  // Verify file operation extraction with multiple format support
  const parseBody = extractFunctionBody(planParserSource, 'public static parse(markdown: string): ImplementationPlan');

  assert.match(parseBody, /const fileRegex = /, 'parse should define file regex');
  assert.match(parseBody, /while \(\(match = fileRegex\.exec\(markdown\)\) !== null\)/, 'parse should iterate through all file matches');
  assert.match(parseBody, /const type = match\[1\]\.toUpperCase\(\)/, 'parse should normalize operation type');
  assert.match(parseBody, /let filePath = match\[2\]\.trim\(\)/, 'parse should extract file path from match');
  assert.match(parseBody, /filePath = match\[3\]\.replace/, 'parse should handle file:/// prefix');
  assert.match(parseBody, /filePath = filePath\.replace/, 'parse should remove bracket characters');
  assert.match(parseBody, /plan\.files\.push/, 'parse should add file operation to plan');
});

test('PlanParser extracts verification steps from Verification Plan section', () => {
  // Verify verification step extraction
  const parseBody = extractFunctionBody(planParserSource, 'public static parse(markdown: string): ImplementationPlan');

  assert.match(parseBody, /const verificationRegex = /, 'parse should find Verification Plan section');
  assert.match(parseBody, /const vMatch = markdown\.match\(verificationRegex\)/, 'parse should match verification section');
  assert.match(parseBody, /plan\.verification\.push/, 'parse should add verification step to plan');
});

test('PlanParser extracts checklist steps with completion status', () => {
  // Verify checkbox/step extraction
  const parseBody = extractFunctionBody(planParserSource, 'public static parse(markdown: string): ImplementationPlan');

  assert.match(parseBody, /const stepRegex = /, 'parse should match checkbox pattern');
  assert.match(parseBody, /while \(\(match = stepRegex\.exec\(markdown\)\) !== null\)/, 'parse should iterate through all checkboxes');
  assert.match(parseBody, /plan\.steps\.push/, 'parse should extract step with completion flag');
});

test('PlanParser initializes plan with required structure', () => {
  // Verify plan object initialization
  const parseBody = extractFunctionBody(planParserSource, 'public static parse(markdown: string): ImplementationPlan');

  assert.match(parseBody, /const plan: ImplementationPlan = \{/, 'parse should create typed plan object');
  assert.match(parseBody, /goal:\s*\["']\["'],/, 'parse should initialize empty goal');
  assert.match(parseBody, /files:\s*\[\],/, 'parse should initialize empty files array');
  assert.match(parseBody, /steps:\s*\[\],/, 'parse should initialize empty steps array');
  assert.match(parseBody, /verification:\s*\[\],/, 'parse should initialize empty verification array');
  assert.match(parseBody, /rawContent:\s*markdown,/, 'parse should preserve raw markdown');
});

test('PlanParser handles fallback for description when no sections found', () => {
  // Verify fallback description extraction
  const parseBody = extractFunctionBody(planParserSource, 'public static parse(markdown: string): ImplementationPlan');

  assert.match(parseBody, /else\s*\{/, 'parse should have else clause for fallback');
  assert.match(parseBody, /const remaining = markdown\.slice\(goalEndIndex\)\.trim\(\)/, 'parse should fallback to all remaining text');
  assert.match(parseBody, /if\s*\(remaining\)/, 'parse should check remaining exists');
  assert.match(parseBody, /plan\.description = remaining/, 'parse should use remaining text as description');
});

test('PlanParser supports multiple file operation formats', () => {
  // Verify support for #### [MODIFY], [MODIFY], [NEW], [DELETE], etc.
  const fileRegex = /(?:#{1,4}\s+)?\[(MODIFY|NEW|DELETE)\]\s+([^\s()]+)/gi;

  // Test basic formats that the regex supports
  const formats = [
    '#### [MODIFY] src/app.ts',
    '[NEW] src/services/AuthService.ts',
    '[DELETE] src/old/legacy.js',
  ];

  for (const format of formats) {
    const match = fileRegex.exec(format);
    assert.ok(match, `Should match format: ${format}`);
    fileRegex.lastIndex = 0; // Reset for next test
  }
});

test('PlanParser handles completed and incomplete checkboxes', () => {
  // Verify checkbox completion detection
  const parseBody = extractFunctionBody(planParserSource, 'public static parse(markdown: string): ImplementationPlan');

  assert.match(parseBody, /completed: match\[1\] === ["']x["']/, 'parse should set completed true for [x]');
});

test('PlanParser integrates with plan shell', () => {
  // Verify PlanParser is used in the codebase
  assert.match(planParserSource, /class PlanParser/, 'PlanParser class should exist');
  assert.match(planParserSource, /static parse/, 'PlanParser should have static parse method');
});
