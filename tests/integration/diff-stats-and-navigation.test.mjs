import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const trackerPath = path.join(repoRoot, 'src', 'services', 'SubagentTracker.ts');
const chatProviderPath = path.join(repoRoot, 'src', 'providers', 'ChatViewProvider.ts');
const diffProviderPath = path.join(repoRoot, 'src', 'providers', 'DiffReviewProvider.ts');
const messageComponentsPath = path.join(repoRoot, 'webview', 'shared', 'src', 'chat', 'MessageComponents.tsx');
const diffShellPath = path.join(repoRoot, 'webview', 'shared', 'src', 'diff-review', 'DiffReviewShell.tsx');

const trackerSource = fs.readFileSync(trackerPath, 'utf8');
const chatProviderSource = fs.readFileSync(chatProviderPath, 'utf8');
const diffProviderSource = fs.readFileSync(diffProviderPath, 'utf8');
const messageComponentsSource = fs.readFileSync(messageComponentsPath, 'utf8');
const diffShellSource = fs.readFileSync(diffShellPath, 'utf8');

test('SubagentTracker logic', () => {
  assert.ok(trackerSource.includes('diffStats'), 'Contains diffStats');
  assert.ok(trackerSource.includes('step-finish'), 'Contains step-finish');
});

test('ChatViewProvider logic', () => {
  assert.ok(chatProviderSource.includes('getDiffStats'), 'Contains getDiffStats');
  assert.ok(chatProviderSource.includes('git diff'), 'Uses git diff');
  assert.match(chatProviderSource, /this\.getDiffStats/, 'ChatViewProvider should call getDiffStats');
});

test('DiffReviewProvider logic', () => {
  assert.ok(diffProviderSource.includes('openFile'), 'Handles openFile');
  assert.ok(diffProviderSource.includes('vscode.workspace.workspaceFolders'), 'Uses workspaceFolders');
  assert.ok(diffProviderSource.includes('vscode.commands.executeCommand'), 'Uses executeCommand');
});

test('MessageComponents logic', () => {
  assert.ok(messageComponentsSource.includes('diffStats'), 'Draws diffStats');
  assert.ok(messageComponentsSource.includes('text-oc-green'), 'Uses green for additions');
  assert.ok(messageComponentsSource.includes('text-oc-red'), 'Uses red for deletions');
});

test('DiffReviewShell logic', () => {
  assert.ok(diffShellSource.includes('ExternalLink'), 'Uses ExternalLink icon');
  assert.ok(diffShellSource.includes('Open File'), 'Has Open File title');
  assert.ok(diffShellSource.includes('openFile'), 'Posts openFile message');
});

test('DiffReviewShell — line numbers', () => {
  assert.ok(diffShellSource.includes('computeLineNumbers'), 'Has computeLineNumbers function');
  assert.ok(diffShellSource.includes('parseHunkHeader'), 'Has parseHunkHeader function');
  assert.ok(diffShellSource.includes('oldNum'), 'DiffLine receives oldNum prop');
  assert.ok(diffShellSource.includes('newNum'), 'DiffLine receives newNum prop');
});

test('DiffReviewShell — keyboard navigation', () => {
  assert.ok(diffShellSource.includes('ArrowDown'), 'Handles ArrowDown key');
  assert.ok(diffShellSource.includes('ArrowUp'), 'Handles ArrowUp key');
  assert.ok(diffShellSource.includes("case 'j'") || diffShellSource.includes("'j':"), 'Handles j key for next file');
  assert.ok(diffShellSource.includes("case 'k'") || diffShellSource.includes("'k':"), 'Handles k key for prev file');
  assert.ok(diffShellSource.includes('activeIdx'), 'Tracks active file index');
});

test('DiffReviewShell — approval progress bar', () => {
  assert.ok(diffShellSource.includes('ApprovalProgressBar'), 'Has ApprovalProgressBar component');
  assert.ok(diffShellSource.includes('approvedCount'), 'Computes approvedCount');
  assert.ok(diffShellSource.includes('handleApprove'), 'Has handleApprove handler');
  assert.ok(diffShellSource.includes('handleReject'), 'Has handleReject handler');
});

test('DiffReviewShell — file type badges', () => {
  assert.ok(diffShellSource.includes('CREATE') || diffShellSource.includes('create'), 'Handles create file type');
  assert.ok(diffShellSource.includes('MODIFY') || diffShellSource.includes('modify'), 'Handles modify file type');
  assert.ok(diffShellSource.includes('DELETE') || diffShellSource.includes('delete'), 'Handles delete file type');
  assert.ok(diffShellSource.includes('getFileTypeConfig'), 'Has getFileTypeConfig helper');
});

test('DiffReviewShell — copy line button', () => {
  assert.ok(diffShellSource.includes('Copy'), 'Uses Copy icon');
  assert.ok(diffShellSource.includes('navigator.clipboard') || diffShellSource.includes('clipboard'), 'Uses clipboard API');
});

test('DiffReviewShell — diff stats bar', () => {
  assert.ok(diffShellSource.includes('DiffStatsBar'), 'Has DiffStatsBar component');
  assert.ok(diffShellSource.includes('bg-oc-green'), 'Uses oc-green for additions');
  assert.ok(diffShellSource.includes('bg-oc-red'), 'Uses oc-red for deletions');
});

test('DiffReviewShell — keyboard shortcuts help panel', () => {
  assert.ok(diffShellSource.includes('KeyboardHint') || diffShellSource.includes('keyboard') || diffShellSource.includes('Keyboard'), 'Has keyboard shortcuts panel');
  assert.ok(diffShellSource.includes('Approve active') || diffShellSource.includes('approve'), 'Keyboard hints include approve action');
});
