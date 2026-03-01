import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const diffProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'DiffReviewProvider.ts')],
  'DiffReviewProvider.ts',
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
  assert.match(htmlBody, /<script type="module" nonce="\$\{nonce\}" src="\$\{badgeChunkUri\}"><\/script>/, 'diff review should load badge.js as a module');
  assert.match(htmlBody, /<script type="module" nonce="\$\{nonce\}" src="\$\{scriptUri\}"><\/script>/, 'diff review should load diff-review.js as a module');
});
