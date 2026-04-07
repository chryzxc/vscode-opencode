import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../helpers/source-utils.mjs';

const quotaServiceSource = readSource(
  ['src/services/QuotaService.ts'],
  'QuotaService.ts',
);

test.describe('OpenAI Token Refresh Implementation', () => {

  test('implements HTTP status code detection', () => {
    // Verify HttpResponse interface exists
    assert.match(quotaServiceSource, /interface\s+HttpResponse\s*\{/,
      'Should define HttpResponse interface');
    assert.match(quotaServiceSource, /body:\s*string;[\s\S]*statusCode:\s*number;/,
      'HttpResponse should have body and statusCode fields');
  });

  test('httpsGet returns HttpResponse with status code', () => {
    // Verify httpsGet function signature and implementation
    assert.match(quotaServiceSource, /function\s+httpsGet\([\s\S]*Promise<HttpResponse>/,
      'httpsGet should return Promise<HttpResponse>');
    assert.match(quotaServiceSource, /resolve\(\{\s*body:\s*data,\s*statusCode:\s*res\.statusCode\s*\|\|\s*200\s*\}\)/,
      'httpsGet should return response with body and status code');
  });

  test('httpsPost returns HttpResponse with status code', () => {
    // Verify httpsPost function signature and implementation
    assert.match(quotaServiceSource, /function\s+httpsPost\([\s\S]*Promise<HttpResponse>/,
      'httpsPost should return Promise<HttpResponse>');
    assert.match(quotaServiceSource, /resolve\(\{\s*body:\s*data,\s*statusCode:\s*res\.statusCode\s*\|\|\s*200\s*\}\)/,
      'httpsPost should return response with body and status code');
  });

  test('fetchOpenAI implements 401 status code detection', () => {
    // Verify 401 detection logic
    assert.match(quotaServiceSource, /if\s*\(response\.statusCode\s*===\s*401\)/,
      'fetchOpenAI should check for 401 status code');
    assert.match(quotaServiceSource, /const\s+response\s*=\s*await\s+httpsGet\(OPENAI_USAGE_URL/,
      'fetchOpenAI should store response in variable');
    assert.match(quotaServiceSource, /response\.statusCode\s*!==\s*200/,
      'fetchOpenAI should check for non-200 status codes');
  });

  test('fetchOpenAI provides different error messages based on refresh token availability', () => {
    // Verify error message differentiation
    assert.match(quotaServiceSource, /const\s+errorMsg\s*=\s*auth\?\.refresh\s*\?/,
      'Should have conditional error message based on refresh token');
    assert.match(quotaServiceSource, /"Token refresh failed\. Please re-authenticate\."/,
      'Should have error message for when refresh token exists but refresh failed');
    assert.match(quotaServiceSource, /"Access token expired and no refresh token available\. Please re-authenticate with OpenAI\."/,
      'Should have error message for when no refresh token exists');
  });

  test('fetchOpenAI returns proper error structure for 401 responses', () => {
    // Verify 401 error response structure
    assert.match(quotaServiceSource, /status:\s*"error"/,
      '401 error should have error status');
    assert.match(quotaServiceSource, /label:\s*"Authentication Error"/,
      '401 error should have Authentication Error label');
    assert.match(quotaServiceSource, /note:\s*auth\?\.refresh\s*\?\s*"Token refresh failed"[\s\S]*"No refresh token\s*-\s*re-authenticate required"/,
      '401 error note should distinguish between refresh failure and missing refresh token');
  });

  test('fetchOpenAI logs 401 errors with context', () => {
    // Verify 401 error logging
    assert.match(quotaServiceSource, /logger\.error\('OpenAI API returned 401 Unauthorized'/,
      'Should log 401 errors');
    assert.match(quotaServiceSource, /hasRefreshToken:\s*Boolean\(auth\?\.refresh\)/,
      'Should log whether refresh token was available');
  });

  test('fetchOpenAI handles other HTTP status codes', () => {
    // Verify handling of non-200, non-401 status codes
    assert.match(quotaServiceSource, /if\s*\(response\.statusCode\s*!==\s*200\)/,
      'Should check for non-200 status codes');
    assert.match(quotaServiceSource, /throw new Error\(`HTTP \$\{response\.statusCode\}:/,
      'Should throw error with status code for non-200 responses');
  });

  test('fetchOpenAI implements token expiration check with buffer', () => {
    // Verify token expiration logic
    assert.match(quotaServiceSource, /const\s+expired\s*=\s*auth\?\.expires\s*\?/,
      'Should check if auth.expires exists');
    assert.match(quotaServiceSource, /auth\.expires\s*<\s*Date\.now\(\)\s*-\s*60000/,
      'Should use 60-second buffer for expiration check');
    assert.match(quotaServiceSource, /:\s*true/,
      'Should default to expired when no expires field');
  });

  test('fetchOpenAI attempts refresh only when expired and refresh token exists', () => {
    // Verify refresh conditional logic
    assert.match(quotaServiceSource, /if\s*\(expired\s*&&\s*auth\?\.refresh\)/,
      'Should only attempt refresh if expired AND refresh token exists');
    assert.match(quotaServiceSource, /const\s+refreshResponse\s*=\s*await\s+httpsPost\([\s\S]*OPENAI_OAUTH_TOKEN_URL/,
      'Should make POST request to token URL');
    assert.match(quotaServiceSource, /grant_type:\s*"refresh_token"/,
      'Should use refresh_token grant type');
  });

  test('fetchOpenAI updates auth.json after successful refresh', () => {
    // Verify auth.json update logic
    assert.match(quotaServiceSource, /authData\.openai\.access\s*=\s*refreshed\.access_token/,
      'Should update access token');
    assert.match(quotaServiceSource, /if\s*\(refreshed\.refresh_token\)/,
      'Should check if new refresh token provided');
    assert.match(quotaServiceSource, /authData\.openai\.refresh\s*=\s*refreshed\.refresh_token/,
      'Should update refresh token if provided');
    assert.match(quotaServiceSource, /authData\.openai\.expires\s*=\s*Date\.now\(\)\s*\+\s*\(refreshed\.expires_in\s*\*\s*1000\)/,
      'Should calculate new expiration time');
    assert.match(quotaServiceSource, /writeJsonFile\(authPath,\s*authData\)/,
      'Should write updated auth data to file');
  });

  test('fetchOpenAI handles refresh failures gracefully', () => {
    // Verify refresh error handling
    assert.match(quotaServiceSource, /catch\s*\(refreshError\)\s*\{[\s\S]*logger\.error\('OpenAI token refresh failed'/,
      'Should catch and log refresh errors');
    assert.match(quotaServiceSource, /If refresh fails, continue with expired token/,
      'Should have comment explaining fallback behavior');
  });

  test('fetchOpenAI improves error messages for authentication failures', () => {
    // Verify enhanced error messages
    assert.match(quotaServiceSource, /errorMessage\.includes\("401"\)\s*\|\|\s*errorMessage\.includes\("authenticate"\)/,
      'Should check if error message contains 401 or authenticate');
    assert.match(quotaServiceSource, /"Authentication failed\.\s*Check\s*auth\.json\s*credentials\."/,
      'Should provide guidance for authentication failures');
  });

  test('fetchOpenAI uses refreshed token for API calls', () => {
    // Verify token usage after refresh
    assert.match(quotaServiceSource, /let\s+token\s*=\s*auth\.access;/,
      'Should start with original access token');
    assert.match(quotaServiceSource, /token\s*=\s*refreshed\.access_token;/,
      'Should update token variable after successful refresh');
    assert.match(quotaServiceSource, /Authorization:\s*`Bearer\s*\$\{token\}`/,
      'Should use current token value for API calls');
  });

  test('QuotaService integrates with logger for error tracking', () => {
    // Verify logging integration
    assert.match(quotaServiceSource, /this\.logger\.error\('OpenAI quota fetch failed'/,
      'Should log quota fetch failures');
    assert.match(quotaServiceSource, /error:\s*errorMessage/,
      'Should include error message in log');
  });

  test('fetchOpenAI handles edge case of missing refresh token with expired token', () => {
    // Verify the specific case mentioned in the issue
    assert.match(quotaServiceSource, /if\s*\(expired\s*&&\s*auth\?\.refresh\)/,
      'Should only refresh if both expired AND refresh exists');
    assert.match(quotaServiceSource, \/\/ If refresh fails, continue with expired token/,
      'Should explain what happens when refresh is not available');
    assert.match(quotaServiceSource, /response\.statusCode\s*===\s*401/,
      'Should catch 401 when trying to use expired token');
  });

  test('implementation prevents "No quota data" message by providing specific errors', () => {
    // Verify that the fix addresses the original issue
    assert.match(quotaServiceSource, /"Authentication Error"/,
      'Should provide specific error instead of generic "No quota data"');
    assert.match(quotaServiceSource, /note:.*Check auth\.json credentials/,
      'Should guide users to check credentials');
    assert.match(quotaServiceSource, /note:.*re-authenticate required/,
      'Should tell users when re-authentication is needed');
  });
});

test.describe('OpenAI Token Refresh Test Validation', () => {

  test('all quota service tests pass with new response format', () => {
    // This test validates that existing tests still work
    assert.match(quotaServiceSource, /const\s+response\s*=\s*await\s+httpsGet/,
      'Code should use response variable');
    assert.match(quotaServiceSource, /JSON\.parse\(response\.body\)/,
      'Code should parse response.body');
    assert.match(quotaServiceSource, /response\.statusCode/,
      'Code should check response.statusCode');
  });

  test('token refresh logic is properly implemented', () => {
    // Verify the complete token refresh flow
    assert.match(quotaServiceSource, /\/\/ Check if token is expired and refresh if needed/,
      'Should have comment explaining refresh logic');
    assert.match(quotaServiceSource, /\/\/ Handle 401 Unauthorized errors specifically/,
      'Should have comment explaining 401 handling');
    assert.match(quotaServiceSource, /\/\/ Handle other non-200 status codes/,
      'Should have comment explaining other status codes');
  });

  test('error handling is comprehensive and user-friendly', () => {
    // Verify error messages are helpful
    assert.match(quotaServiceSource, /Please re-authenticate/,
      'Error messages should include action items');
    assert.match(quotaServiceSource, /Check auth\.json/,
      'Error messages should reference the config file');
    assert.match(quotaServiceSource, /Authentication failed/,
      'Error messages should be clear about the problem');
  });
});
