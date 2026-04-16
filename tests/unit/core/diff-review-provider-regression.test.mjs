/**
 * DiffReviewProvider Regression Tests
 *
 * These tests prevent regressions in code diff review functionality.
 * Diff review is critical for approving/rejecting code changes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const diffReviewSource = readSource(
  [joinFromRoot('src', 'providers', 'DiffReviewProvider.ts')],
  'DiffReviewProvider.ts',
);

test.describe('DiffReviewProvider - Panel Creation', () => {

  test('has viewType identifier', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /public static readonly viewType\s*=\s*"opencode\.diffReview"/s,
      'must define viewType for diff review'
    );
  });

  test('tracks current panel instance', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /private static currentPanel.*DiffReviewProvider/s,
      'must track current panel instance'
    );
  });

  test('creates webview panel', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /createWebviewPanel\(DiffReviewProvider\.viewType/s,
      'must create webview panel for diff review'
    );
  });

});

test.describe('DiffReviewProvider - Diff Data Structure', () => {

  test('defines DiffFile interface', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffFile[\s\S]*path.*added.*deleted.*type.*hunks/s,
      'must define DiffFile interface'
    );
  });

  test('defines DiffHunk interface', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffHunk[\s\S]*header.*lines/s,
      'must define DiffHunk interface'
    );
  });

  test('defines DiffData interface', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffData[\s\S]*files.*comments/s,
      'must define DiffData interface'
    );
  });

  test('defines DiffComment interface', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffComment[\s\S]*id.*anchor.*text.*createdAt/s,
      'must define DiffComment interface'
    );
  });

});

test.describe('DiffReviewProvider - Git Integration', () => {

  test('handles approveDiff message', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /case "approveDiff":[\s\S]*git.*add/s,
      'must handle approveDiff message'
    );
  });

  test('executes git add for approved files', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /execFile\("git",\s*\["add",/s,
      'must execute git add command'
    );
  });

  test('uses workspace folder as CWD', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /cwd.*workspaceFolders\[0\]\.uri\.fsPath/s,
      'must use workspace folder as git working directory'
    );
  });

  test('handles relative file paths', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /path\.isAbsolute\(filePath\).*path\.join.*workspaceFolders/s,
      'must resolve relative file paths to workspace'
    );
  });

  test('shows success message on approval', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /showInformationMessage.*Approved and staged:/s,
      'must show success message when file is approved'
    );
  });

  test('shows error message on approval failure', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /err.*showErrorMessage.*Failed to approve.*git add/s,
      'must show error message when git add fails'
    );
  });

});

test.describe('DiffReviewProvider - Diff Rejection', () => {

  test('handles rejectDiff message', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /case "rejectDiff":[\s\S]*filePath/s,
      'must handle rejectDiff message'
    );
  });

});

test.describe('DiffReviewProvider - View State Management', () => {

  test('listens to view state changes', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /onDidChangeViewState[\s\S]*_panel\.visible/s,
      'must listen to view state changes'
    );
  });

  test('rebuilds HTML when panel becomes visible', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /onDidChangeViewState[\s\S]*webview\.html\s*=\s*_getHtmlForWebview/s,
      'must rebuild HTML when panel becomes visible'
    );
  });

});

test.describe('DiffReviewProvider - Webview HTML', () => {

  test('has _getHtmlForWebview method', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /private _getHtmlForWebview\(webview.*data/s,
      'must provide _getHtmlForWebview method'
    );
  });

  test('injects diff data into webview', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /window\.__DIFF_DATA__.*JSON\.stringify\(data\)/s,
      'must inject diff data into webview global scope'
    );
  });

});

test.describe('DiffReviewProvider - Disposal', () => {

  test('has dispose method', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /public dispose\(\)/s,
      'must provide dispose method'
    );
  });

  test('clears current panel reference', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /dispose[\s\S]*currentPanel\s*=\s*undefined/s,
      'must clear current panel reference on disposal'
    );
  });

  test('disposes webview panel', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /dispose[\s\S]*_panel\.dispose\(\)/s,
      'must dispose webview panel on disposal'
    );
  });

  test('disposes all disposables', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /dispose[\s\S]*while.*_disposables\.length.*\.dispose\(\)/s,
      'must dispose all tracked disposables'
    );
  });

});

test.describe('DiffReviewProvider - Event Handlers', () => {

  test('listens for panel disposal', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /onDidDispose\(\)\s*=>\s*this\.dispose\(\)/s,
      'must listen for panel disposal event'
    );
  });

  test('listens for webview messages', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /onDidReceiveMessage.*message.*switch/s,
      'must listen for messages from webview'
    );
  });

});

test.describe('DiffReviewProvider - Diff File Properties', () => {

  test('DiffFile includes path property', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffFile[\s\S]*path:\s*string/s,
      'must include path property in DiffFile'
    );
  });

  test('DiffFile includes added lines count', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffFile[\s\S]*added:\s*number/s,
      'must include added lines count in DiffFile'
    );
  });

  test('DiffFile includes deleted lines count', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffFile[\s\S]*deleted:\s*number/s,
      'must include deleted lines count in DiffFile'
    });
  });

  test('DiffFile includes type property', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffFile[\s\S]*type\?:\s*'create'\s*\|\s*'modify'\s*\|\s*'delete'/s,
      'must include type property in DiffFile'
    );
  });

  test('DiffFile includes hunks array', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffFile[\s\S]*hunks:\s*DiffHunk\[\]/s,
      'must include hunks array in DiffFile'
    );
  });

});

test.describe('DiffReviewProvider - Diff Hunk Properties', () => {

  test('DiffHunk includes header', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffHunk[\s\S]*header:\s*string/s,
      'must include header in DiffHunk'
    );
  });

  test('DiffHunk includes lines array', () => {
    const source = diffReviewSource;

    assert.match(
      source,
      /interface DiffHunk[\s\S]*lines:\s*string\[\]/s,
      'must include lines array in DiffHunk'
    );
  });

});
