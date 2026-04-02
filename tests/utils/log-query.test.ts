import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LogQuery } from '../../src/utils/LogQuery.js';

describe('LogQuery', () => {
  it('should parse JSON log entries', () => {
    const logLine = '{"timestamp":"2026-04-02T12:00:00.000Z","level":"info","category":"TestCategory","message":"Test message"}';
    const parsed = LogQuery.parseLine(logLine);

    assert.equal(parsed.level, 'info');
    assert.equal(parsed.category, 'TestCategory');
  });

  it('should filter logs by category', () => {
    const logs = [
      { category: 'Extension', message: 'msg1' },
      { category: 'ChatView', message: 'msg2' },
      { category: 'Extension', message: 'msg3' },
    ];

    const filtered = LogQuery.filterByCategory(logs, 'Extension');
    assert.equal(filtered.length, 2);
  });

  it('should filter logs by correlation ID', () => {
    const logs = [
      { context: { correlationId: 'abc-123' }, message: 'msg1' },
      { context: { correlationId: 'def-456' }, message: 'msg2' },
      { context: { correlationId: 'abc-123' }, message: 'msg3' },
    ];

    const filtered = LogQuery.filterByCorrelationId(logs, 'abc-123');
    assert.equal(filtered.length, 2);
  });

  it('should extract feature flows from logs', () => {
    const logs = [
      { message: 'Feature started: test-flow', context: { correlationId: 'abc-123' }, timestamp: '2026-04-02T12:00:00.000Z' },
      { message: 'Feature step: step1', context: { correlationId: 'abc-123' }, timestamp: '2026-04-02T12:00:01.000Z' },
      { message: 'Feature ended: test-flow', context: { correlationId: 'abc-123' }, timestamp: '2026-04-02T12:00:02.000Z' },
    ];

    const flows = LogQuery.extractFeatureFlows(logs);
    assert.equal(flows.length, 1);
    assert.equal(flows[0].featureName, 'test-flow');
  });
});
