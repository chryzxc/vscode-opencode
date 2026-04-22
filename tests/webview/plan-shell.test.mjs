import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const planShellSource = readSource(
  [
    joinFromRoot('webview', 'shared', 'src', 'plan', 'PlanShell.tsx'),
  ],
  'PlanShell.tsx',
);

const planShellBody = extractFunctionBody(planShellSource, 'export default function PlanShell() {');

test('PlanShell exports the default shell component', () => {
  assert.match(
    planShellSource,
    /export default function PlanShell\(\)/,
    'PlanShell should export a default shell component',
  );
});

test('PlanShell reads plan bootstrap data from window.__PLAN_DATA__', () => {
  assert.match(
    planShellSource,
    /const envelope = window\.__PLAN_DATA__;/,
    'PlanShell should consume plan data from window.__PLAN_DATA__',
  );
});

test('PlanShell sends proceedWithPlan messages with raw plan payload', () => {
  assert.match(
    planShellBody,
    /vscode\?\.postMessage\(\{ type: "proceedWithPlan", rawPlan, comments, sourceFile \}\);/,
    'handleProceed should post rawPlan, comments, and sourceFile to VS Code',
  );
});

test('PlanShell tracks execution and comment UI state with useState', () => {
  assert.match(
    planShellSource,
    /const \[executing, setExecuting\] = useState\(false\);/,
    'PlanShell should track executing state',
  );
  assert.match(
    planShellSource,
    /const \[proceedError, setProceedError\] = useState/,
    'PlanShell should track proceedError state',
  );
  assert.match(
    planShellSource,
    /const \[comments, setComments\] = useState/,
    'PlanShell should track comments state',
  );
  assert.match(
    planShellSource,
    /const \[commentsPanelOpen, setCommentsPanelOpen\] = useState\(false\);/,
    'PlanShell should track commentsPanelOpen state',
  );
});

test('PlanShell shows both Proceed and Proceeding… labels', () => {
  assert.match(
    planShellSource,
    /executing \? "Proceeding…" : "Proceed"/,
    'PlanShell should toggle between Proceed and Proceeding labels based on executing state',
  );
});

test('PlanShell renders the floating comment popover with the expected className', () => {
  assert.match(
    planShellSource,
    /className="comment-popover animate-in fade-in zoom-in-95 duration-200 rounded-md border border-\[var\(--vscode-panel-border\)\] bg-\[var\(--vscode-editorWidget-background,var\(--vscode-editor-background\)\)\] p-4 shadow-xl"/,
    'PlanShell should tag the floating comment UI with comment-popover',
  );
});

test('PlanShell listens for text selection mouseup events on the content container', () => {
  assert.match(
    planShellSource,
    /container\.addEventListener\("mouseup", computeAnchorFromSelection\);/,
    'PlanShell should attach a mouseup handler for selection-based comments',
  );
});

test('PlanShell creates comment IDs with crypto.randomUUID()', () => {
  assert.match(
    planShellSource,
    /id: crypto\.randomUUID\(\),/,
    'PlanShell should generate new comment IDs with crypto.randomUUID()',
  );
});

test('PlanShell renders pre-parsed markdown through MarkdownRenderer', () => {
  assert.match(
    planShellSource,
    /<MarkdownRenderer[\s\S]*?isPreParsed=\{true\}/,
    'PlanShell should pass isPreParsed={true} to MarkdownRenderer',
  );
});

test('PlanShell slides the comments panel with translateX state', () => {
  assert.match(
    planShellSource,
    /transform: commentsPanelOpen \? "translateX\(0\)" : "translateX\(100%\)"/,
    'PlanShell should animate the comments panel with translateX based on open state',
  );
});
