import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('exports getMentionTrigger with the expected signature', () => {
  assert.match(
    source,
    /export function getMentionTrigger\(input: string, cursor: number\): MentionTrigger \| null/,
    'PanelComponents.tsx must export getMentionTrigger(input: string, cursor: number): MentionTrigger | null',
  );
});

test('exports MentionTrigger type fields', () => {
  assert.match(
    source,
    /export type MentionTrigger = \{[\s\S]*?query: string;[\s\S]*?replaceFrom: number;[\s\S]*?replaceTo: number;[\s\S]*?\}/,
    'PanelComponents.tsx must export MentionTrigger with query, replaceFrom, and replaceTo fields',
  );
});

test('exports StickyHeader component', () => {
  assert.match(
    source,
    /export function StickyHeader\(/,
    'PanelComponents.tsx must export StickyHeader',
  );
});

test('exports HistorySidebar component', () => {
  assert.match(
    source,
    /export function HistorySidebar\(/,
    'PanelComponents.tsx must export HistorySidebar',
  );
});

test('exports ActiveTaskPanel component', () => {
  assert.match(
    source,
    /export function ActiveTaskPanel\(/,
    'PanelComponents.tsx must export ActiveTaskPanel',
  );
});

test('exports InputWrapper component', () => {
  assert.match(
    source,
    /export function InputWrapper\(/,
    'PanelComponents.tsx must export InputWrapper',
  );
});

test('exports ModelDropdown and AgentDropdown components', () => {
  assert.match(
    source,
    /export function ModelDropdown\(/,
    'PanelComponents.tsx must export ModelDropdown',
  );
  assert.match(
    source,
    /export function AgentDropdown\(/,
    'PanelComponents.tsx must export AgentDropdown',
  );
});

test('exports QueueContainer component', () => {
  assert.match(
    source,
    /export function QueueContainer\(/,
    'PanelComponents.tsx must export QueueContainer',
  );
});

test('exports QuotaMonitor component', () => {
  assert.match(
    source,
    /export function QuotaMonitor\(/,
    'PanelComponents.tsx must export QuotaMonitor',
  );
});

test('exports SettingsModal with the expected props', () => {
  assert.match(
    source,
    /export function SettingsModal\(\{[\s\S]*?isOpen[\s\S]*?onClose[\s\S]*?initialContent[\s\S]*?filePath[\s\S]*?isGlobal[\s\S]*?availableModels[\s\S]*?\}/,
    'PanelComponents.tsx must export SettingsModal with isOpen, onClose, initialContent, filePath, isGlobal, and availableModels props',
  );
});

test('re-exports ConfigSidebar from ./ConfigSidebar', () => {
  assert.match(
    source,
    /from '\.\/ConfigSidebar';/,
    'PanelComponents.tsx must re-export ConfigSidebar from ./ConfigSidebar',
  );
});

test('posts createSession messages through vscode', () => {
  assert.match(
    source,
    /vscode\.postMessage\(\{[\s\S]*?type: "createSession"[\s\S]*?\}\)/,
    'PanelComponents.tsx must post createSession messages through vscode.postMessage',
  );
});
