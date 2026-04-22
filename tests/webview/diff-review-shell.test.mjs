import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const diffReviewShellSource = readSource(
  [
    joinFromRoot('webview', 'shared', 'src', 'diff-review', 'DiffReviewShell.tsx'),
  ],
  'DiffReviewShell.tsx',
);

const diffReviewBody = extractFunctionBody(diffReviewShellSource, 'export default function DiffReviewShell() {');

test('DiffReviewShell exports the default diff review shell', () => {
  assert.match(
    diffReviewShellSource,
    /export default function DiffReviewShell\(\)/,
    'DiffReviewShell should export a default shell component',
  );
});

test('DiffReviewShell defines the expected filter union', () => {
  assert.match(
    diffReviewShellSource,
    /type FilterType = 'all' \| 'create' \| 'modify' \| 'delete';/,
    'DiffReviewShell should define the all/create/modify/delete filter union',
  );
});

test('DiffReviewShell includes the line-number and hunk-header helpers', () => {
  assert.match(
    diffReviewShellSource,
    /function computeLineNumbers\(hunks: DiffHunk\[\]\): Array<\{ old: number \| null; new: number \| null \}> \{/,
    'DiffReviewShell should expose computeLineNumbers',
  );
  assert.match(
    diffReviewShellSource,
    /function parseHunkHeader\(header: string\): \{ oldStart: number; newStart: number \}/,
    'DiffReviewShell should expose parseHunkHeader',
  );
});

test('DiffReviewShell declares DiffLine and DiffStatsBar internal components', () => {
  assert.match(
    diffReviewShellSource,
    /function DiffLine\(/,
    'DiffReviewShell should define the internal DiffLine component',
  );
  assert.match(
    diffReviewShellSource,
    /function DiffStatsBar\(\{ added, deleted \}: \{ added: number; deleted: number \}\)/,
    'DiffReviewShell should define the internal DiffStatsBar component',
  );
});

test('DiffReviewShell defines DiffItem with approve and reject handling', () => {
  assert.match(
    diffReviewShellSource,
    /function DiffItem\([\s\S]*onApprove: \(path: string\) => void;[\s\S]*onReject: \(path: string\) => void;[\s\S]*\)/,
    'DiffReviewShell should define DiffItem with approve/reject callbacks',
  );
});

test('DiffReviewShell posts approve and reject diff messages', () => {
  assert.match(
    diffReviewBody,
    /vscode\?\.postMessage\(\{ type: 'approveDiff', file: path \}\);/,
    'DiffReviewShell should post approveDiff messages',
  );
  assert.match(
    diffReviewBody,
    /vscode\?\.postMessage\(\{ type: 'rejectDiff', file: path \}\);/,
    'DiffReviewShell should post rejectDiff messages',
  );
});

test('DiffReviewShell implements keyboard navigation shortcuts', () => {
  assert.match(
    diffReviewShellSource,
    /case 'j':[\s\S]*?case 'ArrowDown':[\s\S]*?case 'k':[\s\S]*?case 'ArrowUp':[\s\S]*?case 'Enter':[\s\S]*?case 'a':[\s\S]*?case 'r':[\s\S]*?case 'Escape':/,
    'DiffReviewShell should support j/k/arrow navigation plus enter/a/r/escape keys',
  );
});

test('DiffReviewShell copies diff lines with navigator.clipboard.writeText', () => {
  assert.match(
    diffReviewShellSource,
    /navigator\.clipboard\.writeText\(text\)\.catch\(\(\) => \{\}\);/,
    'DiffReviewShell should copy line text to the clipboard',
  );
});
