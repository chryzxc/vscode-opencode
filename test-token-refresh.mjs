#!/usr/bin/env node
/**
 * Test the OpenAI token refresh implementation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

const authPath = path.join(
  os.homedir(),
  '.local',
  'share',
  'opencode',
  'auth.json'
);

const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REQUEST_TIMEOUT_MS = 10_000;

// Helper functions
function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function testTokenRefresh() {
  console.log('=== Testing OpenAI Token Refresh Implementation ===\n');

  // Read auth.json
  const authData = readJsonFile(authPath);
  if (!authData?.openai) {
    console.log('❌ No OpenAI auth found in auth.json');
    return;
  }

  const auth = authData.openai;
  console.log('1. Initial State:');
  console.log('   Access token expires:', new Date(auth.expires).toISOString());
  console.log('   Current time:', new Date().toISOString());
  console.log('   Is expired:', auth.expires < Date.now() - 60000);

  // Check if token is expired and refresh if needed
  let token = auth.access;
  const expired = auth?.expires
    ? auth.expires < Date.now() - 60000  // 60s buffer
    : true;

  if (expired && auth?.refresh) {
    console.log('\n2. Token is expired, attempting refresh...');

    try {
      const refreshRaw = await httpsPost(
        OPENAI_OAUTH_TOKEN_URL,
        {
          'Content-Type': 'application/json',
        },
        JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: auth.refresh,
          client_id: OPENAI_CLIENT_ID,
        }),
      );
      const refreshed = JSON.parse(refreshRaw);

      if (refreshed.access_token) {
        console.log('   ✅ Refresh successful!');
        console.log('   New token received');

        token = refreshed.access_token;

        // Update auth.json with new tokens
        if (authData?.openai) {
          authData.openai.access = refreshed.access_token;
          if (refreshed.refresh_token) {
            authData.openai.refresh = refreshed.refresh_token;
          }
          if (refreshed.expires_in) {
            authData.openai.expires = Date.now() + (refreshed.expires_in * 1000);
          }

          if (writeJsonFile(authPath, authData)) {
            console.log('   ✅ auth.json updated successfully');
            console.log('   New expiry:', new Date(authData.openai.expires).toISOString());
          } else {
            console.log('   ❌ Failed to update auth.json');
          }
        }
      }
    } catch (refreshError) {
      console.log('   ❌ Token refresh failed:', refreshError.message);
    }
  }

  // Test the quota API call with the new token
  console.log('\n3. Testing quota API with refreshed token...');
  try {
    const raw = await httpsGet(OPENAI_USAGE_URL, {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'vscode-opencode-quota-monitor/1.0',
      'Content-Type': 'application/json',
    });
    const json = JSON.parse(raw);

    if (json.rate_limit) {
      console.log('   ✅ Quota API call successful!');
      console.log('   Rate limit data received');
      console.log('   Weekly window:', json.rate_limit.weekly_window ? '✓' : '✗');
      console.log('   Primary window:', json.rate_limit.primary_window ? '✓' : '✗');
      console.log('   Allotments:', json.allotments?.length || 0);
    } else {
      console.log('   ⚠️  Unexpected response structure');
    }
  } catch (apiError) {
    console.log('   ❌ Quota API call failed:', apiError.message);
  }

  console.log('\n=== Test Complete ===');
  console.log('If you see ✅ marks above, the token refresh is working!');
}

testTokenRefresh().catch(console.error);
