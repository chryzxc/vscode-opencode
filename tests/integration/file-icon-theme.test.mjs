import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources(
  [
    joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
    joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'),
    joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'types.ts')
  ],
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
const markdownRendererSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'MarkdownRenderer.tsx')],
  'MarkdownRenderer.tsx',
);
const fileIconsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'fileIcons.ts')],
  'fileIcons.ts',
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
  const sendThemeBody = extractFunctionBody(chatProviderSource, 'sendThemeDataToWebview(): Promise<void>');
  
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

  assert.match(handlerBody, /case\s*["']injectThemeCss["']\s*:/, 'message handler should handle injectThemeCss');
  assert.match(handlerBody, /asString\(data\.css\)/, 'should extract CSS from message data.css');
  assert.match(handlerBody, /getElementById\(["']vscode-theme-icons["']\)/, 'should look for existing theme style tag');
  assert.match(handlerBody, /createElement\(["']style["']\)/, 'should create style element');
  assert.match(handlerBody, /styleTag\.id\s*=\s*["']vscode-theme-icons["']/, 'style element should have specific ID vscode-theme-icons');
});

test('FileIcon component applies correct theme CSS classes', () => {
  assert.match(messageComponentsSource, /export function FileIcon/, 'FileIcon component should be exported');
  assert.match(messageComponentsSource, /className=\{cn\(/, 'FileIcon should use cn for combining classes');
  assert.match(messageComponentsSource, /"file-icon"/, 'FileIcon should always have base file-icon class');
  assert.match(messageComponentsSource, /getFileIconThemeClasses/, 'FileIcon should reuse the shared icon class helper');
  assert.match(fileIconsSource, /fileName,\s*baseName,\s*\.\.\.extensionKeys/, 'shared file icon helper should match filename, base name, and extension suffixes');
  assert.match(fileIconsSource, /typescriptreact|javascriptreact|markdown/, 'shared file icon helper should include common theme alias keys');
  assert.match(fileIconsSource, /getFileIconKeys\(filePath\)\.map\(\(key\)\s*=>\s*`file-icon-type-\$\{cleanFileIconKey\(key\)\}`\)/, 'shared file icon helper should apply theme CSS classes for each candidate key');
  assert.match(fileIconsSource, /\.replace\(\/\\\.\/g,\s*['"-]-['"-]\)/, 'shared cleanFileIconKey should replace dots with dashes to match library CSS class names');
  assert.match(messageComponentsSource, /file-icon-svg/, 'FileIcon should have an SVG fallback for when theme CSS provides no icon');
});

test('MarkdownRenderer reuses the shared file icon helpers', () => {
  assert.match(markdownRendererSource, /from '\.\/fileIcons'/, 'MarkdownRenderer should import the shared file icon helpers');
  assert.match(markdownRendererSource, /getFileIconThemeClasses/, 'MarkdownRenderer should use shared theme class logic');
  assert.match(markdownRendererSource, /makeFileIconSvgMarkup/, 'MarkdownRenderer should use the shared SVG fallback logic');
});

test('chat webview CSP allows icon theme font files', () => {
  assert.match(
    chatProviderSource,
    /font-src\s+\$\{webview\.cspSource\}/,
    'Chat webview CSP must allow VS Code icon theme font files to avoid missing-glyph squares',
  );
});
