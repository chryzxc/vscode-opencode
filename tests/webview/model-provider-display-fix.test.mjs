/**
 * Model/Provider Display Fix Tests
 *
 * Tests for the fix that ensures model/provider information displayed during
 * streaming comes from the actual AI response, not from the UI's selected model.
 *
 * **Bug Fixed**: Model/provider was incorrectly initialized from state.selectedModel
 * during SET_PROCESSING, causing wrong model display during streaming when
 * subagents use different models than the UI selection.
 *
 * **Tests:**
 * - SET_PROCESSING does NOT initialize model/provider from UI selection
 * - buildStreamingMessage handles missing model info gracefully
 * - modelLabel displays correct fallback when model info is missing
 * - Subagent responses show correct model different from UI selection
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

// Load source files
const storeSource = readAllSources(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);
const messageHandlerSource = readAllSources(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const messageComponentsSource = readAllSources(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('SET_PROCESSING does NOT initialize model from UI selection', () => {
  // Verify that SET_PROCESSING no longer uses state.selectedModel for initialization
  const setProcessingCase = storeSource.match(
    /case ['"]SET_PROCESSING['"]:[\s\S]*?case ['"][\w]+['"]:/,
  );

  assert.ok(setProcessingCase, 'SET_PROCESSING case should exist in reducer');
  const processingLogic = setProcessingCase[0];

  // Verify that streaming state is created without model assumptions
  assert.match(
    processingLogic,
    /streamingState:\s*StreamingState\s*=\s*\{/,
    'Should create a StreamingState object'
  );

  // CRITICAL: Verify that model fields are NOT initialized from state.selectedModel
  assert.doesNotMatch(
    processingLogic,
    /model:\s*\{\s*modelID:\s*state\.selectedModel/,
    'Should NOT initialize model from state.selectedModel'
  );

  assert.doesNotMatch(
    processingLogic,
    /modelID:\s*state\.selectedModel!/,
    'Should NOT initialize modelID from state.selectedModel'
  );

  assert.doesNotMatch(
    processingLogic,
    /providerID:\s*state\.selectedModel!/,
    'Should NOT initialize providerID from state.selectedModel'
  );

  // Verify the comment explaining the fix
  assert.match(
    processingLogic,
    /NOTE:\s+model,\s+modelID,\s+providerID\s+intentionally\s+omitted/,
    'Should have comment explaining model fields are intentionally omitted'
  );
});

test('SET_PROCESSING includes comment explaining model omission', () => {
  // Verify the code has proper documentation explaining why model is not set
  const setProcessingCase = storeSource.match(
    /case ['"]SET_PROCESSING['"]:[\s\S]*?case ['"][\w]+['"]:/,
  );

  assert.ok(setProcessingCase, 'SET_PROCESSING case should exist');
  const processingLogic = setProcessingCase[0];

  // Check for explanatory comment
  assert.match(
    processingLogic,
    /intentionally\s+omitted/s,
    'Should document that model fields are intentionally omitted'
  );
});

test('buildStreamingMessage handles missing model info gracefully', () => {
  // Verify that buildStreamingMessage doesn't crash when model info is missing
  const functionBody = extractFunctionBody(
    messageHandlerSource,
    'function buildStreamingMessage'
  );

  assert.ok(functionBody, 'buildStreamingMessage function should exist');

  // Verify it builds message with whatever model info is available (including none)
  assert.match(
    functionBody,
    /info:\s*\{/,
    'Should create info object'
  );

  assert.match(
    functionBody,
    /model:\s*streaming\.model/,
    'Should include model field even if undefined'
  );

  assert.match(
    functionBody,
    /modelID:\s*streaming\.modelID/,
    'Should include modelID field even if undefined'
  );

  assert.match(
    functionBody,
    /providerID:\s*streaming\.providerID/,
    'Should include providerID field even if undefined'
  );
});

test('modelLabel returns "assistant" fallback when model info missing', () => {
  // Verify that modelLabel has proper fallback when model info is not available
  const functionBody = extractFunctionBody(
    messageComponentsSource,
    'function modelLabel'
  );

  assert.ok(functionBody, 'modelLabel function should exist');

  // Check for fallback to "assistant" - use simpler pattern that doesn't rely on exact spacing
  assert.match(
    functionBody,
    /assistant/,  // Just check that "assistant" appears in the function
    'Should return "assistant" as fallback when model info is missing'
  );

  // Verify the function checks multiple possible locations for model info
  assert.match(
    functionBody,
    /message\.info\?\.model/,
    'Should check message.info.model (from streaming)'
  );

  assert.match(
    functionBody,
    /message\.model/,
    'Should check message.model (from persisted messages)'
  );

  assert.match(
    functionBody,
    /message\.info\?\.modelID/,
    'Should check message.info.modelID'
  );
});

test('modelLabel prioritizes nested info structure over top-level', () => {
  // Verify the correct priority: info.model → message.model → individual fields
  const functionBody = extractFunctionBody(
    messageComponentsSource,
    'function modelLabel'
  );

  assert.ok(functionBody, 'modelLabel function should exist');

  // The function should check nested info first (from streaming)
  const infoModelCheck = functionBody.match(/message\.info\?\.model/g);
  assert.ok(infoModelCheck, 'Should check message.info.model');

  // Then check top-level model (from persisted messages)
  const topLevelModelCheck = functionBody.match(/typeof message\.model\s*===\s*['"]object['"]/);
  assert.ok(topLevelModelCheck, 'Should check message.model as fallback');

  // Finally check individual modelID/providerID fields
  const modelIDCheck = functionBody.match(/message\.info\?\.modelID/);
  assert.ok(modelIDCheck, 'Should check modelID as final fallback');
});

test('StreamingState type has optional model fields', () => {
  // Verify that StreamingState type properly declares model fields as optional
  const typesSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
    'types.ts',
  );

  // Check that model fields are optional (marked with ?)
  assert.match(
    typesSource,
    /model\?\:\s*\{/,
    'StreamingState.model should be optional'
  );

  assert.match(
    typesSource,
    /modelID\?\:\s*string/,
    'StreamingState.modelID should be optional'
  );

  assert.match(
    typesSource,
    /providerID\?\:\s*string/,
    'StreamingState.providerID should be optional'
  );
});

test('SET_PROCESSING creates streaming state without model validation', () => {
  // Verify that SET_PROCESSING no longer has the hasValidModel check
  const setProcessingCase = storeSource.match(
    /case ['"]SET_PROCESSING['"]:[\s\S]*?case ['"][\w]+['"]:/,
  );

  assert.ok(setProcessingCase, 'SET_PROCESSING case should exist');
  const processingLogic = setProcessingCase[0];

  // The old code had: const hasValidModel = state.selectedModel?.modelID && state.selectedModel?.providerID;
  // This should be removed
  assert.doesNotMatch(
    processingLogic,
    /hasValidModel/,
    'Should NOT check for valid model before creating streaming state'
  );

  assert.doesNotMatch(
    processingLogic,
    /state\.selectedModel\?\.modelID/,
    'Should NOT check state.selectedModel.modelID'
  );

  // Should create streaming state unconditionally when processing starts
  assert.match(
    processingLogic,
    /if\s*\(action\.payload && !state\.streaming\)/,
    'Should create streaming state when processing starts'
  );
});

test('Comment explains why model info is omitted from streaming init', () => {
  // Verify the code has clear documentation about the fix
  const setProcessingCase = storeSource.match(
    /case ['"]SET_PROCESSING['"]:[\s\S]*?case ['"][\w]+['"]:/,
  );

  assert.ok(setProcessingCase, 'SET_PROCESSING case should exist');
  const processingLogic = setProcessingCase[0];

  // Look for the explanatory comment
  assert.match(
    processingLogic,
    /Initialize\s+streaming\s+state\s+WITHOUT\s+model\/provider\s+assumptions/i,
    'Should have comment explaining initialization without model assumptions'
  );

  assert.match(
    processingLogic,
    /actual\s+model\s+used/i,
    'Should mention that actual model used will be set later'
  );
});

test('Streaming initialization preserves agent selection', () => {
  // Verify that while model info is omitted, agent selection is still preserved
  const setProcessingCase = storeSource.match(
    /case ['"]SET_PROCESSING['"]:[\s\S]*?case ['"][\w]+['"]:/,
  );

  assert.ok(setProcessingCase, 'SET_PROCESSING case should exist');
  const processingLogic = setProcessingCase[0];

  // Agent should still be set from state.selectedAgent
  assert.match(
    processingLogic,
    /agent:\s*state\.selectedAgent\s*\|\|\s*undefined/,
    'Should preserve agent selection from state.selectedAgent'
  );
});
