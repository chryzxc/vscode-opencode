import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const planProviderSource = readAllSources([joinFromRoot('src', 'providers', 'PlanViewProvider.ts')],
  'PlanViewProvider.ts',
);
const planShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'plan', 'PlanShell.tsx')],
  'PlanShell.tsx',
);
const chatProviderSource = readAllSources([joinFromRoot('src', 'providers', 'ChatViewProvider.ts'), joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'), joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'), joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'), joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'), joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'), joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'ChatViewProvider.ts',
);

test('plan viewer HTML wiring injects plan payload and required bundled assets', () => {
  // Verify plan webview receives bootstrap payload and compiled assets.
  const htmlBody = extractFunctionBody(planProviderSource, '_getHtmlForWebview(webview: vscode.Webview, content: string, title: string)',
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
    '(',
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
    '(',
  );
  assert.match(planShellSource, /vscode\?\.postMessage\(\{\s*type:\s*["']proceedWithPlan["'],\s*rawPlan,\s*comments,\s*sourceFile\s*\}\)/, 'plan shell should post proceedWithPlan including rawPlan, comments, and sourceFile');
  assert.match(ctorBody, /case\s+["']proceedWithPlan["']:\s*\{[\s\S]*opencode\.planProceed/, 'plan provider should route proceedWithPlan to opencode.planProceed command');
  assert.match(ctorBody, /type:\s*['"]planProceedStatus['"]/, 'plan provider should emit planProceedStatus messages for UI feedback');
  assert.match(chatProviderSource, /\$\{baseName\}_comments\.md/, 'plan proceed handler should persist reviewer comments next to the source plan file');
  assert.match(chatProviderSource, /resolvePlanFileCandidates\(providedSourceFile\)\[0\]/, 'plan proceed handler should resolve sourceFile against workspace paths');
  assert.doesNotMatch(chatProviderSource, /buildFallbackPlanFilePath/, 'plan proceed flow should not fabricate fallback plan paths');
  assert.match(chatProviderSource, /Proceed on this plan\./, 'plan proceed handler should explicitly instruct AI to proceed on plan');
  assert.match(chatProviderSource, /\$\{planFilePath\}\\` is the source of truth\./, 'plan proceed handler should anchor execution to the attached source plan filename');
  assert.doesNotMatch(chatProviderSource, /createPlanFilename|createPlanCommentsFilename/, 'plan proceed handler should not generate legacy unique plan/comments filenames');
  assert.match(chatProviderSource, /PlanViewProvider\.closeCurrentPanel\(\)/, 'plan proceed handler should close plan viewer immediately after triggering proceed');
  assert.match(chatProviderSource, /void this\.handleSendMessage\([\s\S]*proceedMessage,\s*attachedFiles[\s\S]*\)/, 'plan proceed handler should dispatch send asynchronously to avoid blocking the plan tab');
  assert.match(planShellSource, /"Proceed"/, 'plan shell should present explicit proceed action label');
});

test('plan viewer read-path has error fallback for unreadable plan files', () => {
  // Verify common failure path: invalid plan file path produces user-facing error.
  // After refactoring, handleViewPlan implementation is in PlanManager module
  const viewPlanBody = extractFunctionBody(
    chatProviderSource,
    '  async handleViewPlan(plan:',
  );

  assert.match(viewPlanBody, /showErrorMessage/i, 'handleViewPlan should surface an explicit error when file read fails');
  assert.match(viewPlanBody, /Could not read plan file/i, 'handleViewPlan should surface an explicit error when file read fails');
});

test('viewPlan enforces disk-first content when plan.file is present', () => {
  // After refactoring, these helpers are in PlanManager module
  assert.match(
    chatProviderSource,
    /normalizePlanFileReference\(file: unknown\): string \| undefined/,
    'provider should normalize plan file references before reading',
  );
  assert.match(
    chatProviderSource,
    /readPlanFileFromDisk\(/,
    'provider should resolve and read plan files via a dedicated helper',
  );

  // Check the PlanManager implementation directly
  const viewPlanBody = extractFunctionBody(
    chatProviderSource,
    '  async handleViewPlan(plan:',
  );

  assert.match(
    viewPlanBody,
    /const normalizedPlanFile = this\.normalizePlanFileReference\(plan\.file\);/,
    'handleViewPlan should normalize incoming plan.file before use',
  );
  assert.match(
    viewPlanBody,
    /const prioritizedCandidates = this\.prioritizePlanFileCandidates\(\s*fileCandidates,\s*explicitFiles\s*\);/,
    'handleViewPlan should rank candidate file paths before reading',
  );
  assert.match(
    viewPlanBody,
    /for \(const candidate of prioritizedCandidates\) \{[\s\S]*readPlanFileFromDisk\(candidate\)/,
    'handleViewPlan should read file-backed plans from disk using ranked candidates',
  );
  assert.match(
    viewPlanBody,
    /if \(!planData && prioritizedCandidates\.length > 0\) \{[\s\S]*showErrorMessage[\s\S]*return;/,
    'handleViewPlan should stop when file-backed plan cannot be read (no summary fallback)',
  );
  assert.match(
    viewPlanBody,
    /if \(\s*!planData &&\s*prioritizedCandidates\.length === 0[\s\S]*plan\.content &&[\s\S]*typeof plan\.content === "string"\s*\)/,
    'structured plan.content fallback should only apply when no plan.file is provided',
  );
  assert.doesNotMatch(
    viewPlanBody,
    /persistPlan\(\s*plan\.content/,
    'viewPlan content fallback should not auto-persist to extension-chosen paths',
  );
});

test('plan viewer payload carries source file metadata for traceability', () => {
  assert.match(
    planProviderSource,
    /sourceFile\?: string/,
    'PlanViewProvider payload should accept optional sourceFile metadata',
  );
  assert.match(
    planProviderSource,
    /sourceFile: this\._currentSourceFile/,
    'plan webview bootstrap payload should include sourceFile',
  );
  assert.match(
    planShellSource,
    /const sourceFile = envelope\?\.sourceFile\?\.trim\(\);/,
    'PlanShell should read sourceFile metadata from __PLAN_DATA__',
  );
  assert.match(
    planShellSource,
    /Source: \{sourceFile\}/,
    'PlanShell should render source file path in the header',
  );
});

test('chat provider routes viewPlan to handleViewPlan', () => {
  assert.match(chatProviderSource, /case\s+["']viewPlan["']:\s*\{[\s\S]*await\s+this\.handleViewPlan\(message\.plan\)/, 'chat provider should route viewPlan to handleViewPlan');
});

test('enrichMessageWithPlan cleanses background noise from perceived plans', () => {
  // Verify enrichMessageWithPlan uses PlanParser to strip conversation history/logs.
  // After refactoring, the implementation is in StructuredOutputProcessor module
  const enrichBody = extractFunctionBody(
    chatProviderSource,
    '  enrichMessageWithPlan(message: any): any',
  );

  assert.match(enrichBody, /PlanParser\.parse/, 'enrichMessageWithPlan must parse the message content');
  assert.match(enrichBody, /PlanParser\.toMarkdown/, 'enrichMessageWithPlan must generate clean markdown from parsed plan');
  assert.match(enrichBody, /this\.persistPlan\(\s*cleanPlanContent[\s\S]*?\)/, 'enrichMessageWithPlan should persist the cleaned content');
  assert.match(enrichBody, /content:\s*cleanPlanContent/, 'enrichMessageWithPlan should include cleaned content in return payload');
});

test('structured implementation plan parsing uses plan.content as source of truth', () => {
  const normalizeBody = extractFunctionBody(
    chatProviderSource,
    '(',
  );
  const applyBody = extractFunctionBody(
    chatProviderSource,
    '(',
  );

  assert.doesNotMatch(normalizeBody, /planRec\?\.markdown,\s*message/, 'normalizeStructuredOutput should not fallback to structured message for plan content');
  assert.doesNotMatch(applyBody, /structured\.plan\?\.content\s*\|\|\s*structured\.message/, 'applyStructuredOutputToMessage should not use message as plan content fallback');
});

test('plan shell provides "Proceed" action', () => {
  assert.match(planShellSource, /"Proceed"/, 'plan shell should present "Proceed" action');
  assert.doesNotMatch(planShellSource, /Request Revision/, 'plan shell should NOT present "Request Revision" action');
});
