#!/usr/bin/env node
/**
 * Diagnostic script to identify why OpenAI quota monitor returns no data
 *
 * Phase 1: Root Cause Investigation - Gathering Evidence
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

// Configuration
const AUTH_PATH = path.join(
  os.homedir(),
  '.local',
  'share',
  'opencode',
  'auth.json'
);

const OPENAI_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const REQUEST_TIMEOUT_MS = 10_000;

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, symbol, message) {
  console.log(`${color}${symbol} ${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + colors.cyan + '═'.repeat(60) + colors.reset);
  console.log(colors.cyan + `  ${title}` + colors.reset);
  console.log(colors.cyan + '═'.repeat(60) + colors.reset + '\n');
}

// Test 1: Check if auth.json exists
section('TEST 1: auth.json File Existence');
if (fs.existsSync(AUTH_PATH)) {
  log(colors.green, '✓', `auth.json exists at: ${AUTH_PATH}`);
  try {
    const authData = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    log(colors.green, '✓', 'auth.json is valid JSON');

    // Check OpenAI auth
    if (authData.openai) {
      log(colors.green, '✓', 'OpenAI auth section exists');
      if (authData.openai.access) {
        const maskedAccess = authData.openai.access.substring(0, 20) + '...';
        log(colors.green, '✓', `OpenAI access token present: ${maskedAccess}`);

        // Test the API call
        section('TEST 2: OpenAI API Call');
        log(colors.blue, '→', `Attempting to fetch: ${OPENAI_USAGE_URL}`);

        const testApiCall = () => {
          return new Promise((resolve, reject) => {
            const parsed = new URL(OPENAI_USAGE_URL);
            const options = {
              hostname: parsed.hostname,
              path: parsed.pathname + parsed.search,
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${authData.openai.access}`,
                'User-Agent': 'vscode-opencode-quota-monitor/1.0',
                'Content-Type': 'application/json',
              },
              timeout: REQUEST_TIMEOUT_MS,
            };

            log(colors.blue, '→', 'Request headers:');
            log(colors.blue, '  ', `  Authorization: Bearer ${maskedAccess}`);
            log(colors.blue, '  ', `  User-Agent: ${options.headers['User-Agent']}`);

            const req = https.request(options, (res) => {
              let data = '';
              log(colors.green, '✓', `Response status: ${res.statusCode} ${res.statusMessage}`);

              // Log response headers
              log(colors.blue, '→', 'Response headers:');
              for (const [key, value] of Object.entries(res.headers)) {
                log(colors.blue, '  ', `  ${key}: ${value}`);
              }

              res.on('data', (chunk) => { data += chunk; });
              res.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  log(colors.green, '✓', 'Response is valid JSON');

                  section('TEST 3: Response Structure Analysis');
                  log(colors.blue, '→', 'Top-level keys:', Object.keys(json).join(', '));

                  // Check for rate_limit
                  if (json.rate_limit) {
                    log(colors.green, '✓', 'rate_limit field exists');
                    log(colors.blue, '→', 'rate_limit keys:', Object.keys(json.rate_limit).join(', '));

                    // Check for weekly_window
                    if (json.rate_limit.weekly_window) {
                      log(colors.green, '✓', 'weekly_window exists');
                      log(colors.magenta, 'ℹ', JSON.stringify(json.rate_limit.weekly_window, null, 2));
                    } else if (json.rate_limit.secondary_window) {
                      log(colors.yellow, '⚠', 'weekly_window not found, but secondary_window exists');
                      log(colors.magenta, 'ℹ', JSON.stringify(json.rate_limit.secondary_window, null, 2));
                    } else {
                      log(colors.red, '✗', 'No weekly_window or secondary_window found in rate_limit');
                    }

                    // Check for primary_window
                    if (json.rate_limit.primary_window) {
                      log(colors.green, '✓', 'primary_window exists');
                      log(colors.magenta, 'ℹ', JSON.stringify(json.rate_limit.primary_window, null, 2));
                    } else {
                      log(colors.red, '✗', 'No primary_window found in rate_limit');
                    }
                  } else {
                    log(colors.red, '✗', 'rate_limit field NOT found in response');
                  }

                  // Check for allotments
                  if (json.allotments && Array.isArray(json.allotments)) {
                    log(colors.green, '✓', `allotments array exists with ${json.allotments.length} items`);
                    if (json.allotments.length > 0) {
                      log(colors.magenta, 'ℹ', 'First allotment:', JSON.stringify(json.allotments[0], null, 2));
                    }
                  } else {
                    log(colors.red, '✗', 'allotments array NOT found or not an array');
                  }

                  // Check for plan_type
                  if (json.plan_type) {
                    log(colors.green, '✓', `plan_type: ${json.plan_type}`);
                  } else {
                    log(colors.yellow, '⚠', 'plan_type not found');
                  }

                  // Show full response for debugging
                  section('TEST 4: Full API Response');
                  log(colors.magenta, 'ℹ', 'Complete response body:');
                  console.log(JSON.stringify(json, null, 2));

                  resolve(json);
                } catch (e) {
                  log(colors.red, '✗', `Failed to parse JSON: ${e.message}`);
                  log(colors.magenta, 'ℹ', 'Raw response:');
                  console.log(data);
                  reject(e);
                }
              });
            });

            req.on('timeout', () => {
              req.destroy();
              log(colors.red, '✗', 'Request timed out after ' + REQUEST_TIMEOUT_MS + 'ms');
              reject(new Error('Request timed out'));
            });

            req.on('error', (error) => {
              log(colors.red, '✗', `Request error: ${error.message}`);
              reject(error);
            });

            req.end();
          });
        };

        try {
          await testApiCall();
        } catch (error) {
          log(colors.red, '✗', `API call failed: ${error.message}`);
        }

      } else {
        log(colors.red, '✗', 'OpenAI access token NOT found in auth.json');
      }
    } else {
      log(colors.red, '✗', 'OpenAI auth section NOT found in auth.json');
      log(colors.yellow, '⚠', 'Available sections:', Object.keys(authData).join(', '));
    }
  } catch (error) {
    log(colors.red, '✗', `Failed to parse auth.json: ${error.message}`);
  }
} else {
  log(colors.red, '✗', `auth.json does NOT exist at: ${AUTH_PATH}`);
  log(colors.yellow, '⚠', 'The QuotaService requires this file to fetch quota data');
}

// Summary
section('SUMMARY');
log(colors.cyan, '→', 'If auth.json exists and API call succeeds:');
log(colors.cyan, '  ', 'Check if rate_limit.weekly_window exists in response');
log(colors.cyan, '  ', 'Check if rate_limit.primary_window exists in response');
log(colors.cyan, '  ', 'Check if allotments array exists and has items');
log(colors.cyan, '→', 'If auth.json does not exist:');
log(colors.cyan, '  ', 'You need to configure OpenAI authentication');
log(colors.cyan, '→', 'If API call fails:');
log(colors.cyan, '  ', 'Check your access token validity');
log(colors.cyan, '  ', 'Check your network connection');
log(colors.cyan, '  ', 'The API endpoint may have changed');
