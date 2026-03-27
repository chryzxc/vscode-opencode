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

const skillsShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'skills', 'SkillsShell.tsx')],
  'SkillsShell.tsx',
);

const skillsEntrySource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'skills', 'index.tsx')],
  'skills/index.tsx',
);

const skillsPanelProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'SkillsPanelProvider.ts')],
  'SkillsPanelProvider.ts',
);

test('Skills Shell exports React component with window.__SKILLS_DATA__ consumption', () => {
  assert.match(skillsShellSource, /export\s+function\s+SkillsShell/, 'SkillsShell should be a named export');
  assert.match(skillsShellSource, /window\.__SKILLS_DATA__/, 'SkillsShell should access window.__SKILLS_DATA__');
  assert.match(skillsShellSource, /window\.__SKILLS_DATA__\.skills/, 'SkillsShell should destructure skills array');
  assert.match(skillsShellSource, /window\.__SKILLS_DATA__\.stats/, 'SkillsShell should destructure stats object');
});

test('Skills Shell renders stats pills and presets row', () => {
  assert.match(skillsShellSource, /Total/, 'should render Total stat pill');
  assert.match(skillsShellSource, /Enabled/, 'should render Enabled stat pill');
  assert.match(skillsShellSource, /Disabled/, 'should render Disabled stat pill');
  assert.match(skillsShellSource, /Global/, 'should render Global stat pill');
  assert.match(skillsShellSource, /Project/, 'should render Project stat pill');
  assert.match(skillsShellSource, /Minimal/, 'should render Minimal preset');
  assert.match(skillsShellSource, /Development/, 'should render Development preset');
  assert.match(skillsShellSource, /Security/, 'should render Security preset');
  assert.match(skillsShellSource, /All Skills/, 'should render All Skills preset');
});

test('Skills Shell includes search input with clear button', () => {
  assert.match(skillsShellSource, /placeholder="Search skills"/, 'should have search placeholder');
  assert.match(skillsShellSource, /Search\s*Icon/, 'should render search icon');
  assert.match(skillsShellSource, /search\.length\s*>\s*0/, 'should show clear button when search is not empty');
});

test('Skills Shell renders batch actions with multi-select', () => {
  assert.match(skillsShellSource, /selectedSkills/, 'should track selected skills');
  assert.match(skillsShellSource, /type="checkbox"/, 'should render checkboxes for multi-select');
  assert.match(skillsShellSource, /Enable\s*selected|Enable\s+\d+/, 'should have enable button for selected skills');
  assert.match(skillsShellSource, /Disable\s*selected|Disable\s+\d+/, 'should have disable button for selected skills');
  assert.match(skillsShellSource, /Clear\s*selection/, 'should have clear selection button');
});

test('Skills Shell implements vscodeApi message protocol for skill operations', () => {
  assert.match(skillsShellSource, /vscodeApi\.postMessage/, 'should use vscodeApi to post messages');
  assert.match(skillsShellSource, /enableSkill|enable\w+/, 'should post messages for enable operations');
  assert.match(skillsShellSource, /disableSkill|disable\w+/, 'should post messages for disable operations');
  assert.match(skillsShellSource, /enableMultiple|disableMultiple/, 'should support bulk operations');
  assert.match(skillsShellSource, /applyPreset/, 'should support preset application via postMessage');
  assert.match(skillsShellSource, /command:\s*['"]\w+['"]|type:\s*['"]\w+['"]/, 'should use typed message protocol');
});

test('Skills Shell renders scrollable skill list with name, source badge, and toggle', () => {
  assert.match(skillsShellSource, /map\s*\(\s*.*skill/, 'should map over skills array');
  assert.match(skillsShellSource, /skill\.name/, 'should render skill name');
  assert.match(skillsShellSource, /Badge/, 'should render Badge component for skill source');
  assert.match(skillsShellSource, /skill\.source/, 'should display skill source (global|project)');
  assert.match(skillsShellSource, /Switch/, 'should render Switch component for toggle');
  assert.match(skillsShellSource, /skill\.enabled/, 'should track skill enabled state');
});

test('Skills Shell displays toast notifications for user feedback', () => {
  assert.match(skillsShellSource, /toast|Toast/, 'should use toast notifications');
  assert.match(skillsShellSource, /(message|msg)/, 'should display notification messages');
});

test('skills/index.tsx mounts SkillsShell into #root with CSS import', () => {
  assert.match(skillsEntrySource, /import.*SkillsShell/, 'should import SkillsShell component');
  assert.match(skillsEntrySource, /import.*css/, 'should import CSS');
  assert.match(skillsEntrySource, /ReactDOM\.createRoot/, 'should use ReactDOM.createRoot');
  assert.match(skillsEntrySource, /#root/, 'should mount into #root element');
  assert.match(skillsEntrySource, /<SkillsShell\s*\/>/, 'should render SkillsShell component');
});

test('SkillsPanelProvider._getHtmlForWebview includes shared chat.css and skills.js', () => {
  assert.match(skillsPanelProviderSource, /chat\.css/, 'should reference chat.css stylesheet');
  assert.match(skillsPanelProviderSource, /skills\.js/, 'should reference skills.js bundle');
  assert.match(skillsPanelProviderSource, /asWebviewUri/, 'should use asWebviewUri to resolve paths');
  assert.match(skillsPanelProviderSource, /<link\s+href=/, 'should include link tag for CSS');
  assert.match(skillsPanelProviderSource, /<script.*skills\.js/, 'should include script tag for skills.js');
});

test('SkillsPanelProvider initializes window.__SKILLS_DATA__ with skills and stats', () => {
  assert.match(skillsPanelProviderSource, /window\.__SKILLS_DATA__\s*=/, 'should inject __SKILLS_DATA__ into window');
  assert.match(skillsPanelProviderSource, /JSON\.stringify/, 'should JSON stringify initial data');
  assert.match(skillsPanelProviderSource, /skills/, 'should include skills in initial data');
  assert.match(skillsPanelProviderSource, /stats:/, 'should include stats object');
  assert.match(skillsPanelProviderSource, /total|enabled|disabled|global|project/, 'should calculate stats for total, enabled, disabled, global, project');
});

test('SkillsPanelProvider implements message protocol handlers', () => {
  assert.match(skillsPanelProviderSource, /enableSkill|disableSkill/, 'should handle enable/disable commands');
  assert.match(skillsPanelProviderSource, /enableMultiple|disableMultiple/, 'should handle bulk operations');
  assert.match(skillsPanelProviderSource, /enableAll|disableAll/, 'should handle enable/disable all');
  assert.match(skillsPanelProviderSource, /applyPreset/, 'should handle preset application');
  assert.match(skillsPanelProviderSource, /skillManagementService/, 'should delegate to SkillManagementService');
});

test('SkillsPanelProvider applies CSP with proper nonce for scripts and styles', () => {
  assert.match(skillsPanelProviderSource, /Content-Security-Policy/, 'should include CSP meta tag');
  assert.match(skillsPanelProviderSource, /script-src.*nonce/, 'should restrict script-src with nonce');
  assert.match(skillsPanelProviderSource, /style-src.*'unsafe-inline'/, 'should allow style-src from webview source');
  assert.match(skillsPanelProviderSource, /getNonce/, 'should generate nonce for security');
});
