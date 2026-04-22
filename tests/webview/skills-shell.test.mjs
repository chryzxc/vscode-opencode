import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const skillsShellSource = readSource(
  [
    joinFromRoot('webview', 'shared', 'src', 'skills', 'SkillsShell.tsx'),
  ],
  'SkillsShell.tsx',
);

const skillsShellBody = extractFunctionBody(skillsShellSource, 'export function SkillsShell() {');

test('SkillsShell exports the main skills panel component', () => {
  assert.match(
    skillsShellSource,
    /export function SkillsShell\(\)/,
    'SkillsShell should export a named function component',
  );
});

test('SkillsShell defines the preset IDs including the all preset', () => {
  assert.match(
    skillsShellSource,
    /const PRESETS: Array<\{[\s\S]*id: string;[\s\S]*\}> = \[[\s\S]*id: "minimal"[\s\S]*id: "development"[\s\S]*id: "security"[\s\S]*id: "all"/,
    'SkillsShell should define minimal, development, security, and all presets',
  );
});

test('SkillsShell warns before enabling all 760+ skills', () => {
  assert.match(
    skillsShellSource,
    /confirm\([\s\S]*760\+ skills[\s\S]*\)/,
    'SkillsShell should confirm before applying the all preset',
  );
});

test('SkillsShell uses acquireVsCodeApi for its message bridge', () => {
  assert.match(
    skillsShellSource,
    /window\.acquireVsCodeApi/,
    'SkillsShell should reference window.acquireVsCodeApi',
  );
  assert.match(
    skillsShellSource,
    /typeof window !== "undefined" && window\.acquireVsCodeApi/,
    'SkillsShell should guard acquireVsCodeApi with typeof check',
  );
});

test('SkillsShell requests initial data from the host', () => {
  assert.match(
    skillsShellBody,
    /vscodeApi\.postMessage\(\{ command: "requestData" \}\);/,
    'SkillsShell should request data from the extension host',
  );
});

test('SkillsShell posts enable and disable skill commands', () => {
  assert.match(
    skillsShellSource,
    /command: skill\.enabled \? "disableSkill" : "enableSkill"/,
    'SkillsShell should toggle skills with enableSkill/disableSkill commands',
  );
});

test('SkillsShell includes StatPill and SkillRow helper components', () => {
  assert.match(
    skillsShellSource,
    /function StatPill\(/,
    'SkillsShell should define the StatPill helper component',
  );
  assert.match(
    skillsShellSource,
    /function SkillRow\(/,
    'SkillsShell should define the SkillRow helper component',
  );
});

test('SkillsShell filters skills with useMemo', () => {
  assert.match(
    skillsShellSource,
    /const filtered = useMemo\(\(\) => \{[\s\S]*return skills\.filter\(/,
    'SkillsShell should memoize filtered skill results',
  );
});

test('SkillsShell exposes the search input placeholder', () => {
  assert.match(
    skillsShellSource,
    /placeholder="Search skills\.\.\."/,
    'SkillsShell should render the Search skills... placeholder',
  );
});
