import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const planProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'PlanViewProvider.ts')],
  'PlanViewProvider.ts',
);
const planShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'plan', 'PlanShell.tsx')],
  'PlanShell.tsx',
);
const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('plan viewer HTML wiring injects plan payload and required bundled assets', () => {
  // Verify plan webview receives bootstrap payload and compiled assets.
  const htmlBody = extractFunctionBody(
    planProviderSource,
    'private _getHtmlForWebview(webview: vscode.Webview, plan: import(\'../types/Plan\').ImplementationPlan)',
  );

  assert.match(htmlBody, /window\.__PLAN_DATA__\s*=\s*\$\{planDataJson\}/, 'plan webview must inject __PLAN_DATA__ payload');
  assert.match(htmlBody, /<div id="root"><\/div>/, 'plan webview HTML should provide a root mount node');
  assert.match(htmlBody, /script-src\s+\$\{webview\.cspSource\}/, 'plan webview CSP must include webview.cspSource in script-src');
  assert.match(htmlBody, /<script type="module" nonce="\$\{nonce\}" src="\$\{scriptUri\}"><\/script>/, 'plan viewer should load plan.js as a module');
  assert.match(htmlBody, /dist', 'chat\.css'/, 'plan viewer should load shared chat.css stylesheet');
});

test('plan viewer supports interactive comment mutation events and updates comments stream', () => {
  // Verify add/update/delete comment actions are accepted and synchronized back to the webview.
  const ctorBody = extractFunctionBody(
    planProviderSource,
    'private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, content: string)',
  );

  assert.match(ctorBody, /case\s+'addComment':\s*\{[\s\S]*commentsUpdated/, 'addComment should update store and emit commentsUpdated');
  assert.match(ctorBody, /case\s+'updateComment':\s*\{[\s\S]*findIndex\([\s\S]*commentsUpdated/, 'updateComment should mutate matching comment and emit commentsUpdated');
  assert.match(ctorBody, /case\s+'deleteComment':\s*\{[\s\S]*filter\([\s\S]*commentsUpdated/, 'deleteComment should remove comment and emit commentsUpdated');
  assert.match(planShellSource, /window\.postAddComment\s*=\s*\(comment:\s*PlanComment\)\s*=>\s*vscode\?\.postMessage\(\{\s*type:\s*'addComment',\s*comment,\s*planId\s*\}\)/, 'plan shell should wire add comment bridge');
  assert.match(planShellSource, /window\.postUpdateComment\s*=\s*\(comment:\s*PlanComment\)\s*=>\s*vscode\?\.postMessage\(\{\s*type:\s*'updateComment',\s*comment,\s*planId\s*\}\)/, 'plan shell should wire update comment bridge');
  assert.match(planShellSource, /window\.postDeleteComment\s*=\s*\(id:\s*string\)\s*=>\s*vscode\?\.postMessage\(\{\s*type:\s*'deleteComment',\s*id,\s*planId\s*\}\)/, 'plan shell should wire delete comment bridge');
});

test('proceed flow forwards plan payload, persists comments, and sends Proceed with plan attachment', () => {
  // Verify full proceed path: webview -> plan provider -> chat provider -> Proceed message.
  const ctorBody = extractFunctionBody(
    planProviderSource,
    'private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, content: string)',
  );
  assert.match(planShellSource, /vscode\?\.postMessage\(\{\s*type:\s*'proceedWithPlan',\s*rawPlan,\s*comments\s*\}\)/, 'plan shell should post proceedWithPlan including rawPlan and comments');
  assert.match(ctorBody, /case\s+'proceedWithPlan':\s*\{[\s\S]*opencode\.planProceed/, 'plan provider should route proceedWithPlan to opencode.planProceed command');
  assert.match(chatProviderSource, /async\s+handlePlanProceed\([\s\S]*## Comments/, 'plan proceed handler should append comments section into persisted markdown');
  assert.match(chatProviderSource, /await\s+this\.handleSendMessage\(\s*["']The implementation plan has been reviewed and approved/, 'plan proceed handler should send human-friendly approval message');
  assert.match(chatProviderSource, /PlanViewProvider\.closeCurrentPanel\(\)/, 'plan proceed handler should close plan viewer after triggering proceed');
});

test('plan viewer read-path has error fallback for unreadable plan files', () => {
  // Verify common failure path: invalid plan file path produces user-facing error.
  const viewPlanBody = extractFunctionBody(
    chatProviderSource,
    'private async handleViewPlan(plan:',
  );

  assert.match(viewPlanBody, /showErrorMessage/i, 'handleViewPlan should surface an explicit error when file read fails');
  assert.match(viewPlanBody, /Could not read plan file/i, 'handleViewPlan should surface an explicit error when file read fails');
});

test('chat provider routes viewPlan to handleViewPlan', () => {
  assert.match(chatProviderSource, /case\s+['"]viewPlan['"]:\s*\{[\s\S]*await\s+this\.handleViewPlan\(message\.plan\)/, 'chat provider should route viewPlan to handleViewPlan');
});
