import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('ActiveTaskPanel reads streaming from store state and does not render todoItems', () => {
  // Confirm live data wiring — the panel must destructure streaming from useAppState()
  // and must NOT render todoItems (todos belong exclusively to TodoPanel).
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /streaming[^)]*useAppState\(\)|useAppState\(\)[^;]*streaming/s,
    'ActiveTaskPanel must read streaming from useAppState()',
  );
  assert.doesNotMatch(
    body,
    /sessionTodos/,
    'ActiveTaskPanel must NOT define sessionTodos — todos belong exclusively to TodoPanel',
  );
  assert.doesNotMatch(
    body,
    /Current Tasks/,
    'ActiveTaskPanel must NOT render a Current Tasks section — todos belong exclusively to TodoPanel',
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

test('ActiveTaskPanel derives sessionPatchedFiles from patch parts, history edits, and streaming edits', () => {
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /sessionPatchedFiles/,
    'ActiveTaskPanel should define sessionPatchedFiles derived field',
  );
  assert.match(
    body,
    /partType\s*!==\s*["']patch["']/,
    'patched-file derivation should filter message parts by type patch',
  );
  assert.match(
    body,
    /typedPart\.files/,
    'patched-file derivation should read files from patch parts',
  );
  assert.match(
    body,
    /message\.edits/,
    'patched-file derivation should include message edits fallback',
  );
  assert.match(
    body,
    /streaming\?\.edits/,
    'patched-file derivation should include live streaming edits',
  );
});

test('ActiveTaskPanel renders Patched Files section conditionally and wires file/diff actions', () => {
  const body = extractFunctionBody(panelSource, 'export function ActiveTaskPanel()');

  assert.match(
    body,
    /sessionPatchedFiles\.length\s*>\s*0/,
    'Patched Files section must be guarded by sessionPatchedFiles.length > 0',
  );
  assert.match(
    body,
    /Patched Files/,
    'Patched Files MiniSection title must appear in the render output',
  );
  assert.match(
    body,
    /type:\s*["']openFile["']/,
    'Patched file row should dispatch openFile action',
  );
  assert.match(
    body,
    /type:\s*["']openDiff["']/,
    'Patched file row should dispatch openDiff action',
  );
  assert.match(
    body,
    /PATCH/,
    'Patched file row should display PATCH type badge',
  );
});
