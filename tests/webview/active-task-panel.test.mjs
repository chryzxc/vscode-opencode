import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('ActiveTaskPanel reads streaming and SDK todoItems from store state', () => {
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /streaming[^)]*useAppState\(\)|useAppState\(\)[^;]*streaming/s,
    'ActiveTaskPanel must read streaming from useAppState()',
  );
  assert.match(
    body,
    /todoItems[^)]*useAppState\(\)|useAppState\(\)[^;]*todoItems/s,
    'ActiveTaskPanel must read SDK todoItems from useAppState()',
  );
  assert.match(
    body,
    /Todo Checklist/,
    'ActiveTaskPanel must render the SDK todo checklist section',
  );
  assert.match(
    body,
    /completedTodoCount/,
    'ActiveTaskPanel must summarize completed checklist items',
  );
});

test('ActiveTaskPanel renders checklist status icons for SDK todo states', () => {
  assert.match(
    panelSource,
    /function TodoChecklistIcon/,
    'PanelComponents should define a todo checklist icon renderer',
  );
  assert.match(
    panelSource,
    /case "completed"[\s\S]*<Check/,
    'Completed todos should use a visible check icon',
  );
  assert.match(
    panelSource,
    /case "in_progress"[\s\S]*<RefreshCw/,
    'In-progress todos should use a visible progress icon',
  );
  assert.match(
    panelSource,
    /line-through/,
    'Completed todo text should be visually marked done',
  );
});

test('ActiveTaskPanel derives liveProgressSteps from streaming.progressEvents and streaming.steps', () => {
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
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /isActive\s*&&[\s\S]*Progress Updates/,
    'Progress Updates section must be guarded by isActive',
  );
  assert.match(
    body,
    /Thinking[\u2026.]{1,3}/u,
    'Progress Updates section must show a Thinking fallback when no steps are present',
  );
});
