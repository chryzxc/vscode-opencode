import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

const modelAndAgentManagerSource = readAllSources([
  joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
], 'ModelAndAgentManager.ts');

test('ModelAndAgentManager imports LoggingCategories', () => {
  // Verify that LoggingCategories is imported from the LoggingSchema module
  assert.match(
    modelAndAgentManagerSource,
    /import\s*\{[^}]*LoggingCategories[^}]*\}\s*from\s*["'].*\/LoggingSchema["']/,
    'ModelAndAgentManager should import LoggingCategories from LoggingSchema'
  );
});

test('setSelectedModel logs model selection changes with state change logging', () => {
  // Verify that setSelectedModel uses logStateChange to track model changes
  assert.match(
    modelAndAgentManagerSource,
    /async\s+setSelectedModel\([^)]*\):\s*Promise<void>[\s\S]*this\.logger\.logStateChange\(/,
    'setSelectedModel should log state changes when model selection changes'
  );
});

test('setSelectedModel uses feature flow tracking with correlation ID', () => {
  // Verify that setSelectedModel starts and ends a feature flow
  assert.match(
    modelAndAgentManagerSource,
    /async\s+setSelectedModel\([^)]*\):\s*Promise<void>[\s\S]*this\.logger\.startFeatureFlow\(/,
    'setSelectedModel should start a feature flow with correlation ID'
  );

  assert.match(
    modelAndAgentManagerSource,
    /async\s+setSelectedModel\([^)]*\):\s*Promise<void>[\s\S]*this\.logger\.endFeatureFlow\(/,
    'setSelectedModel should end the feature flow'
  );
});

test('handleGetModels logs model fetch operations with timing', () => {
  // Verify that handleGetModels logs performance metrics for model fetching
  assert.match(
    modelAndAgentManagerSource,
    /async\s+handleGetModels\([^)]*\):\s*Promise<[^>]*>[\s\S]*this\.logger\.performance\(/,
    'handleGetModels should log performance metrics for model fetch operations'
  );
});

test('handleGetModels uses feature flow tracking with steps', () => {
  // Verify that handleGetModels uses feature flow tracking with steps
  assert.match(
    modelAndAgentManagerSource,
    /async\s+handleGetModels\([^)]*\):\s*Promise<[^>]*>[\s\S]*this\.logger\.startFeatureFlow\(/,
    'handleGetModels should start a feature flow'
  );

  assert.match(
    modelAndAgentManagerSource,
    /async\s+handleGetModels\([^)]*\):\s*Promise<[^>]*>[\s\S]*this\.logger\.featureStep\(/,
    'handleGetModels should log feature steps'
  );
});

test('handleGetAgents logs agent fetch operations', () => {
  // Verify that handleGetAgents uses feature flow tracking
  assert.match(
    modelAndAgentManagerSource,
    /async\s+handleGetAgents\([^)]*\):\s*Promise<[^>]*>[\s\S]*this\.logger\.startFeatureFlow\(/,
    'handleGetAgents should start a feature flow'
  );
});

test('ModelAndAgentManager uses LoggingCategories for all log calls', () => {
  // Verify that log calls use the MODEL_AGENT_MANAGER category
  assert.match(
    modelAndAgentManagerSource,
    /this\.logger\.(info|error|warn|debug)\(\s*LoggingCategories\.MODEL_AGENT_MANAGER\s*,/,
    'ModelAndAgentManager should use LoggingCategories.MODEL_AGENT_MANAGER for log calls'
  );
});

test('ModelAndAgentManager logs errors with proper context', () => {
  // Verify that error handling includes proper logging with context
  assert.match(
    modelAndAgentManagerSource,
    /catch\s*\([^)]*\)\s*\{[\s\S]*this\.logger\.error\(\s*LoggingCategories\.MODEL_AGENT_MANAGER\s*,/,
    'ModelAndAgentManager should log errors with proper context using LoggingCategories'
  );
});
