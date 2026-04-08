import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorBuilder } from '../../../src/providers/chat/ErrorBuilder.ts';

test.describe('ErrorBuilder', () => {
  test('extracts API error from message.info.error.data.message', () => {
    const mockLogger = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };

    const mockIsTimeoutError = () => false;

    const errorBuilder = new ErrorBuilder(mockLogger, mockIsTimeoutError);

    const message = {
      info: {
        error: {
          name: 'UnknownError',
          data: {
            message: 'Token refresh failed: 401'
          }
        }
      }
    };

    const result = errorBuilder.extractError(message);

    assert.equal(result?.type, 'api_error');
    assert.equal(result?.message, 'Token refresh failed: 401');
    assert.equal(result?.originalError, 'Token refresh failed: 401');
    assert.equal(result?.canRetry, true);
  });

  test('detects timeout errors', () => {
    const mockLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    const mockIsTimeoutError = (msg) => msg.toLowerCase().includes('timeout');

    const errorBuilder = new ErrorBuilder(mockLogger, mockIsTimeoutError);

    const message = {
      error: 'Request timeout: 120000ms exceeded'
    };

    const result = errorBuilder.extractError(message);

    assert.equal(result?.type, 'timeout');
    assert.equal(result?.message, 'Request timed out. Please retry.');
    assert.equal(result?.canRetry, true);
  });

  test('returns null when no error found', () => {
    const mockLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    const mockIsTimeoutError = () => false;

    const errorBuilder = new ErrorBuilder(mockLogger, mockIsTimeoutError);

    const message = {
      content: 'Normal message'
    };

    const result = errorBuilder.extractError(message);

    assert.equal(result, null);
  });
});
