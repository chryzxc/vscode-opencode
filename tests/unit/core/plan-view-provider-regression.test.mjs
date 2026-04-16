/**
 * PlanViewProvider Regression Tests
 *
 * These tests prevent regressions in implementation plan display functionality.
 * Plan views are critical for reviewing and executing implementation plans.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const planViewSource = readSource(
  [joinFromRoot('src', 'providers', 'PlanViewProvider.ts')],
  'PlanViewProvider.ts',
);

test.describe('PlanViewProvider - Panel Creation', () => {

  test('has static show method', () => {
    const source = planViewSource;

    assert.match(
      source,
      /public static show\(context.*payload.*string.*\{/s,
      'must provide static show method'
    );
  });

  test('accepts string or object payload', () => {
    const source = planViewSource;

    assert.match(
      source,
      /payload.*string.*\{.*content.*title.*sourceFile/s,
      'must accept string or object payload with content, title, sourceFile'
    );
  });

  test('creates webview panel', () => {
    const source = planViewSource;

    assert.match(
      source,
      /createWebviewPanel\(PlanViewProvider\.viewType/s,
      'must create webview panel for plan view'
    );
  });

  test('enables scripts in webview', () => {
    const source = planViewSource;

    assert.match(
      source,
      /enableScripts:\s*true/s,
      'must enable scripts in webview'
    );
  });

  test('sets local resource roots', () => {
    const source = planViewSource;

    assert.match(
      source,
      /localResourceRoots:.*webview\/plan|webview\/shared/s,
      'must set local resource roots for webview'
    );
  });

});

test.describe('PlanViewProvider - Panel Management', () => {

  test('tracks current panel instance', () => {
    const source = planViewSource;

    assert.match(
      source,
      /private static currentPanel.*PlanViewProvider/s,
      'must track current panel instance'
    );
  });

  test('reuses existing panel if available', () => {
    const source = planViewSource;

    assert.match(
      source,
      /PlanViewProvider\.currentPanel\)[\s\S]*\.reveal\(/s,
      'must reveal existing panel if available'
    );
  });

  test('updates existing panel content', () => {
    const source = planViewSource;

    assert.match(
      source,
      /currentPanel\._update\(content.*title/s,
      'must update existing panel with new content'
    );
  });

  test('has closeCurrentPanel method', () => {
    const source = planViewSource;

    assert.match(
      source,
      /public static closeCurrentPanel\(\)/s,
      'must provide static closeCurrentPanel method'
    );
  });

  test('disposes panel on close', () => {
    const source = planViewSource;

    assert.match(
      source,
      /closeCurrentPanel[\s\S]*\._panel\.dispose\(\)/s,
      'must dispose panel when closing'
    );
  });

});

test.describe('PlanViewProvider - Content Display', () => {

  test('extracts title from content', () => {
    const source = planViewSource;

    assert.match(
      source,
      /deriveTitle.*match.*\^#\{1,3\}\s\+.*\$/m/s,
      'must extract title from markdown heading'
    );
  });

  test('falls back to default title', () => {
    const source = planViewSource;

    assert.match(
      source,
      /Implementation Plan.*deriveTitle.*\|\|/s,
      'must fall back to default title'
    );
  });

  test('updates panel title', () => {
    const source = planViewSource;

    assert.match(
      source,
      source,
      /_panel\.title\s*=\s*this\._currentTitle/s,
      'must update panel title'
    );
  });

  test('sets webview HTML content', () => {
    const source = planViewSource;

    assert.match(
      source,
      /_panel\.webview\.html\s*=\s*this\._getHtmlForWebview/s,
      'must set webview HTML content'
    );
  });

});

test.describe('PlanViewProvider - Comment System', () => {

  test('stores comments by plan ID', () => {
    const source = planViewSource;

    assert.match(
      source,
      /_commentsByPlan.*Map<string.*\[\]>/s,
      'must store comments in map keyed by plan ID'
    );
  });

  test('handles addComment message', () => {
    const source = planViewSource;

    assert.match(
      source,
      /case 'addComment':[\s\S]*_commentsByPlan\.set/s,
      'must handle addComment message from webview'
    );
  });

  test('handles updateComment message', () => {
    const source = planViewSource;

    assert.match(
      source,
      /case 'updateComment':[\s\S]*findIndex.*\[\w+\]\s*=\s*message/s,
      'must handle updateComment message from webview'
    );
  });

  test('handles deleteComment message', () => {
    const source = planViewSource;

    assert.match(
      source,
      /case 'deleteComment':[\s\S]*filter.*c\.id\s*!==\s*message\.id/s,
      'must handle deleteComment message from webview'
    );
  });

  test('saves comments to workspace state', () => {
    const source = planViewSource;

    assert.match(
      source,
      /saveComments[\s\S]*workspaceState\.update\('opencode\.planComments'/s,
      'must save comments to workspace state'
    );
  });

  test('loads comments from workspace state', () => {
    const source = planViewSource;

    assert.match(
      source,
      /loadComments[\s\S]*workspaceState\.get\('opencode\.planComments'/s,
      'must load comments from workspace state'
    );
  });

  test('sends updated comments to webview', () => {
    const source = planViewSource;

    assert.match(
      source,
      source,
      /postMessage\(\{\s*type:\s*'commentsUpdated'/s,
      'must send updated comments to webview'
    );
  });

});

test.describe('PlanViewProvider - Plan Execution', () => {

  test('handles executePlan message', () => {
    const source = planViewSource;

    assert.match(
      source,
      /case 'executePlan':[\s\S]*executeCommand\('opencode\.executePlan'/s,
      'must handle executePlan message from webview'
    );
  });

  test('closes panel after starting execution', () => {
    const source = planViewSource;

    assert.match(
      source,
      /case 'executePlan':[\s\S]*_panel\.dispose\(\)/s,
      'must close panel after starting plan execution'
    );
  });

});

test.describe('PlanViewProvider - Plan Proceed Flow', () => {

  test('handles proceedWithPlan message', () => {
    const source = planViewSource;

    assert.match(
      source,
      /case 'proceedWithPlan':[\s\S]*rawPlan.*comments.*sourceFile/s,
      'must handle proceedWithPlan message from webview'
    );
  });

  test('validates plan content is not empty', () => {
    const source = planViewSource;

    assert.match(
      source,
      /proceedWithPlan[\s\S]*!\s*payload\.rawPlan\.trim\(\)/s,
      'must validate plan content is not empty'
    });
  });

  test('sends error status if plan is empty', () => {
    const source = planViewSource;

    assert.match(
      source,
      /planProceedStatus.*ok:\s*false.*Cannot proceed because plan content is empty/s,
      'must send error status if plan content is empty'
    );
  });

  test('sends success status before proceeding', () => {
    const source = planViewSource;

    assert.match(
      source,
      /planProceedStatus.*ok:\s*true.*stage:\s*'accepted'/s,
      'must send success status before proceeding'
    );
  });

  test('executes opencode.planProceed command', () => {
    const source = planViewSource;

    assert.match(
      source,
      /executeCommand\('opencode\.planProceed'/s,
      'must execute opencode.planProceed command'
    );
  });

  test('handles execution errors', () => {
    const source = planViewSource;

    assert.match(
      source,
      /\.then\(undefined.*err.*planProceedStatus.*ok:\s*false/s,
      'must handle execution errors and send status'
    );
  });

});

test.describe('PlanViewProvider - View State Management', () => {

  test('listens to view state changes', () => {
    const source = planViewSource;

    assert.match(
      source,
      /onDidChangeViewState[\s\S]*_panel\.visible/s,
      'must listen to view state changes'
    );
  });

  test('updates content when panel becomes visible', () => {
    const source = planViewSource;

    assert.match(
      source,
      /onDidChangeViewState[\s\S]*_update\(this\._currentContent/s,
      'must update content when panel becomes visible'
    );
  });

});

test.describe('PlanViewProvider - Webview Security', () => {

  test('uses CSP for webview', () => {
    const source = planViewSource;

    assert.match(
      source,
      /Content-Security-Policy.*default-src 'none'/s,
      'must use Content Security Policy'
    );
  });

  test('generates nonce for scripts', () => {
    const source = planViewSource;

    assert.match(
      source,
      /nonce.*getNonce\(\)/s,
      'must generate nonce for script security'
    );
  });

  test('includes nonce in script tags', () => {
    const source = planViewSource;

    assert.match(
      source,
      /script.*nonce-.*\$\{nonce\}/s,
      'must include nonce in script tags'
    );
  });

});

test.describe('PlanViewProvider - Resource URIs', () => {

  test('converts script URI to webview URI', () => {
    const source = planViewSource;

    assert.match(
      source,
      /asWebviewUri.*plan\.js/s,
      'must convert script URI to webview URI'
    );
  });

  test('converts styles URI to webview URI', () => {
    const source = planViewSource;

    assert.match(
      source,
      /asWebviewUri.*chat\.css/s,
      'must convert styles URI to webview URI'
    );
  });

});

test.describe('PlanViewProvider - Plan Data Injection', () => {

  test('injects plan data into webview', () => {
    const source = planViewSource;

    assert.match(
      source,
      /window\.__PLAN_DATA__\s*=\s*\$\{planDataJson\}/s,
      'must inject plan data into webview global scope'
    );
  });

  test('includes raw plan content', () => {
    const source = planViewSource;

    assert.match(
      source,
      /planData.*raw:\s*content/s,
      'must include raw plan content in data'
    );
  });

  test('includes plan title', () => {
    const source = planViewSource;

    assert.match(
      source,
      /planData.*title/s,
      'must include plan title in data'
    );
  });

  test('includes source file', () => {
    const source = planViewSource;

    assert.match(
      source,
      /planData.*sourceFile/s,
      'must include source file in data'
    );
  });

  test('includes comments in plan data', () => {
    const source = planViewSource;

    assert.match(
      source,
      /planData.*comments:.*_commentsByPlan\.get/s,
      'must include comments in plan data'
    );
  });

});

test.describe('PlanViewProvider - Disposal', () => {

  test('has dispose method', () => {
    const source = planViewSource;

    assert.match(
      source,
      /public dispose\(\)/s,
      'must provide dispose method'
    );
  });

  test('clears current panel reference', () => {
    const source = planViewSource;

    assert.match(
      source,
      /dispose[\s\S]*currentPanel\s*=\s*undefined/s,
      'must clear current panel reference on disposal'
    );
  });

  test('disposes webview panel', () => {
    const source = planViewSource;

    assert.match(
      source,
      /dispose[\s\S]*_panel\.dispose\(\)/s,
      'must dispose webview panel on disposal'
    );
  });

  test('disposes all disposables', () => {
    const source = planViewSource;

    assert.match(
      source,
      /dispose[\s\S]*while.*_disposables\.length.*\.dispose\(\)/s,
      'must dispose all tracked disposables'
    );
  });

});

test.describe('PlanViewProvider - Event Handlers', () => {

  test('listens for panel disposal', () => {
    const source = planViewSource;

    assert.match(
      source,
      /onDidDispose\(\)\s*=>\s*this\.dispose\(\)/s,
      'must listen for panel disposal event'
    );
  });

  test('listens for webview messages', () => {
    const source = planViewSource;

    assert.match(
      source,
      /onDidReceiveMessage.*message.*switch/s,
      'must listen for messages from webview'
    );
  });

});

test.describe('PlanViewProvider - Error Handling', () => {

  test('shows error message from webview alerts', () => {
    const source = planViewSource;

    assert.match(
      source,
      /case 'alert':[\s\S]*showErrorMessage\(message\.text\)/s,
      'must show error message for webview alerts'
    );
  });

  test('shows info message for step execution', () => {
    const source = planViewSource;

    assert.match(
      source,
      /case 'executeStep':[\s\S]*showInformationMessage/s,
      'must show info message when executing step'
    );
  });

});

test.describe('PlanViewProvider - Comment Structure', () => {

  test('comment includes anchor with line numbers', () => {
    const source = planViewSource;

    assert.match(
      source,
      /anchor.*startLine.*endLine/s,
      'must include line numbers in comment anchor'
    );
  });

  test('comment includes selected text', () => {
    const source = planViewSource;

    assert.match(
      source,
      /anchor.*selectedText/s,
      'must include selected text in comment anchor'
    );
  });

  test('comment includes surrounding text', () => {
    const source = planViewSource;

    assert.match(
      source,
      /anchor.*surroundingText/s,
      'must include surrounding text in comment anchor'
    );
  });

  test('comment includes timestamp', () => {
    const source = planViewSource;

    assert.match(
      source,
      /createdAt.*number/s,
      'must include timestamp in comment'
    );
  });

});
