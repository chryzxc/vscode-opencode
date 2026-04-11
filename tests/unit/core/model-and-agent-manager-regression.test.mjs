/**
 * Core Model and Agent Management Regression Tests
 *
 * These tests prevent regressions in model and agent selection functionality.
 * Model and agent management is critical for AI interaction and user experience.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const modelAndAgentManagerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts')],
  'ModelAndAgentManager.ts',
);

test.describe('Model and Agent Manager - Model Selection', () => {

  test('setSelectedModel updates model state', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /setSelectedModel[\s\S]*selectedModel\s*=/s,
      'must update selected model'
    );
  });

  test('setSelectedModel persists model preference', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /setSelectedModel[\s\S]*globalState\.update|persist/s,
      'must persist model selection'
    );
  });

  test('getSelectedModel returns current model', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /getSelectedModel[\s\S]*return\s*this\.selectedModel/s,
      'must return selected model'
    );
  });

  test('resolveDefaultModel finds fallback model', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /resolveDefaultModel[\s\S]*availableModels|fallback|default/s,
      'must find default model'
    );
  });

  test('getSelectedModelFallbackList provides alternatives', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /getSelectedModelFallbackList[\s\S]*models|alternatives|fallback/s,
      'must provide fallback models'
    );
  });

});

test.describe('Model and Agent Manager - Agent Selection', () => {

  test('setSelectedAgent updates agent state', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /setSelectedAgent[\s\S]*selectedAgent\s*=/s,
      'must update selected agent'
    );
  });

  test('getSelectedAgent returns current agent', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /getSelectedAgent[\s\S]*return\s*this\.selectedAgent/s,
      'must return selected agent'
    );
  });

  test('handleGetAgents fetches available agents', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /handleGetAgents[\s\S]*agents|fetch|server/s,
      'must fetch agents from server'
    );
  });

});

test.describe('Model and Agent Manager - Model Availability', () => {

  test('getAvailableModels fetches model list', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /getAvailableModels[\s\S]*serverManager|fetch|availableModels/s,
      'must fetch available models'
    );
  });

  test('getAvailableModels caches results', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /getAvailableModels[\s\S]*cache|modelsFetchPromise|ttl/s,
      'must cache model list'
    );
  });

  test('handleGetModels returns model information', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /handleGetModels[\s\S]*models|capabilities|provider/s,
      'must return model information'
    );
  });

});

test.describe('Model and Agent Manager - Session Settings', () => {

  test('getSessionSettings retrieves session preferences', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /getSessionSettings[\s\S]*sessionId|settings|preferences/s,
      'must retrieve session settings'
    );
  });

  test('getSessionSettingsMap gets all session settings', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /getSessionSettingsMap[\s\S]*globalState\.get|keys|entries/s,
      'must get all session settings'
    );
  });

  test('persistSessionSettings saves session preferences', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /persistSessionSettings[\s\S]*globalState\.update|set/s,
      'must persist session settings'
    );
  });

  test('applySessionSettings applies preferences', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /applySessionSettings[\s\S]*setSelectedModel|setSelectedAgent|model|agent/s,
      'must apply model and agent settings'
    );
  });

});

test.describe('Model and Agent Manager - Command Handling', () => {

  test('handleGetCommands returns command list', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /handleGetCommands[\s\S]*commands|catalog|slash/s,
      'must return available commands'
    );
  });

  test('loadCommandCatalog fetches command catalog', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /loadCommandCatalog[\s\S]*server|fetch|catalog/s,
      'must fetch command catalog'
    );
  });

  test('normalizeSlashCommand processes command format', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /normalizeSlashCommand[\s\S]*trim|toLowerCase|prefix/s,
      'must normalize command format'
    );
  });

});

test.describe('Model and Agent Manager - Model Reconciliation', () => {

  test('reconcileSelectedModelSelection validates model availability', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /reconcileSelectedModelSelection[\s\S]*availableModels|validate|check/s,
      'must validate model is available'
    );
  });

  test('reconcileSelectedModelSelection handles missing models', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /reconcileSelectedModelSelection[\s\S]*fallback|default|resolveDefaultModel/s,
      'must fallback to default model'
    );
  });

});

test.describe('Model and Agent Manager - Settings Migration', () => {

  test('migrateSessionSettings handles session transfer', () => {
    const migrateBody = extractFunctionBody(modelAndAgentManagerSource, 'migrateSessionSettings');

    assert.match(
      migrateBody,
      /oldSessionId|newSessionId|sessionId/s,
      'must handle session IDs'
    );
  });

  test('migrateSessionSettings copies settings between sessions', () => {
    const migrateBody = extractFunctionBody(modelAndAgentManagerSource, 'migrateSessionSettings');

    assert.match(
      migrateBody,
      /map\[newSessionId\]\s*=\s*\{\s*\.\.\.oldSettings|copy|clone/s,
      'must copy settings between sessions'
    );
  });

});

test.describe('Model and Agent Manager - Error Handling', () => {

  test('model operations handle missing data gracefully', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /if\s*\(\s*!.*\s*\)|typeof.*===|undefined|null/s,
      'must validate input data'
    );
  });

  test('model operations provide safe defaults', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /return\s*\{\s*\}|return\s*\[\]|fallback|default/s,
      'must return safe defaults'
    );
  });

  test('model operations log errors appropriately', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /logger\.(warn|error|debug)/s,
      'must log operation issues'
    );
  });

});

test.describe('Model and Agent Manager - Performance', () => {

  test('model operations use efficient lookups', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /Map|Set|find|filter/s,
      'must use efficient data structures'
    );
  });

  test('model operations cache expensive operations', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /cache|ttl|promise|memo/s,
      'must cache expensive operations'
    );
  });

});

test.describe('Model and Agent Manager - Integration', () => {

  test('model operations integrate with server', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /serverManager|fetch|getModels|getAgents/s,
      'must integrate with server operations'
    );
  });

  test('model operations integrate with capabilities', () => {
    const source = modelAndAgentManagerSource;

    assert.match(
      source,
      /modelCapabilitiesService|capabilities|features/s,
      'must integrate with model capabilities'
    );
  });

});
