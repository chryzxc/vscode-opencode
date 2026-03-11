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
    'private _getHtmlForWebview(webview: vscode.Webview, content: string, title: string)',
  );

  assert.match(htmlBody, /window\.__PLAN_DATA__\s*=\s*\$\{planDataJson\}/, 'plan webview must inject __PLAN_DATA__ payload');
  assert.match(htmlBody, /<div id="root"><\/div>/, 'plan webview HTML should provide a root mount node');
  assert.match(htmlBody, /script-src\s+\$\{webview\.cspSource\}/, 'plan webview CSP must include webview.cspSource in script-src');
  assert.match(htmlBody, /<script type="module" nonce="\$\{nonce\}" src="\$\{scriptUri\}"><\/script>/, 'plan viewer should load plan.js as a module');
  assert.match(htmlBody, /dist["'], ["']chat\.css["']/, 'plan viewer should load shared chat.css stylesheet');
  assert.doesNotMatch(htmlBody, /badge\.js/, 'plan viewer MUST NOT manually load badge.js (handled by Vite)');
});

test('plan shell adheres to centralized VS Code API acquisition safety', () => {
  // Verify PlanShell does not call acquireVsCodeApi directly and imports from correct lib
  assert.match(planShellSource, /import\s+vscode\s+from\s+['"]@\/chat\/lib\/vscode['"]/, 'PlanShell must import vscode from centralized lib');
  assert.doesNotMatch(planShellSource, /window\.acquireVsCodeApi\?\.\(\)/, 'PlanShell must NOT call acquireVsCodeApi directly');
});

test('plan viewer supports interactive comment mutation events and updates comments stream', () => {
  // Verify add/update/delete comment actions are accepted and synchronized back to the webview.
  const ctorBody = extractFunctionBody(
    planProviderSource,
    'private constructor(',
  );

  assert.match(ctorBody, /case\s+["']addComment["']:\s*\{[\s\S]*commentsUpdated/, 'addComment should update store and emit commentsUpdated');
  assert.match(ctorBody, /case\s+["']updateComment["']:\s*\{[\s\S]*findIndex\([\s\S]*commentsUpdated/, 'updateComment should mutate matching comment and emit commentsUpdated');
  assert.match(ctorBody, /case\s+["']deleteComment["']:\s*\{[\s\S]*filter\([\s\S]*commentsUpdated/, 'deleteComment should remove comment and emit commentsUpdated');
  assert.match(planShellSource, /window\.postAddComment\s*=\s*\(comment:\s*PlanComment\)\s*=>\s*vscode\?\.postMessage\(\{\s*type:\s*["']addComment["'],\s*comment,\s*planId\s*\}\)/, 'plan shell should wire add comment bridge');
  assert.match(planShellSource, /window\.postUpdateComment\s*=\s*\(comment:\s*PlanComment\)\s*=>\s*vscode\?\.postMessage\(\{\s*type:\s*["']updateComment["'],\s*comment,\s*planId\s*\}\)/, 'plan shell should wire update comment bridge');
  assert.match(planShellSource, /window\.postDeleteComment\s*=\s*\(id:\s*string\)\s*=>\s*vscode\?\.postMessage\(\{\s*type:\s*["']deleteComment["'],\s*id,\s*planId\s*\}\)/, 'plan shell should wire delete comment bridge');
});

test('proceed flow forwards plan payload, returns status feedback, and sends explicit proceed-on-plan prompt', () => {
  // Verify full proceed path: webview -> plan provider -> chat provider with explicit source-of-truth instructions.
  const ctorBody = extractFunctionBody(
    planProviderSource,
    'private constructor(',
  );
  assert.match(planShellSource, /vscode\?\.postMessage\(\{\s*type:\s*["']proceedWithPlan["'],\s*rawPlan,\s*comments\s*\}\)/, 'plan shell should post proceedWithPlan including rawPlan and comments');
  assert.match(ctorBody, /case\s+["']proceedWithPlan["']:\s*\{[\s\S]*opencode\.planProceed/, 'plan provider should route proceedWithPlan to opencode.planProceed command');
  assert.match(ctorBody, /type:\s*['"]planProceedStatus['"]/, 'plan provider should emit planProceedStatus messages for UI feedback');
  assert.match(chatProviderSource, /implementation_plan_comments_\$\{id\}\.md/, 'plan proceed handler should persist reviewer comments in a dedicated markdown file with unique suffix');
  assert.match(chatProviderSource, /Proceed on this plan\./, 'plan proceed handler should explicitly instruct AI to proceed on plan');
  assert.match(chatProviderSource, /\$\{planFilename\}\\` is the source of truth\./, 'plan proceed handler should anchor execution to the attached unique implementation plan filename');
  assert.match(chatProviderSource, /const\s+planFilename\s*=\s*this\.createPlanFilename\(artifactId\)/, 'plan proceed handler should generate unique implementation plan filenames');
  assert.match(chatProviderSource, /const\s+commentsFilename\s*=\s*this\.createPlanCommentsFilename\(artifactId\)/, 'plan proceed handler should generate unique comments filenames');
  assert.match(chatProviderSource, /PlanViewProvider\.closeCurrentPanel\(\)/, 'plan proceed handler should close plan viewer immediately after triggering proceed');
  assert.match(chatProviderSource, /void this\.handleSendMessage\([\s\S]*proceedMessage,\s*attachedFiles[\s\S]*\)/, 'plan proceed handler should dispatch send asynchronously to avoid blocking the plan tab');
  assert.match(planShellSource, /Proceed on this plan/, 'plan shell should present explicit proceed-on-plan action label');
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
  assert.match(chatProviderSource, /case\s+["']viewPlan["']:\s*\{[\s\S]*await\s+this\.handleViewPlan\(message\.plan\)/, 'chat provider should route viewPlan to handleViewPlan');
});

test('enrichMessageWithPlan cleanses background noise from perceived plans', () => {
  // Verify enrichMessageWithPlan uses PlanParser to strip conversation history/logs.
  const enrichBody = extractFunctionBody(
    chatProviderSource,
    'private enrichMessageWithPlan(message: any): any',
  );

  assert.match(enrichBody, /PlanParser\.parse/, 'enrichMessageWithPlan must parse the message content');
  assert.match(enrichBody, /PlanParser\.toMarkdown/, 'enrichMessageWithPlan must generate clean markdown from parsed plan');
  assert.match(enrichBody, /this\.persistPlan\(cleanPlanContent(?:,\s*[^)]+)?\)/, 'enrichMessageWithPlan should persist the cleaned content');
  assert.match(enrichBody, /content:\s*cleanPlanContent/, 'enrichMessageWithPlan should include cleaned content in return payload');
});

test('structured implementation plan parsing uses plan.content as source of truth', () => {
  const normalizeBody = extractFunctionBody(
    chatProviderSource,
    'private normalizeStructuredOutput(',
  );
  const applyBody = extractFunctionBody(
    chatProviderSource,
    'private applyStructuredOutputToMessage(message: any): any',
  );

  assert.doesNotMatch(normalizeBody, /planRec\?\.markdown,\s*message/, 'normalizeStructuredOutput should not fallback to structured message for plan content');
  assert.doesNotMatch(applyBody, /structured\.plan\?\.content\s*\|\|\s*structured\.message/, 'applyStructuredOutputToMessage should not use message as plan content fallback');
});
