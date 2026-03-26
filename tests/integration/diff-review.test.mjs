import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const diffProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'DiffReviewProvider.ts')],
  'DiffReviewProvider.ts',
);

const diffShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'diff-review', 'DiffReviewShell.tsx')],
  'DiffReviewShell.tsx',
);

test('diff review HTML wiring injects diff payload and required bundled assets', () => {
  // Verify diff review webview receives bootstrap payload and compiled assets.
  const htmlBody = extractFunctionBody(
    diffProviderSource,
    'private _getHtmlForWebview(webview: vscode.Webview, data: DiffData)',
  );

  assert.match(htmlBody, /window\.__DIFF_DATA__\s*=\s*\$\{diffDataJson\}/, 'diff review webview must inject __DIFF_DATA__ payload');
  assert.match(htmlBody, /<div id="root"><\/div>/, 'diff review webview HTML should provide a root mount node');
  assert.match(htmlBody, /script-src\s+\$\{webview\.cspSource\}/, 'diff review webview CSP must include webview.cspSource in script-src');
  assert.match(htmlBody, /<script type="module" nonce="\$\{nonce\}" src="\$\{scriptUri\}"><\/script>/, 'diff review should load diff-review.js as a module');
  assert.doesNotMatch(htmlBody, /badge\.js/, 'diff review MUST NOT manually load badge.js (handled by Vite)');
});

test('diff review shell adheres to centralized VS Code API acquisition safety', () => {
  // Verify DiffReviewShell does not call acquireVsCodeApi directly and imports from correct lib
  assert.match(diffShellSource, /import\s+vscode\s+from\s+['"]@\/chat\/lib\/vscode['"]/, 'DiffReviewShell must import vscode from centralized lib');
  assert.doesNotMatch(diffShellSource, /window\.acquireVsCodeApi\?\.\(\)/, 'DiffReviewShell must NOT call acquireVsCodeApi directly');
});
