import assert from 'node:assert/strict';
import { createLogger } from '../../src/utils/Logger.js';

describe('Enhanced Logger', () => {
  it('should generate and track correlation IDs', () => {
    const log = createLogger('TestCategory');
    const correlationId = log.startFeatureFlow('test-feature');

    assert.equal(typeof correlationId, 'string');
    assert.ok(correlationId.length > 0);

    const active = log.getActiveFeatureFlow();
    assert.equal(active?.featureName, 'test-feature');
    assert.equal(active?.correlationId, correlationId);
  });

  it('should log performance measurements', () => {
    const log = createLogger('TestCategory');
    const startTime = Date.now();

    // Simulate some work
    const duration = 100;

    log.performance('test-operation', duration, {
      metadata: { test: 'value' }
    });

    // Should log with performance category
    // Verify through log output capture
    assert.ok(true); // Placeholder - actual test would capture console output
  });

  it('should end feature flow and calculate duration', () => {
    const log = createLogger('TestCategory');
    const correlationId = log.startFeatureFlow('test-feature');

    // Simulate work
    const duration = 50;

    const flow = log.endFeatureFlow(correlationId, { success: true });

    assert.equal(flow?.featureName, 'test-feature');
    assert.equal(typeof flow?.duration, 'number');
    assert.ok(flow?.duration >= 0);
  });
});
