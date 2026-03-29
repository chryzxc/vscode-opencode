import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);
const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('chat shell keeps three-panel responsive layout with mobile summary and desktop right panel', () => {
  // Verify left history panel, center conversation column, and right desktop panel structure.
  assert.match(chatShellSource, /<HistorySidebar\s*\/>/, 'chat shell should include history sidebar component');
  assert.match(chatShellSource, /<StickyHeader\s*\/>/, 'chat shell should include sticky header');
  assert.match(chatShellSource, /<MobileRightSummary\s*\/>/, 'chat shell should include mobile right-summary surface');
  assert.match(chatShellSource, /className="oc-right-panel\s+hidden[^"]*\[@media\(min-width:1100px\)\]:block"/, 'desktop right panel should be hidden below 1100px and shown at >=1100px');
  assert.match(chatShellSource, /w-\[368px\]/, 'right panel width should be 368px (increased by 15%)');
  assert.match(chatShellSource, /<ActiveTaskPanel\s*\/>/, 'right panel should render active task panel first');
  assert.match(chatShellSource, /<QuotaMonitor\s*\/>/, 'right panel should render quota monitor second');
  assert.match(chatShellSource, /<TodoPanel\s*\/>/, 'right panel should render TODO panel third');
  assert.match(chatShellSource, /<McpPanel\s*\/>/, 'right panel should render MCP panel fourth');
  assert.match(chatShellSource, /<LspPanel\s*\/>/, 'right panel should render LSP panel fifth');
});

test('composer controls render model, agent, and thinking controls in input footer', () => {
  // Verify composer area includes model/agent selectors and thinking-level controls.
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  assert.match(inputBody, /<ModelDropdown\s*\/>/, 'input composer should render model selector');
  assert.match(inputBody, /<AgentDropdown\s*\/>/, 'input composer should render agent selector');
  assert.match(inputBody, /<ThinkingLevelControl\s*\/>/, 'input composer should render thinking-level control');
  assert.match(inputBody, /\{isProcessing\s*\?\s*\([\s\S]*variant="destructive"[\s\S]*onClick=\{stopRequest\}/, 'composer should show stop button while processing');
});

test('thinking, model, and agent controls post selection events and expose common error-safe behavior', () => {
  // Verify control interactions emit extension messages and guard side effects.
  const thinkingBody = extractFunctionBody(panelSource, 'export function ThinkingLevelControl()');
  const modelBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');
  const agentBody = extractFunctionBody(panelSource, 'export function AgentDropdown()');

  assert.match(thinkingBody, /vscode\.postMessage\(\{\s*type:\s*["']setThinkingLevel["'],\s*level\s*\}\)/, 'thinking control should post setThinkingLevel messages');
  assert.match(thinkingBody, /catch\s*\(e\)\s*\{[\s\S]*\}/, 'thinking control should guard messaging errors');

  assert.match(modelBody, /vscode\.postMessage\(\{[\s\S]*type:\s*["']selectModel["']/, 'model dropdown should post selectModel when a model is picked');
  assert.match(agentBody, /vscode\.postMessage\(\{\s*type:\s*["']selectAgent["'],\s*agent:\s*agent\.id\s*\}\)/, 'agent dropdown should post selectAgent when an agent is picked');
});
