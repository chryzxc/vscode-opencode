import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('chat provider initializes and subscribes to file theme changes', () => {
  // Verify theme processor initialization in constructor
  assert.match(chatProviderSource, /this\.fileThemeProcessor\s*=\s*new\s*FileThemeProcessor\(context\)/, 'ChatViewProvider should initialize FileThemeProcessor');
  assert.match(chatProviderSource, /this\.fileThemeProcessor\.subscribe\(this\)/, 'ChatViewProvider should subscribe to theme changes');
  
  // Verify notify implementation triggers CSS send
  const notifyBody = extractFunctionBody(chatProviderSource, 'public notify(state: FileThemeProcessorState): void');
  assert.match(notifyBody, /if\s*\(state\s*===\s*"ready"\)\s*\{[\s\S]*this\.sendThemeDataToWebview\(\)/, 'notify should trigger sendThemeDataToWebview when ready');
});

test('chat provider generates and posts theme CSS to webview', () => {
  // Verify sendThemeDataToWebview implementation
  const sendThemeBody = extractFunctionBody(chatProviderSource, 'private async sendThemeDataToWebview(): Promise<void>');
  
  assert.match(sendThemeBody, /const\s+themeData\s*=\s*this\.fileThemeProcessor\.getThemeData\(\)/, 'should fetch theme data from processor');
  assert.match(sendThemeBody, /this\.cssGenerator\.getCss\(/, 'should generate CSS using CssGenerator');
  assert.match(sendThemeBody, /type:\s*"injectThemeCss"/, 'should post injectThemeCss message to webview');
  assert.match(sendThemeBody, /localResourceRoots:\s*roots/, 'should update localResourceRoots for font loading');
});

test('message handler injects theme CSS into webview DOM', () => {
  // Verify webview-side injection logic
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch',
  );

  assert.match(handlerBody, /case\s*[["']"]injectThemeCss[["']"]\s*:/, 'message handler should handle injectThemeCss');
  assert.match(handlerBody, /asString\(data\.css\)/, 'should extract CSS from message data.css');
  assert.match(handlerBody, /getElementById\(["["']]vscode-theme-icons["["']]\)/, 'should look for existing theme style tag');
  assert.match(handlerBody, /createElement\(["["']]style["["']]\)/, 'should create style element');
  assert.match(handlerBody, /styleTag\.id\s*=\s*["["']]vscode-theme-icons["["']]/, 'style element should have specific ID vscode-theme-icons');
});

test('FileIcon component applies correct theme CSS classes', () => {
  // Verify component rendering logic in MessageComponents.tsx
  // We check the source directly since extractFunctionBody can be finicky with React components
  assert.match(messageComponentsSource, /export function FileIcon/, 'FileIcon component should be exported');
  assert.match(messageComponentsSource, /className=\{cn\(/, 'FileIcon should use cn for combining classes');
  assert.match(messageComponentsSource, /"file-icon"/, 'FileIcon should always have base file-icon class');
  assert.match(messageComponentsSource, /cleanKey\(fileName\)/, 'FileIcon should use fileName for matching');
  assert.match(messageComponentsSource, /cleanKey\(ext\)/, 'FileIcon should use extension for matching');
});
