import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const modelAndAgentManagerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts')],
  'ModelAndAgentManager.ts',
);

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('ModelAndAgentManager forwards configured providers from SDK config.providers()', () => {
  const handleGetModelsBody = extractFunctionBody(modelAndAgentManagerSource, 'async handleGetModels');

  assert.match(
    handleGetModelsBody,
    /client\.config\.providers\(\)/,
    'handleGetModels should fetch configured providers from the SDK config endpoint'
  );
  assert.match(
    handleGetModelsBody,
    /\.map\(\(p:\s*any\)\s*=>\s*p\.id\)/,
    'handleGetModels should extract provider IDs from the SDK response'
  );
  assert.match(
    handleGetModelsBody,
    /\.filter\(\(id:\s*string\)\s*=>\s*id\s*&&\s*id\.toLowerCase\(\)\s*!==\s*["']opencode["']\)/,
    'handleGetModels should exclude only the raw opencode free-tier provider ID'
  );
  assert.match(
    handleGetModelsBody,
    /configuredProviders,\s*\/\/ Send connected providers for badge filtering/,
    'handleGetModels should forward configuredProviders to the webview payload'
  );
});

test('ModelDropdown uses exact providerID filtering so OpenCode Go remains visible', () => {
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(
    dropdownBody,
    /const\s+configuredProviderIds\s*=\s*new\s+Set\(\s*configuredProviders\.map\(\(id\)\s*=>\s*id\.toLowerCase\(\)\)\s*\)/,
    'dropdown should normalize configured provider IDs into a lookup set'
  );
  assert.match(
    dropdownBody,
    /const\s+providerId\s*=\s*m\.providerID\.toLowerCase\(\);[\s\S]*return\s+configuredProviderIds\.has\(providerId\);/,
    'dropdown should use exact providerID membership when deciding which provider tabs to show'
  );
  assert.match(
    dropdownBody,
    /return\s+providerId\s*!==\s*["']opencode["']/,
    'dropdown should suppress only the exact raw opencode provider'
  );
  assert.doesNotMatch(
    dropdownBody,
    /providerId\.includes\(["']opencode["']\)/,
    'dropdown should not use substring matching that would hide providers like OpenCode Go'
  );
});
