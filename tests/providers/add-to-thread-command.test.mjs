import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

/**
 * "Add to OpenCode Thread" Context Menu — Integration Tests
 *
 * Guards the context-menu feature that lets users add editor selections, whole
 * files, or explorer file/folder selections to the active chat thread.
 * Parity with Codex's "Add to Thread" behavior.
 *
 * Regression triggers:
 *   - Command missing from package.json contributes
 *   - Menu items missing from editor/context or explorer/context
 *   - Handler not covering folder recursion
 *   - MAX_FILES cap removed (unbounded file expansion)
 */

const extensionSource = readSource(
  [joinFromRoot('src', 'extension.ts')],
  'extension.ts',
);

const packageSource = readSource(
  [joinFromRoot('package.json')],
  'package.json',
);

// ============================================================================
// Layer 1: Command Registration (package.json)
// ============================================================================

describe('package.json command contribution', () => {
  test('opencode.addToThread command is registered', () => {
    assert.match(
      packageSource,
      /"command":\s*"opencode\.addToThread"/,
      'opencode.addToThread must be in contributes.commands',
    );
    assert.match(
      packageSource,
      /"title":\s*"OpenCode: Add to Thread"/,
      'command title must be "OpenCode: Add to Thread"',
    );
  });
});

// ============================================================================
// Layer 2: Menu Contributions (package.json)
// ============================================================================

describe('package.json menu contributions', () => {
  test('editor/context includes addToThread', () => {
    // The editor/context menu must include addToThread so users can right-click
    // in the editor (with or without a selection) to add content to the thread.
    const editorContextMatch = packageSource.match(
      /"editor\/context":\s*\[([\s\S]*?)\]/,
    );
    assert.ok(editorContextMatch, 'editor/context menu must exist in contributes.menus');
    assert.match(
      editorContextMatch[1],
      /"command":\s*"opencode\.addToThread"/,
      'editor/context must include opencode.addToThread command',
    );
    assert.match(
      editorContextMatch[1],
      /"group":\s*"opencode"/,
      'addToThread must be in the "opencode" group',
    );
  });

  test('explorer/context includes addToThread', () => {
    // The explorer/context menu must include addToThread so users can right-click
    // files or folders in the file explorer to add them to the thread.
    const explorerContextMatch = packageSource.match(
      /"explorer\/context":\s*\[([\s\S]*?)\]/,
    );
    assert.ok(explorerContextMatch, 'explorer/context menu must exist in contributes.menus');
    assert.match(
      explorerContextMatch[1],
      /"command":\s*"opencode\.addToThread"/,
      'explorer/context must include opencode.addToThread command',
    );
  });

  test('existing sendSelection editor/context entry is preserved', () => {
    const editorContextMatch = packageSource.match(
      /"editor\/context":\s*\[([\s\S]*?)\]/,
    );
    assert.ok(editorContextMatch);
    assert.match(
      editorContextMatch[1],
      /"command":\s*"opencode\.sendSelection"/,
      'sendSelection must still be in editor/context (Ctrl+L/Cmd+L flow)',
    );
    assert.match(
      editorContextMatch[1],
      /"when":\s*"editorHasSelection"/,
      'sendSelection must still gate on editorHasSelection',
    );
  });
});

// ============================================================================
// Layer 3: Handler Implementation (extension.ts)
// ============================================================================

