import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const statusBarSource = readSource(
  [joinFromRoot('src', 'providers', 'StatusBarProvider.ts')],
  'StatusBarProvider.ts',
);

test('StatusBarProvider implements provider structure', () => {
  // Verify class definition
  assert.match(statusBarSource, /export\s+class\s+StatusBarProvider/, 'StatusBarProvider should be exported class');

  // Verify private fields
  assert.match(statusBarSource, /private\s+statusBarItem:\s*vscode\.StatusBarItem/, 'StatusBarProvider should have statusBarItem field');

  // Verify constructor takes serverManager
  assert.match(statusBarSource, /constructor\(private\s+serverManager:\s*OpencodeServerManager\)/, 'StatusBarProvider constructor should take OpencodeServerManager');
});

test('StatusBarProvider creates status bar item in constructor', () => {
  // Verify constructor implementation
  const constructorBody = extractFunctionBody(statusBarSource, 'constructor(');

  // Verify status bar item creation
  assert.match(constructorBody, /this\.statusBarItem\s*=\s*vscode\.window\.createStatusBarItem\(/, 'constructor should create status bar item');
  assert.match(constructorBody, /vscode\.StatusBarAlignment\.Right/, 'constructor should align to right');
  assert.match(constructorBody, /100,/, 'constructor should set priority to 100');

  // Verify command binding
  assert.match(constructorBody, /this\.statusBarItem\.command\s*=\s*["']opencode\.focus["']/, 'constructor should set click command to focus chat');

  // Verify initial status update
  assert.match(constructorBody, /this\.updateStatus\(\)/, 'constructor should call updateStatus');

  // Verify showing the item
  assert.match(constructorBody, /this\.statusBarItem\.show\(\)/, 'constructor should show status bar item');
});

test('StatusBarProvider implements status update logic', () => {
  // Verify updateStatus method
  assert.match(statusBarSource, /updateStatus\(\):\s*void/, 'StatusBarProvider should expose updateStatus method');
  const updateBody = extractFunctionBody(statusBarSource, 'updateStatus(): void');

  // Verify client check
  assert.match(updateBody, /const\s+client\s*=\s*this\.serverManager\.getClient\(\)/, 'updateStatus should get client from server manager');

  // Verify connected state
  assert.match(updateBody, /if\s*\(client\)\s*\{[\s\S]*this\.statusBarItem\.text\s*=\s*`\$\(robot\)\s+OpenCode`/, 'updateStatus should show robot icon when connected');
  assert.match(updateBody, /this\.statusBarItem\.tooltip\s*=\s*`OpenCode\s+connected\s*\(Port:\s*\$\{this\.serverManager\.getPort\(\)\}\)`/, 'updateStatus should show tooltip with port when connected');

  // Verify disconnected state
  assert.match(updateBody, /\}\s+else\s+\{[\s\S]*this\.statusBarItem\.text\s*=\s*["']\$\(debug-disconnect\)\s+OpenCode["']/, 'updateStatus should show disconnect icon when not connected');
  assert.match(updateBody, /this\.statusBarItem\.tooltip\s*=\s*["']OpenCode\s+disconnected["']/, 'updateStatus should show disconnected tooltip when not connected');
});

test('StatusBarProvider implements disposal', () => {
  // Verify dispose method
  assert.match(statusBarSource, /dispose\(\):\s*void/, 'StatusBarProvider should expose dispose method');
  const disposeBody = extractFunctionBody(statusBarSource, 'dispose(): void');

  assert.match(disposeBody, /this\.statusBarItem\.dispose\(\)/, 'dispose should call dispose on statusBarItem');
});

test('StatusBarProvider imports OpencodeServerManager', () => {
  // Verify import
  assert.match(statusBarSource, /import\s+\{\s*OpencodeServerManager\s*\}\s+from\s+/, 'StatusBarProvider should import OpencodeServerManager');
  assert.match(statusBarSource, /OpencodeServerManager/, 'StatusBarProvider should reference OpencodeServerManager');
});

test('StatusBarProvider uses VSCode API', () => {
  // Verify vscode import
  assert.match(statusBarSource, /import\s+\*\s+as\s+vscode\s+from\s+['"]vscode['"]/, 'StatusBarProvider should import vscode');

  // Verify usage of vscode.StatusBarAlignment
  assert.match(statusBarSource, /vscode\.StatusBarAlignment\.Right/, 'StatusBarProvider should use StatusBarAlignment.Right');
});

test('StatusBarProvider status icons use correct Codicon syntax', () => {
  // Verify connected icon
  const updateBody = extractFunctionBody(statusBarSource, 'updateStatus(): void');
  assert.match(updateBody, /\$\(robot\)/, 'StatusBarProvider should use $(robot) icon for connected state');

  // Verify disconnected icon
  assert.match(updateBody, /\$\(debug-disconnect\)/, 'StatusBarProvider should use $(debug-disconnect) icon for disconnected state');
});

test('StatusBarProvider integrates with OpencodeServerManager', () => {
  // Verify it calls serverManager methods
  const updateBody = extractFunctionBody(statusBarSource, 'updateStatus(): void');
  assert.match(updateBody, /this\.serverManager\.getClient\(\)/, 'updateStatus should call serverManager.getClient()');
  assert.match(updateBody, /this\.serverManager\.getPort\(\)/, 'updateStatus should call serverManager.getPort()');
});

test('StatusBarProvider has proper JSDoc documentation', () => {
  // Verify class-level documentation
  assert.match(statusBarSource, /\/\*\*[\s\S]*Manages\s+the\s+OpenCode\s+status\s+indicator/, 'StatusBarProvider should have class documentation');

  // Verify method documentation
  assert.match(statusBarSource, /\/\*\*[\s\S]*Updates\s+the\s+status\s+bar\s+item/, 'updateStatus should have JSDoc');
  assert.match(statusBarSource, /\/\*\*[\s\S]*Disposes\s+of\s+the\s+status\s+bar\s+provider/, 'dispose should have JSDoc');
});

test('StatusBarProvider documentation describes update triggers', () => {
  // Verify documentation mentions when to update
  assert.match(statusBarSource, /The\s+status\s+bar\s+should\s+be\s+updated\s+when:/, 'Documentation should describe when to update status');
  assert.match(statusBarSource, /Server\s+status\s+changes/, 'Documentation should mention server status changes');
  assert.match(statusBarSource, /Port\s+number\s+changes/, 'Documentation should mention port changes');
  assert.match(statusBarSource, /Connection\s+is\s+lost\/established/, 'Documentation should mention connection changes');
});

test('StatusBarProvider documentation describes display logic', () => {
  // Verify connected state documentation
  assert.match(statusBarSource, /Connected:\s*["']\$\(robot\)\s+OpenCode["']\s+icon\s+with\s+port\s+in\s+tooltip/, 'Documentation should describe connected state display');

  // Verify disconnected state documentation
  assert.match(statusBarSource, /Disconnected:\s*["']\$\(debug-disconnect\)\s+OpenCode["']\s+icon/, 'Documentation should describe disconnected state display');
});

test('StatusBarProvider click action focuses chat view', () => {
  // Verify command binding
  const constructorBody = extractFunctionBody(statusBarSource, 'constructor(');
  assert.match(constructorBody, /this\.statusBarItem\.command\s*=\s*["']opencode\.focus["']/, 'Status bar item should execute opencode.focus command on click');

  // Verify documentation describes interaction
  assert.match(statusBarSource, /Clicking\s+the\s+status\s+item\s+executes\s+`opencode\.focus`\s+command/, 'Documentation should describe click behavior');
});

test('StatusBarProvider status position and priority', () => {
  // Verify alignment and priority in constructor
  const constructorBody = extractFunctionBody(statusBarSource, 'constructor(');
  assert.match(constructorBody, /vscode\.window\.createStatusBarItem\(\s*vscode\.StatusBarAlignment\.Right,\s*100,?\s*\)/, 'Status bar item should be on right side with priority 100');

  // Verify documentation describes position
  assert.match(statusBarSource, /Position:\s+Right\s+side\s+of\s+status\s+bar/, 'Documentation should describe position');
  assert.match(statusBarSource, /Priority:\s*100\s*\(lower\s+priority\s*=\s+more\s+left\)/, 'Documentation should describe priority');
});

test('StatusBarProvider shows item immediately', () => {
  // Verify show() is called in constructor
  const constructorBody = extractFunctionBody(statusBarSource, 'constructor(');
  assert.match(constructorBody, /this\.statusBarItem\.show\(\)/, 'constructor should show status bar item');

  // Verify documentation describes immediate visibility
  assert.match(statusBarSource, /Shows\s+the\s+status\s+item\s+immediately/, 'Documentation should mention immediate visibility');
});

test('StatusBarProvider handles tooltip port display', () => {
  // Verify port is included in tooltip when connected
  const updateBody = extractFunctionBody(statusBarSource, 'updateStatus(): void');
  assert.match(updateBody, /tooltip\s*=\s*`OpenCode\s+connected\s*\(Port:\s*\$\{this\.serverManager\.getPort\(\)\}\)`/, 'Tooltip should include port number when connected');

  // Verify port is not in tooltip when disconnected
  assert.match(updateBody, /tooltip\s*=\s*["']OpenCode\s+disconnected["']/, 'Tooltip should not include port when disconnected');
});
