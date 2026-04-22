import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'ErrorBuilder.ts')],
  'ErrorBuilder.ts',
);

test('ErrorBuilder extractError prioritizes API errors before timeout and structured-output checks', () => {
  const extractBody = extractFunctionBody(
    source,
    'extractError(message: any): DisplayError | null {',
  );

  assert.match(
    extractBody,
    /if \(!message \|\| typeof message !== 'object'\) \{[\s\S]*return null;/,
    'extractError should ignore non-object message values',
  );
  assert.match(
    extractBody,
    /const apiError = this\.extractApiError\(message\);[\s\S]*if \(apiError\) \{[\s\S]*return apiError;[\s\S]*const timeoutError = this\.extractTimeoutError\(message\);[\s\S]*if \(timeoutError\) \{[\s\S]*return timeoutError;[\s\S]*const structuredOutputError = this\.extractStructuredOutputError\(message\);[\s\S]*if \(structuredOutputError\) \{[\s\S]*return structuredOutputError;/,
    'extractError should evaluate API errors first, then timeout errors, then structured-output errors',
  );
  assert.match(
    extractBody,
    /return null;/,
    'extractError should return null when no error extractor recognizes the message',
  );
});

test('ErrorBuilder extractApiError lifts nested API messages into retryable display errors', () => {
  const apiBody = extractFunctionBody(
    source,
    'private extractApiError(message: any): DisplayError | null {',
  );

  assert.match(
    apiBody,
    /const apiErrorMessage = message\?\.info\?\.error\?\.data\?\.message;/,
    'extractApiError should read the nested API error message from message.info.error.data.message',
  );
  assert.match(
    apiBody,
    /if \(typeof apiErrorMessage === 'string' && apiErrorMessage\.trim\(\)\.length > 0\) \{[\s\S]*return \{/,
    'extractApiError should require a non-empty string message before creating a display error',
  );
  assert.match(
    apiBody,
    /type: 'api_error',[\s\S]*message: apiErrorMessage\.trim\(\),[\s\S]*originalError: apiErrorMessage,[\s\S]*canRetry: true,/,
    'extractApiError should return a retryable api_error payload using trimmed and original message values',
  );
  assert.match(
    apiBody,
    /metadata: \{[\s\S]*errorName: message\?\.info\?\.error\?\.name,[\s\S]*statusCode: message\?\.info\?\.error\?\.data\?\.statusCode,[\s\S]*\},/,
    'extractApiError should preserve API error name and status code metadata for the UI',
  );
});

test('ErrorBuilder extractTimeoutError reuses timeout detection callback across top-level and nested errors', () => {
  const timeoutBody = extractFunctionBody(
    source,
    'private extractTimeoutError(message: any): DisplayError | null {',
  );

  assert.match(
    timeoutBody,
    /const errorMessage = message\?\.error \|\| message\?\.info\?\.error\?\.data\?\.message \|\| '';/,
    'extractTimeoutError should inspect both message.error and message.info.error.data.message',
  );
  assert.match(
    timeoutBody,
    /if \(typeof errorMessage === 'string' &&[\s\S]*this\.isLikelyInteractiveAwaitTimeoutError\(errorMessage\)\) \{[\s\S]*return \{/,
    'extractTimeoutError should defer timeout classification to the injected isLikelyInteractiveAwaitTimeoutError callback',
  );
  assert.match(
    timeoutBody,
    /type: 'timeout',[\s\S]*message: 'Request timed out\. Please retry\.',[\s\S]*originalError: errorMessage,[\s\S]*canRetry: true,/,
    'extractTimeoutError should convert matching errors into retryable timeout display errors',
  );
});

test('ErrorBuilder leaves structured-output extraction as an explicit null placeholder', () => {
  const structuredBody = extractFunctionBody(
    source,
    'private extractStructuredOutputError(message: any): DisplayError | null {',
  );

  assert.match(
    structuredBody,
    /This is handled by existing logic in ChatViewProvider/,
    'extractStructuredOutputError should document that structured-output handling remains in ChatViewProvider',
  );
  assert.match(
    structuredBody,
    /return null;/,
    'extractStructuredOutputError should currently be a no-op placeholder that returns null',
  );
  assert.doesNotMatch(
    structuredBody,
    /type:\s*'structured_output'|type:\s*"structured_output"|return \{/,
    'extractStructuredOutputError should not fabricate a structured-output error object in this module yet',
  );
});
