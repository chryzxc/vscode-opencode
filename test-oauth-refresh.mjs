#!/usr/bin/env node
/**
 * Test OpenAI OAuth token refresh endpoint
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

// Read auth.json
const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const openaiAuth = authData.openai;

console.log('=== OpenAI OAuth Configuration ===');
console.log('Client ID:', openaiAuth.client_id || 'Not found in auth.json');
console.log('Has refresh token:', !!openaiAuth.refresh);
console.log('Access token expires:', new Date(openaiAuth.expires).toISOString());
console.log('Current time:', new Date().toISOString());
console.log('Is expired:', openaiAuth.expires < Date.now());

// Test different possible OAuth endpoints
const endpoints = [
  'https://auth.openai.com/oauth/token',
  'https://api.openai.com/v1/auth/token',
  'https://chatgpt.com/backend-api/token',
];

async function testEndpoint(endpoint) {
  console.log(`\n=== Testing: ${endpoint} ===`);

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: openaiAuth.refresh,
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
    });

    const options = {
      hostname: new URL(endpoint).hostname,
      path: new URL(endpoint).pathname + new URL(endpoint).search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
        try {
          const json = JSON.parse(data);
          console.log('Response:', JSON.stringify(json, null, 2));
          if (json.access_token) {
            console.log('✅ SUCCESS - Got new access token!');
          }
        } catch {
          console.log('Response (non-JSON):', data);
        }
        resolve(res.statusCode);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      console.log('❌ Request timed out');
      resolve(null);
    });

    req.on('error', (error) => {
      console.log('❌ Error:', error.message);
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

// Test each endpoint
for (const endpoint of endpoints) {
  await testEndpoint(endpoint);
}

console.log('\n=== Summary ===');
console.log('If any endpoint returned 200 with access_token, that endpoint works.');
console.log('If all failed, the OAuth flow may be different or require additional parameters.');
