#!/usr/bin/env tsx

/**
 * Test script to demonstrate the enhanced structured logger functionality
 *
 * Run with: npx tsx scripts/test-logger.ts
 *
 * This script demonstrates:
 * - Colored output with symbols
 * - Pretty, JSON, and Hybrid console modes
 * - Log levels (error, warn, info, debug)
 * - Context and error handling
 * - Specialized logging methods
 * - Feature flow tracking
 */

// Mock VSCode API for standalone testing
const mockVscode = {
  workspace: {
    getConfiguration: (section: string) => {
      return {
        get: <T,>(key: string, defaultValue: T): T => {
          const config: Record<string, any> = {
            'opencode.logging.level': 'debug',
            'opencode.logging.enableConsole': true,
            'opencode.logging.enableFile': false,
            'opencode.logging.maxFileSize': 5242880,
            'opencode.logging.maxFiles': 3,
            'opencode.logging.consoleOutputMode': process.env.LOG_MODE || 'pretty',
            'opencode.logging.enableColors': process.env.NO_COLOR !== '1',
          };
          return config[key] ?? defaultValue;
        }
      };
    }
  }
};

// Mock extension context
const mockContext = {
  globalStorageUri: { fsPath: '/tmp/test-logs' }
};

async function main() {
  console.log('=== Enhanced Structured Logger Test ===\n');

  // Import logger after mocks are set
  const { logger, createLogger } = await import('../src/utils/Logger.js');

  // Initialize logger with mock context
  logger.setExtensionContext(mockContext as any);

  console.log('\n--- Test 1: Pretty Mode (Colored) ---\n');
  logger.reloadConfig();

  const log = createLogger('TestComponent');

  // Basic logging levels
  log.error('Test error message', { errorCode: 500, retryable: true });
  log.warn('Test warning message', { threshold: 90 });
  log.info('Test info message', { operation: 'test', duration: 123 });
  log.debug('Test debug message', { detailed: true, nested: { value: 42 } });

  console.log('\n--- Test 2: Error with Stack Trace ---\n');
  const testError = new Error('Test error with stack trace');
  testError.stack = 'Error: Test error with stack trace\n    at Test.main (test.ts:10:15)\n    at Object.<anonymous> (test.ts:5:10)';
  log.error('Operation failed', { operation: 'database.query' }, testError);

  console.log('\n--- Test 3: Specialized Methods ---\n');

  log.aiRequest('session-123', 'claude-opus-4-8', 'Hello, world!', { contextSize: 1024 });
  log.aiResponse('session-123', 1234, 5678);
  log.tokenUsage('anthropic', 1000, 2000);
  log.performance('databaseQuery', 45, { query: 'SELECT * FROM users' });
  log.serverEvent('start', { port: 4097 });
  log.sessionEvent('create', 'session-456', { title: 'Test Session' });

  console.log('\n--- Test 4: Feature Flow Tracking ---\n');

  const correlationId = log.startFeatureFlow('DataImport', {
    source: 'api',
    recordCount: 100
  });

  log.featureStep(correlationId, 'validation', { valid: 95, invalid: 5 });
  log.featureStep(correlationId, 'transformation', { transformed: 95 });
  log.featureStep(correlationId, 'loading', { loaded: 95 });

  log.endFeatureFlow(correlationId, {
    success: true,
    imported: 95,
    failed: 5
  });

  console.log('\n--- Test 5: State Change Tracking ---\n');

  log.logStateChange('connectionStatus', 'disconnected', 'connected', 'UserAction');
  log.logStateChange('progress', 0, 50, 'DataImport');
  log.logStateChange('progress', 50, 100, 'DataImport');

  console.log('\n--- Test 6: UI Interaction Logging ---\n');

  log.logUIInteraction('ChatPanel', 'sendMessage', 'sendButton', { messageLength: 42 });
  log.logUIInteraction('SettingsPanel', 'changeConfig', 'colorSchemeSelect', {
    oldValue: 'dark',
    newValue: 'light'
  });

  console.log('\n--- Test 7: JSON Mode ---\n');

  // Switch to JSON mode
  process.env.LOG_MODE = 'json';
  logger.reloadConfig();

  log.info('JSON mode test', { mode: 'json', timestamp: Date.now() });
  log.error('JSON error test', { code: 500 });
  log.warn('JSON warning test', { threshold: 90 });

  console.log('\n--- Test 8: Hybrid Mode ---\n');

  // Switch to Hybrid mode
  process.env.LOG_MODE = 'hybrid';
  logger.reloadConfig();

  log.info('Hybrid mode test', { mode: 'hybrid', showsBoth: true });
  log.error('Hybrid error test', { demonstrates: 'both outputs' });

  console.log('\n--- Test 9: Colors Disabled ---\n');

  // Disable colors
  process.env.NO_COLOR = '1';
  process.env.LOG_MODE = 'pretty';
  logger.reloadConfig();

  log.info('No color test', { plain: 'output' });
  log.warn('Plain warning', { noColors: true });
  log.error('Plain error', { grayscale: true });

  console.log('\n--- Test 10: Performance Warnings ---\n');

  process.env.NO_COLOR = '0';
  logger.reloadConfig();

  log.performance('fastOperation', 100);
  log.performance('slowOperation', 5000); // Should generate a warning

  console.log('\n=== Test Complete ===\n');

  // Cleanup
  await logger.dispose();
}

main().catch(error => {
  console.error('Test script failed:', error);
  process.exit(1);
});
