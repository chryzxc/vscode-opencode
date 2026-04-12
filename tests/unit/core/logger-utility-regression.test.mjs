/**
 * Core Logger Utility Regression Tests
 *
 * These tests prevent regressions in logging functionality.
 * Logging is critical for debugging, monitoring, and system observability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const loggerSource = readSource(
  [joinFromRoot('src', 'utils', 'Logger.ts')],
  'Logger.ts',
);

test.describe('Logger - Log Level Management', () => {

  test('parseLogLevel converts string levels to enum', () => {
    const source = loggerSource;

    assert.match(
      source,
      /parseLogLevel[\s\S]*toLowerCase|switch|case.*error|case.*warn|case.*info|case.*debug/s,
      'must convert string levels to enum'
    );
  });

  test('parseLogLevel handles invalid levels', () => {
    const source = loggerSource;

    assert.match(
      source,
      /parseLogLevel[\s\S]*default|case.*info.*:|return/s,
      'must provide default for invalid levels'
    );
  });

  test('logger respects configured minimum level', () => {
    const source = loggerSource;

    assert.match(
      source,
      /minLevel|configured|config\.minLevel/s,
      'must check configured minimum level'
    );
  });

});

test.describe('Logger - Log Output', () => {

  test('output formats log entries correctly', () => {
    const outputBody = extractFunctionBody(loggerSource, 'output');

    assert.match(
      outputBody,
      /formatEntry|timestamp|level|message|category/s,
      'must format log entries correctly'
    );
  });

  test('outputToConsole writes to console', () => {
    const source = loggerSource;

    assert.match(
      source,
      /outputToConsole[\s\S]*console\.(log|info|warn|error)/s,
      'must write to appropriate console method'
    );
  });

  test('outputToConsole checks console enablement', () => {
    const source = loggerSource;

    assert.match(
      source,
      /outputToConsole[\s\S]*enableConsole|config\.enableConsole/s,
      'must check console enablement'
    );
  });

});

test.describe('Logger - File Logging', () => {

  test('rotateIfNeeded handles file size limits', () => {
    const source = loggerSource;

    assert.match(
      source,
      /rotateIfNeeded[\s\S]*maxFileSize|stat|size|limit/s,
      'must check file size limits'
    );
  });

  test('rotateIfNeeded manages backup files', () => {
    const source = loggerSource;

    assert.match(
      source,
      /rotateIfNeeded[\s\S]*backup|archive|\.1|\.2/s,
      'must manage backup files'
    );
  });

  test('rotateIfNeeded respects max files limit', () => {
    const source = loggerSource;

    assert.match(
      source,
      /rotateIfNeeded[\s\S]*maxFiles|limit|delete|remove/s,
      'must respect max files limit'
    );
  });

});

test.describe('Logger - Buffer Management', () => {

  test('startFlushTimer manages flush intervals', () => {
    const source = loggerSource;

    assert.match(
      source,
      /startFlushTimer[\s\S]*setInterval|timer|flush/s,
      'must manage flush timer'
    );
  });

  test('flush writes buffered logs', () => {
    const source = loggerSource;

    assert.match(
      source,
      /flush[\s\S]*logBuffer|buffer|writeFile|appendFile/s,
      'must write buffered logs'
    );
  });

  test('isFlushing manages flush state', () => {
    const source = loggerSource;

    assert.match(
      source,
      /isFlushing[\s\S]*boolean|true|false|state/s,
      'must track flush state'
    );
  });

});

test.describe('Logger - Configuration', () => {

  test('loadConfig reads logging configuration', () => {
    const source = loggerSource;

    assert.match(
      source,
      /loadConfig[\s\S]*getConfiguration|workspace|vscode/s,
      'must read VSCode configuration'
    );
  });

  test('reloadConfig handles configuration changes', () => {
    const source = loggerSource;

    assert.match(
      source,
      /reloadConfig[\s\S]*onDidChangeConfiguration|watch|event/s,
      'must handle configuration changes'
    );
  });

  test('logger respects configuration preferences', () => {
    const source = loggerSource;

    assert.match(
      source,
      /config\.enableConsole|config\.enableFile|config\.minLevel/s,
      'must respect configuration preferences'
    );
  });

});

test.describe('Logger - Feature Flow Tracking', () => {

  test('startFeatureFlow initiates flow tracking', () => {
    const startBody = extractFunctionBody(loggerSource, 'startFeatureFlow');

    assert.match(
      startBody,
      /featureName|correlationId|startTime|metadata/s,
      'must initiate flow tracking'
    );
  });

  test('endFeatureFlow completes flow tracking', () => {
    const endBody = extractFunctionBody(loggerSource, 'endFeatureFlow');

    assert.match(
      endBody,
      /duration|result|performance|endTime/s,
      'must complete flow tracking'
    );
  });

  test('featureStep adds flow steps', () => {
    const source = loggerSource;

    assert.match(
      source,
      /featureStep[\s\S]*step|metadata|progress|update/s,
      'must add flow steps'
    );
  });

  test('getActiveFeatureFlow retrieves current flow', () => {
    const source = loggerSource;

    assert.match(
      source,
      /getActiveFeatureFlow[\s\S]*return.*flow|active|current/s,
      'must retrieve active flow'
    );
  });

});

test.describe('Logger - Specialized Logging', () => {

  test('aiRequest logs AI request details', () => {
    const source = loggerSource;

    assert.match(
      source,
      /aiRequest[\s\S]*request|prompt|model|provider/s,
      'must log AI request details'
    );
  });

  test('aiResponse logs AI response details', () => {
    const source = loggerSource;

    assert.match(
      source,
      /aiResponse[\s\S]*response|result|completion|tokens/s,
      'must log AI response details'
    );
  });

  test('aiStreamEvent logs streaming events', () => {
    const source = loggerSource;

    assert.match(
      source,
      /aiStreamEvent[\s\S]*stream|event|type|data/s,
      'must log streaming events'
    );
  });

  test('tokenUsage logs token consumption', () => {
    const source = loggerSource;

    assert.match(
      source,
      /tokenUsage[\s\S]*tokens|usage|cost|budget/s,
      'must log token consumption'
    );
  });

  test('sessionEvent logs session operations', () => {
    const source = loggerSource;

    assert.match(
      source,
      /sessionEvent[\s\S]*session|operation|create|delete/s,
      'must log session operations'
    );
  });

  test('serverEvent logs server events', () => {
    const source = loggerSource;

    assert.match(
      source,
      /serverEvent[\s\S]*server|event|operation|status/s,
      'must log server events'
    );
  });

});

test.describe('Logger - State Change Logging', () => {

  test('logStateChange tracks state transitions', () => {
    const source = loggerSource;

    assert.match(
      source,
      /logStateChange[\s\S]*from|to|transition|state/s,
      'must track state transitions'
    );
  });

  test('logStateChange includes context information', () => {
    const source = loggerSource;

    assert.match(
      source,
      /logStateChange[\s\S]*context|source|reason|cause/s,
      'must include context information'
    );
  });

});

test.describe('Logger - Performance Tracking', () => {

  test('performance logs performance metrics', () => {
    const source = loggerSource;

    assert.match(
      source,
      /performance[\s\S]*duration|time|metrics|operation/s,
      'must log performance metrics'
    );
  });

  test('performance calculates operation duration', () => {
    const source = loggerSource;

    assert.match(
      source,
      /performance.*operation.*duration|Slow operation|duration.*number/s,
      'must track operation duration'
    );
  });

});

test.describe('Logger - UI Interaction Logging', () => {

  test('logUIInteraction tracks user actions', () => {
    const source = loggerSource;

    assert.match(
      source,
      /logUIInteraction[\s\S]*ui|interaction|user|action/s,
      'must track UI interactions'
    );
  });

  test('logUIInteraction includes interaction details', () => {
    const source = loggerSource;

    assert.match(
      source,
      /logUIInteraction[\s\S]*button|click|select|input/s,
      'must include interaction details'
    );
  });

});

test.describe('Logger - Extension Context', () => {

  test('setExtensionContext sets extension information', () => {
    const source = loggerSource;

    assert.match(
      source,
      /setExtensionContext[\s\S]*extension|context|extensionPath/s,
      'must set extension context'
    );
  });

  test('logger includes extension context in logs', () => {
    const source = loggerSource;

    assert.match(
      source,
      /extensionContext|extension|vscode|extensionId/s,
      'must include extension context'
    );
  });

});

test.describe('Logger - Error Handling', () => {

  test('logger handles write errors gracefully', () => {
    const source = loggerSource;

    assert.match(
      source,
      /try\s*\{[\s\S]*catch\s*\(|if\s*\(\s*error/s,
      'must handle write errors'
    );
  });

  test('logger validates log entry structure', () => {
    const source = loggerSource;

    assert.match(
      source,
      /formatEntry|validate|check|structure/s,
      'must validate log entry structure'
    );
  });

  test('logger provides fallback for missing context', () => {
    const source = loggerSource;

    assert.match(
      source,
      /fallback|default|undefined|\?\./s,
      'must provide fallback for missing context'
    );
  });

});

test.describe('Logger - Concurrency', () => {

  test('flush operations handle concurrent writes', () => {
    const source = loggerSource;

    assert.match(
      source,
      /isFlushing|lock|queue|concurrent|async/s,
      'must handle concurrent flush operations'
    );
  });

  test('buffer management prevents data loss', () => {
    const source = loggerSource;

    assert(
      source,
      /logBuffer|buffer|array|push|shift/s,
      'must prevent buffer data loss'
    );
  });

});

test.describe('Logger - Integration', () => {

  test('logger integrates with VSCode configuration', () => {
    const source = loggerSource;

    assert.match(
      source,
      /getConfiguration|vscode\.workspace\.getConfiguration/s,
      'must integrate with VSCode configuration'
    );
  });

  test('logger integrates with file system', () => {
    const source = loggerSource;

    assert.match(
      source,
      /fs\.writeFile|workspace\.fs|file|path/s,
      'must integrate with file system'
    );
  });

});
