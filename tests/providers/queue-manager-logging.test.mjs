import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

const queueManagerSource = readAllSources([
  joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'),
], 'QueueManager.ts');

test('should log when prompts are added to queue', () => {
  // Verify that addToQueue uses feature flow tracking
  assert.match(
    queueManagerSource,
    /addToQueue\(.*\):\s*void\s*{[\s\S]*const\s+correlationId\s*=\s*this\.logger\.startFeatureFlow/,
    'addToQueue should start a feature flow with correlation ID'
  );

  // Verify that addToQueue logs state changes
  assert.match(
    queueManagerSource,
    /this\.logger\.logStateChange\(\s*['"]queue-size['"]/,
    'addToQueue should log queue size state changes'
  );

  // Verify that addToQueue ends feature flow
  assert.match(
    queueManagerSource,
    /this\.logger\.endFeatureFlow\(correlationId/,
    'addToQueue should end feature flow'
  );
});

test('should log queue execution flow with timing', () => {
  // Verify that executeQueue uses feature flow tracking
  assert.match(
    queueManagerSource,
    /correlationId\s*=\s*this\.logger\.startFeatureFlow\(\s*['"]execute-queue['"]/,
    'executeQueue should start a feature flow with correlation ID'
  );

  // Verify that executeQueue logs state changes
  assert.match(
    queueManagerSource,
    /this\.logger\.logStateChange\(\s*['"]queue-executing['"]/,
    'executeQueue should log executing state changes'
  );

  // Verify that executeQueue uses featureStep for each prompt
  assert.match(
    queueManagerSource,
    /this\.logger\.featureStep\(correlationId,\s*['"]execute-prompt['"]/,
    'executeQueue should log feature steps for each prompt'
  );

  // Verify that executeQueue logs performance metrics
  assert.match(
    queueManagerSource,
    /this\.logger\.performance\(\s*['"]execute-queue['"]\s*,\s*duration/,
    'executeQueue should log performance metrics'
  );

  // Verify that executeQueue ends feature flow
  assert.match(
    queueManagerSource,
    /this\.logger\.endFeatureFlow\(correlationId/,
    'executeQueue should end feature flow'
  );
});

test('should log queue state changes', () => {
  // Verify that clearQueue logs state changes
  assert.match(
    queueManagerSource,
    /clearQueue\([^)]*\):\s*void[\s\S]*this\.logger\.logStateChange\(\s*['"]queue-size['"]/,
    'clearQueue should log queue size state changes'
  );

  assert.match(
    queueManagerSource,
    /this\.logger\.logStateChange\(\s*['"]queue['"]/,
    'clearQueue should log queue state changes'
  );
});

test('should handle empty queue gracefully', () => {
  // Verify that executeQueue has empty queue check
  assert.match(
    queueManagerSource,
    /if\s*\(\s*this\.queue\.length\s*===\s*0\s*\)/,
    'executeQueue should check for empty queue'
  );

  // Verify that executeQueue logs debug message for empty queue
  assert.match(
    queueManagerSource,
    /this\.logger\.debug\(\s*['"]Execute queue called with empty queue['"]/,
    'executeQueue should log debug message for empty queue'
  );
});

test('should track feature flow for clear queue', () => {
  // Verify that clearQueue uses feature flow tracking
  assert.match(
    queueManagerSource,
    /clearQueue\([^)]*\):\s*void[\s\S]*const\s+correlationId\s*=\s*this\.logger\.startFeatureFlow/,
    'clearQueue should start a feature flow with correlation ID'
  );

  // Verify that clearQueue ends feature flow
  const clearQueueBody = extractFunctionBody(queueManagerSource, 'clearQueue');
  assert.ok(
    clearQueueBody.includes('this.logger.endFeatureFlow(correlationId'),
    'clearQueue should end feature flow'
  );

  // Verify that clearQueue includes itemsCleared in result
  assert.match(
    queueManagerSource,
    /this\.logger\.endFeatureFlow\(correlationId,\s*{[\s\S]*itemsCleared/,
    'clearQueue should include itemsCleared in feature flow result'
  );
});
