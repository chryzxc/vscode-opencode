import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function joinFromRoot(...parts) {
  return path.join(__dirname, '../../', ...parts);
}

function readSource(files, label) {
  return files.map(f => {
    try {
      return fs.readFileSync(f, 'utf-8');
    } catch (e) {
      throw new Error(`Failed to read ${label} at ${f}: ${e.message}`);
    }
  }).join('\n');
}

const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'SkillsPanelProvider.ts')],
  'SkillsPanelProvider.ts',
);

test('SkillsPanelProvider class exists with webview contract methods', () => {
  assert.match(providerSource, /export\s+class\s+SkillsPanelProvider/, 'should export SkillsPanelProvider class');
  assert.match(providerSource, /resolveWebviewView/, 'should implement resolveWebviewView for WebviewViewProvider');
  assert.match(providerSource, /static\s+readonly\s+viewType/, 'should define static viewType');
  assert.match(providerSource, /skillsPanel/, 'viewType should be opencode.skillsPanel');
});

test('SkillsPanelProvider.resolveWebviewView configures webview options and HTML', () => {
  assert.match(providerSource, /webviewView\.webview\.options\s*=\s*\{/, 'should set webview options');
  assert.match(providerSource, /enableScripts:\s*true/, 'should enable scripts in webview');
  assert.match(providerSource, /localResourceRoots/, 'should set localResourceRoots for security');
  assert.match(providerSource, /webviewView\.webview\.html\s*=\s*this\._getHtmlForWebview/, 'should set HTML content via _getHtmlForWebview');
});

test('SkillsPanelProvider subscribes to message events and skill changes', () => {
  assert.match(providerSource, /webviewView\.webview\.onDidReceiveMessage/, 'should subscribe to webview messages');
  assert.match(providerSource, /onDidChangeSkills/, 'should subscribe to skill changes');
  assert.match(providerSource, /_handleMessage/, 'should route messages to _handleMessage');
  assert.match(providerSource, /_sendSkillsToWebview/, 'should send initial skills after setup');
});

test('SkillsPanelProvider._handleMessage routes command messages to skillManagementService', () => {
  assert.match(providerSource, /switch\s*\(\s*message\.command/, 'should switch on message.command');
  assert.match(providerSource, /case\s+['"](enableSkill|disableSkill)['"]/, 'should handle enable/disable single skill');
  assert.match(providerSource, /case\s+['"](enableMultiple|disableMultiple)['"]/, 'should handle bulk operations');
  assert.match(providerSource, /case\s+['"](enableAll|disableAll)['"]/, 'should handle enable/disable all');
  assert.match(providerSource, /case\s+['"](applyPreset|refresh|openConfig)['"]/, 'should handle preset, refresh, config commands');
});

test('SkillsPanelProvider sends notification feedback to webview after operations', () => {
  assert.match(providerSource, /_showInfo/, 'should have _showInfo method for notifications');
  assert.match(providerSource, /postMessage\(\{\s*type:\s*['"](showNotification|notification)/, 'should post notification messages to webview');
  assert.match(providerSource, /Enabled skill|Disabled skill|Enabled \d+ skills/, 'should provide user-facing feedback messages');
});

test('SkillsPanelProvider prompts for server restart when preset is applied', () => {
  assert.match(providerSource, /applyPreset[\s\S]*_promptServerRestart|_promptServerRestart[\s\S]*applyPreset/, 'should call _promptServerRestart after applying preset');
  assert.match(providerSource, /vscode\.window\.showInformationMessage/, 'should show restart prompt dialog');
});

test('SkillsPanelProvider._sendSkillsToWebview sends current skill state', () => {
  assert.match(providerSource, /skillManagementService\.getSkills\(\)/, 'should get skills from service');
  assert.match(providerSource, /type:\s*['"](skillsData|skills)['"]/, 'should post message with type');
  assert.match(providerSource, /skills[\s\S]*stats|stats:[\s\S]*total/, 'should include both skills and stats in message');
});

test('SkillsPanelProvider.dispose cleans up resources and clears reference', () => {
  assert.match(providerSource, /dispose\(\)[\s\S]*SkillsPanelProvider\.currentPanel\s*=\s*undefined/, 'should clear currentPanel reference on dispose');
  assert.match(providerSource, /_disposables\.pop|_disposables\[[\s\S]*dispose/, 'should dispose all tracked disposables');
});

test('SkillsPanelProvider._getHtmlForWebview creates secure webview HTML with data injection', () => {
  assert.match(providerSource, /<!DOCTYPE html/, 'should output valid HTML document');
  assert.match(providerSource, /<div id="root"><\/div>/, 'should include #root div for React mount');
  assert.match(providerSource, /window\.__SKILLS_DATA__\s*=/, 'should inject __SKILLS_DATA__ global');
  assert.match(providerSource, /type="module"[\s\S]*src=/, 'should use module scripts for ES6');
  assert.match(providerSource, /nonce=/, 'should apply nonce to all scripts for CSP');
});

test('SkillsPanelProvider HTML includes CSP header with script, style, and resource rules', () => {
  assert.match(providerSource, /Content-Security-Policy/, 'should include CSP meta tag');
  assert.match(providerSource, /default-src\s+['"](none|'none')['"]/, 'should deny everything by default');
  assert.match(providerSource, /script-src[\s\S]*nonce/, 'should restrict scripts to nonce-verified only');
  assert.match(providerSource, /style-src[\s\S]*'unsafe-inline'/, 'should allow inline styles for dynamic content');
});

test('SkillsPanelProvider resolves asset URIs through webview.asWebviewUri', () => {
  assert.match(providerSource, /webview\.asWebviewUri[\s\S]*skills\.js/, 'should resolve skills.js via asWebviewUri');
  assert.match(providerSource, /webview\.asWebviewUri[\s\S]*chat\.css/, 'should resolve chat.css via asWebviewUri');
  assert.match(providerSource, /vscode\.Uri\.joinPath/, 'should use Uri.joinPath for safe path construction');
});

test('SkillsPanelProvider tracks currentPanel as static reference for focus', () => {
  assert.match(providerSource, /static\s+currentPanel.*SkillsPanelProvider\s*\|/, 'should have static currentPanel property');
});
