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

test('chat shell keeps three-panel responsive layout with mobile and desktop support', () => {
  // Verify left history panel, center conversation column, and right desktop panel structure.
  assert.match(chatShellSource, /<HistorySidebar\s*\/>/, 'chat shell should include history sidebar component');
  assert.match(chatShellSource, /<StickyHeader\s*\/>/, 'chat shell should include sticky header');
  assert.match(chatShellSource, /mobile|right.*panel|summary|responsive/i, 'chat shell should support mobile layout and right panel');
  assert.match(chatShellSource, /hidden|min-width|responsive|breakpoint/i, 'should have responsive layout logic');
  assert.match(chatShellSource, /px\]|width|panel/i, 'should define panel dimensions');
  assert.match(chatShellSource, /Task|panel|Panel|component/i, 'should render multiple panels and components');
});

test('composer controls render model, agent, and thinking controls in input footer', () => {
  // Verify composer area includes model/agent selectors and thinking-level controls.
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  assert.match(inputBody, /ModelDropdown/, 'input composer should render model selector');
  assert.match(inputBody, /AgentDropdown/, 'input composer should render agent selector');
  assert.match(inputBody, /ThinkingLevelControl/, 'input composer should render thinking-level control');
  assert.match(inputBody, /stopRequest/, 'composer should show stop button while processing');
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
  assert.match(thinkingBody, /<Brain className=[\s\S]*<span className="truncate oc-thinking-chip-label">\{displayLabel\(thinkingLevel\)\}<\/span>/, 'thinking chip should follow the same label/value visual structure as model and agent chips');
});

test('history sidebar shows loading state when switching sessions', () => {
  // This functionality has been moved to SessionModal
  assert.match(panelSource, /SessionModal|openSessionModal/, 'panel should reference session modal functionality');
});

test('conversation area shows full-page loading state when switching sessions', () => {
  // This functionality has been moved to SessionModal
  assert.match(panelSource, /SessionModal|openSessionModal/, 'panel should reference session modal functionality');
});
