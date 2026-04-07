/**
 * Hot Reload Feature Tests
 *
 * Tests for the development hot reload functionality
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

// Read source files
const devScriptSource = readSource(
  [joinFromRoot('scripts', 'dev-simple.mjs')],
  'dev-simple.mjs',
);

test('Hot reload: dev script exists and is executable', () => {
  assert.match(
    devScriptSource,
    /#!\/usr\/bin\/env node/,
    'Dev script should have shebang for Node.js execution'
  );
  assert.match(
    devScriptSource,
    /Hot Reload Development/,
    'Dev script should have descriptive title'
  );
});

test('Hot reload: dev script watches extension source files', () => {
  assert.match(
    devScriptSource,
    /watchDirectory.*EXTENSION_SRC|watch\(.*src.*['"]\)/,
    'Dev script should watch extension source directory'
  );
  assert.match(
    devScriptSource,
    /src['"]/s,
    'Dev script should reference src directory'
  );
});

test('Hot reload: dev script watches webview source files', () => {
  assert.match(
    devScriptSource,
    /watchDirectory.*WEBVIEW_SRC|watch\(.*webview/,
    'Dev script should watch webview source directory'
  );
  assert.match(
    devScriptSource,
    /webview\/shared\/src/,
    'Dev script should reference webview src directory'
  );
});

test('Hot reload: dev script starts extension build process', () => {
  assert.match(
    devScriptSource,
    /esbuild\.config\.js.*--watch/,
    'Dev script should start esbuild in watch mode'
  );
  assert.match(
    devScriptSource,
    /extensionWatch|startProcess.*extension/,
    'Dev script should track extension watch process'
  );
});

test('Hot reload: dev script starts webview build process', () => {
  assert.match(
    devScriptSource,
    /npm.*run.*dev|vite/,
    'Dev script should start webview dev server (Vite)'
  );
  assert.match(
    devScriptSource,
    /webviewWatch|startProcess.*webview/,
    'Dev script should track webview watch process'
  );
});

test('Hot reload: dev script implements file change detection', () => {
  assert.match(
    devScriptSource,
    /watch\(|watchDirectory/,
    'Dev script should use file watching functionality'
  );
  assert.match(
    devScriptSource,
    /onChange|eventType.*change/,
    'Dev script should handle file change events'
  );
});

test('Hot reload: dev script triggers reload on changes', () => {
  assert.match(
    devScriptSource,
    /scheduleReload|triggerReload/,
    'Dev script should trigger reload when changes detected'
  );
  assert.match(
    devScriptSource,
    /setTimeout|RELOAD_DELAY|debounce/,
    'Dev script should debounce reload to avoid excessive rebuilds'
  );
});

test('Hot reload: dev script creates reload marker', () => {
  assert.match(
    devScriptSource,
    /\.hotreload_marker|\.rebuild_marker/,
    'Dev script should create marker file to signal reload'
  );
  assert.match(
    devScriptSource,
    /writeFileSync|unlinkSync/,
    'Dev script should write and immediately delete marker file'
  );
});

test('Hot reload: dev script handles cleanup on exit', () => {
  assert.match(
    devScriptSource,
    /cleanup|SIGINT|SIGTERM/,
    'Dev script should handle cleanup on exit signals'
  );
  assert.match(
    devScriptSource,
    /\.kill\(\)|proc\.kill/,
    'Dev script should kill child processes on cleanup'
  );
});

test('Hot reload: dev script provides user feedback', () => {
  assert.match(
    devScriptSource,
    /console\.log|log\(/,
    'Dev script should log status messages'
  );
  assert.match(
    devScriptSource,
    /Development.*ready|watchers.*active/i,
    'Dev script should confirm when development mode is active'
  );
});

test('Hot reload: package.json includes dev scripts', () => {
  const pkgSource = readSource(
    [joinFromRoot('package.json')],
    'package.json'
  );

  assert.match(
    pkgSource,
    /"dev":\s*"node scripts\/dev-simple\.mjs"/,
    'package.json should include dev script'
  );
  assert.match(
    pkgSource,
    /"dev:full":\s*"node scripts\/dev-hotreload\.mjs"/,
    'package.json should include full dev script with chokidar'
  );
});

test('Hot reload: launch.json includes hot reload configuration', () => {
  const launchSource = readSource(
    [joinFromRoot('.vscode', 'launch.json')],
    'launch.json'
  );

  assert.match(
    launchSource,
    /"name":\s*"Run Extension \(Hot Reload\)"/,
    'launch.json should include hot reload configuration'
  );
  assert.match(
    launchSource,
    /"preLaunchTask":\s*"npm: dev"/,
    'Hot reload config should use dev task as pre-launch step'
  );
});

test('Hot reload: tasks.json includes dev background task', () => {
  const tasksSource = readSource(
    [joinFromRoot('.vscode', 'tasks.json')],
    'tasks.json'
  );

  assert.match(
    tasksSource,
    /"script":\s*"dev"/,
    'tasks.json should include dev script task'
  );
  assert.match(
    tasksSource,
    /"isBackground":\s*true/,
    'Dev task should run in background'
  );
  assert.match(
    tasksSource,
    /"isDefault":\s*true/,
    'Dev task should be default build task'
  );
});

test('Hot reload: esbuild config supports watch mode', () => {
  const esbuildSource = readSource(
    [joinFromRoot('esbuild.config.js')],
    'esbuild.config.js'
  );

  assert.match(
    esbuildSource,
    /process\.argv\.includes\(['"]--watch['"]\)|watch/,
    'esbuild config should detect watch flag'
  );
  assert.match(
    esbuildSource,
    /ctx\.watch\(\)/,
    'esbuild config should enable watch mode when flag is present'
  );
});

test('Hot reload: webview uses Vite with watch capabilities', () => {
  const viteConfigSource = readSource(
    [joinFromRoot('webview', 'shared', 'vite.config.ts')],
    'vite.config.ts'
  );

  assert.match(
    viteConfigSource,
    /export default defineConfig/,
    'Vite config should export configuration'
  );

  const webviewPackage = readSource(
    [joinFromRoot('webview', 'shared', 'package.json')],
    'webview package.json'
  );

  assert.match(
    webviewPackage,
    /"dev":\s*"vite"/,
    'Webview package should include dev script using Vite'
  );
});