describe('addToThread handler registration', () => {
  test('command is registered via registerCommand', () => {
    assert.match(
      extensionSource,
      /registerCommand\(\s*"opencode\.addToThread"/,
      'opencode.addToThread must be registered via vscode.commands.registerCommand',
    );
  });

  test('handler accepts optional Uri or Uri[] argument (explorer multi-select)', () => {
    assert.match(
      extensionSource,
      /"opencode\.addToThread",\s*async\s*\(input\?:\s*vscode\.Uri\s*\|\s*vscode\.Uri\[\]\)\s*=>/,
      'handler must accept optional Uri | Uri[] for explorer context',
    );
  });
});

describe('addToThread editor path (no Uri argument)', () => {
  test('uses activeTextEditor when no Uri argument is provided', () => {
    assert.match(
      extensionSource,
      /uris\.length\s*===\s*0[\s\S]*?vscode\.window\.activeTextEditor/,
      'handler must fall back to activeTextEditor when no explorer Uri is provided',
    );
  });

  test('with selection: adds context with file, lineInfo, content, languageId', () => {
    // When the editor has a selection, the handler must extract:
    // file (relative path), lineInfo (e.g. "12-18"), content (selected text), languageId
    assert.match(
      extensionSource,
      /selection\.trim\(\)\.length\s*>\s*0[\s\S]*?chatViewProvider\.addContext\(\s*\{[\s\S]*?file,[\s\S]*?lineInfo,[\s\S]*?content:\s*selection,[\s\S]*?languageId/,
      'editor selection path must call addContext with file, lineInfo, content, languageId',
    );
  });

  test('lineInfo is computed from editor.selection start/end lines', () => {
    assert.match(
      extensionSource,
      /startLine\s*=\s*editor\.selection\.start\.line\s*\+\s*1/,
      'startLine must be 1-indexed (editor.selection.start.line + 1)',
    );
    assert.match(
      extensionSource,
      /endLine\s*=\s*editor\.selection\.end\.line\s*\+\s*1/,
      'endLine must be 1-indexed',
    );
    assert.match(
      extensionSource,
      /startLine\s*===\s*endLine\s*\?\s*`\$\{startLine\}`\s*:\s*`\$\{startLine\}-\$\{endLine\}`/,
      'lineInfo must be single number for single-line, range for multi-line',
    );
  });

  test('without selection: adds whole-file context (no content field)', () => {
    // When there's no selection, the handler adds a file reference without content
    // — the ChatViewProvider reads the file from disk.
    assert.match(
      extensionSource,
      /else\s*\{[\s\S]*?chatViewProvider\.addContext\(\s*\{[\s\S]*?file,[\s\S]*?languageId[^}]*\}\s*\)/,
      'no-selection path must call addContext with file and languageId only',
    );
  });
});

describe('addToThread explorer path (Uri argument)', () => {
  test('normalizes single Uri to array', () => {
    assert.match(
      extensionSource,
      /Array\.isArray\(input\)\s*\?\s*input\s*:\s*\[input\]/,
      'handler must normalize single Uri to array for uniform processing',
    );
  });

  test('detects directories via fs.stat and recurses with findFiles', () => {
    assert.match(
      extensionSource,
      /vscode\.workspace\.fs\.stat\(uri\)/,
      'handler must stat each Uri to check if directory',
    );
    assert.match(
      extensionSource,
      /stat\.type\s*===\s*vscode\.FileType\.Directory/,
      'handler must check FileType.Directory',
    );
    assert.match(
      extensionSource,
      /vscode\.workspace\.findFiles\(/,
      'handler must use findFiles for folder recursion',
    );
    assert.match(
      extensionSource,
      /RelativePattern\(/,
      'handler must use RelativePattern for scoped file search',
    );
  });

  test('excludes common non-source directories from folder recursion', () => {
    // node_modules, .git, dist, build, out, .next, .cache must be excluded
    assert.match(
      extensionSource,
      /node_modules/,
      'must exclude node_modules',
    );
    assert.match(
      extensionSource,
      /\.git/,
      'must exclude .git',
    );
    assert.match(
      extensionSource,
      /dist|build|out/,
      'must exclude build output directories',
    );
  });

  test('enforces MAX_FILES cap to prevent unbounded expansion', () => {
    assert.match(
      extensionSource,
      /MAX_FILES\s*=\s*\d+/,
      'handler must define a MAX_FILES constant',
    );
    assert.match(
      extensionSource,
      /collectedUris\.length\s*>=\s*MAX_FILES/,
      'handler must break when MAX_FILES is reached',
    );
    assert.match(
      extensionSource,
      /collectedUris\.length\s*>\s*MAX_FILES[\s\S]*?showWarningMessage/,
      'handler must warn the user when MAX_FILES is exceeded',
    );
    assert.match(
      extensionSource,
      /collectedUris\.length\s*=\s*MAX_FILES/,
      'handler must truncate to MAX_FILES',
    );
  });

  test('uses workspace-relative paths when adding file context', () => {
    assert.match(
      extensionSource,
      /vscode\.workspace\.asRelativePath\(fileUri\)/,
      'handler must convert absolute Uris to workspace-relative paths',
    );
    assert.match(
      extensionSource,
      /chatViewProvider\.addContext\(\s*\{\s*file\s*\}\s*\)/,
      'explorer file path must call addContext with relative file path',
    );
  });

  test('focuses chat view after adding context', () => {
    assert.match(
      extensionSource,
      /executeCommand\(\s*"opencode\.chatView\.focus"\s*\)/,
      'handler must focus the chat view after adding context (both editor and explorer paths)',
    );
  });

  test('handles stat failures gracefully (falls back to adding the Uri)', () => {
    assert.match(
      extensionSource,
      /catch\s*\{[\s\S]*?collectedUris\.push\(uri\)/,
      'handler must push the Uri directly if fs.stat fails',
    );
  });
});
