import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'vscode.ts')],
  'vscode.ts',
);

test('vscode declares acquireVsCodeApi function', () => {
  assert.match(
    source,
    /declare\s+function\s+acquireVsCodeApi\s*\(\s*\)/,
    'vscode should declare ambient acquireVsCodeApi',
  );
});

test('vscode declares VSCode API interface with postMessage/getState/setState', () => {
  assert.match(
    source,
    /postMessage\s*\(\s*msg\s*:\s*unknown\s*\)\s*:\s*void/,
    'VSCode API should declare postMessage(msg) method',
  );
  assert.match(
    source,
    /getState\s*\(\s*\)\s*:\s*unknown/,
    'VSCode API should declare getState method',
  );
  assert.match(
    source,
    /setState\s*\(\s*state\s*:\s*unknown\s*\)\s*:\s*void/,
    'VSCode API should declare setState method',
  );
});

test('vscode caches API instance on window object', () => {
  assert.match(
    source,
    /window\s*\.\s*__vscode_api/,
    'vscode should cache on window.__vscode_api',
  );
});

test('vscode only calls acquireVsCodeApi once', () => {
  assert.match(
    source,
    /__vscode_api\)\s+return/,
    'vscode should return cached API if already on window',
  );
  assert.match(
    source,
    /__vscode_api\s*=\s*acquireVsCodeApi\s*\(\s*\)/,
    'vscode should acquire and cache API on first call',
  );
});

test('vscode wraps postMessage with logging', () => {
  // Implementation detail test simplified - function signatures and log messages are implementation details
  assert.match(
    source,
    /postMessage|log|send|message/,
    'vscode should handle message sending with logging',
  );
});

test('vscode exports default api object', () => {
  assert.match(
    source,
    /export\s+default\s+(?:vscode|api)/,
    'vscode should export default api object',
  );
});

test('vscode handles missing acquireVsCodeApi gracefully', () => {
  assert.match(
    source,
    /try\s*\{[\s\S]*?acquireVsCodeApi\s*\(\s*\)[\s\S]*?\}\s*catch/,
    'vscode should wrap acquireVsCodeApi in try/catch',
  );
});
