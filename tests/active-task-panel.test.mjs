import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('ActiveTaskPanel reads streaming and todoItems from store state', () => {
  // Confirm live data wiring — the panel must destructure both fields from useAppState().
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /streaming[^)]*useAppState\(\)|useAppState\(\)[^;]*streaming/s,
    'ActiveTaskPanel must read streaming from useAppState()',
  );
  assert.match(
    body,
    /todoItems/,
    'ActiveTaskPanel must read todoItems from useAppState()',
  );
});

test('ActiveTaskPanel derives liveProgressSteps from streaming.progressEvents and streaming.steps', () => {
  // Confirm the progress step derivation logic is present.
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /progressEvents/,
    'ActiveTaskPanel should reference streaming.progressEvents',
  );
  assert.match(
    body,
    /streaming\??\.steps/,
    'ActiveTaskPanel should reference streaming.steps as fallback',
  );
  assert.match(
    body,
    /liveProgressSteps/,
    'ActiveTaskPanel should define liveProgressSteps derived field',
  );
});

test('ActiveTaskPanel renders Progress Updates section conditionally on isActive', () => {
  // Confirms the section only appears while streaming is active.
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /isActive\s*&&[\s\S]*Progress Updates/,
    'Progress Updates section must be guarded by isActive',
  );
  assert.match(
    body,
    /Thinking[\u2026\.]{1,3}/u,
    'Progress Updates section must show a Thinking fallback when no steps are present',
  );
});

test('ActiveTaskPanel renders Current Tasks section conditionally on sessionTodos length', () => {
  // Confirms the section only appears when there are session-scoped todos.
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /sessionTodos/,
    'ActiveTaskPanel should define sessionTodos derived field',
  );
  assert.match(
    body,
    /sessionTodos\.length\s*>\s*0/,
    'Current Tasks section must be guarded by sessionTodos.length > 0',
  );
  assert.match(
    body,
    /Current Tasks/,
    'Current Tasks MiniSection title must appear in the render output',
  );
});
