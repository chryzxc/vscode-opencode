import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'StreamingComponents.tsx')],
  'StreamingComponents.tsx',
);

test('exports ProgressStep with StreamingStep prop', () => {
  assert.match(
    source,
    /export function ProgressStep\(\{ step \}: \{ step: StreamingStep \}\)/,
    'StreamingComponents.tsx must export ProgressStep({ step }: { step: StreamingStep })',
  );
});

test('exports ProgressSteps with StreamingStep array prop', () => {
  assert.match(
    source,
    /export function ProgressSteps\(\{ steps \}: \{ steps: StreamingStep\[\] \}\)/,
    'StreamingComponents.tsx must export ProgressSteps({ steps }: { steps: StreamingStep[] })',
  );
});

test('exports StreamingCard as memo with live assistant context props', () => {
  assert.match(
    source,
    /export const StreamingCard = memo\(function StreamingCard\(\{[\s\S]*isContiguous,[\s\S]*streaming,[\s\S]*interactiveEvents,[\s\S]*messages,[\s\S]*assistantTurnMessageId,/,
    'StreamingComponents.tsx must export StreamingCard as memo with live assistant context props',
  );
});

test('StreamingCard remains mounted for live assistant activity', () => {
  assert.match(
    source,
    /if \(streaming\.content\.trim\(\)\.length > 0\) return true;/,
    'StreamingCard should still render when assistant content is streaming',
  );
  assert.match(
    source,
    /if \(streaming\.reasoning\.trim\(\)\.length > 0\) return true;/,
    'StreamingCard should still render while reasoning is streaming',
  );
  assert.match(
    source,
    /if \(streaming\.steps\.length > 0 \|\| streaming\.progressEvents\.length > 0\) return true;/,
    'StreamingCard should still render for live step/progress activity',
  );
  assert.match(
    source,
    /Array\.isArray\(interactiveEvents\) && interactiveEvents\.length > 0/,
    'StreamingCard should stay mounted when live interactive events exist only in app state',
  );
  assert.match(
    source,
    /const liveSubagents = subagentsByParentMessageId\?\.\[streaming\.messageId\]/,
    'StreamingCard should stay mounted when live subagent updates are keyed by the current streaming message id',
  );
  assert.match(
    source,
    /const liveAssistantMessage = useMemo\([\s\S]*assistantTurnMessageId\?\.trim\(\)[\s\S]*streaming\.messageId\?\.trim\(\)[\s\S]*return \[\.\.\.messages\]\.reverse\(\)\.find\(\(message\) => message\?\.role === "assistant"\)\;/,
    'StreamingCard should attach the in-flight assistant message so the live render can see message-scoped activity',
  );
});

test('defines extClass helper for file extension CSS mapping', () => {
  assert.match(
    source,
    /function extClass\(/,
    'StreamingComponents.tsx must define extClass helper for file extension CSS mapping',
  );
});

test('checks pending and error step status', () => {
  assert.match(
    source,
    /step\.status === 'pending'/,
    'StreamingComponents.tsx must check for pending steps',
  );
  assert.match(
    source,
    /step\.status === 'error'/,
    'StreamingComponents.tsx must check for error steps',
  );
});

test('uses Loader2 icon for pending steps', () => {
  assert.match(
    source,
    /Loader2/,
    'StreamingComponents.tsx must use Loader2 icon for pending steps',
  );
});

test('posts openFile messages through vscode', () => {
  assert.match(
    source,
    /vscode\.postMessage\(\{[\s\S]*?type: 'openFile'[\s\S]*?\}\)/,
    'StreamingComponents.tsx must post openFile messages through vscode.postMessage',
  );
});

test('computes progress bar width from doneCount and steps length', () => {
  assert.match(
    source,
    /doneCount\s*\/\s*steps\.length|steps\.length\s*\/\s*doneCount/,
    'StreamingComponents.tsx must compute progress bar width from doneCount/steps.length',
  );
});
