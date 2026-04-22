import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'logger.ts')],
  'logger.ts',
);

test('logger defines LogLevel type with standard severity levels', () => {
  assert.match(
    source,
    /type\s+LogLevel\s*=\s*['"]debug['"]\s*\|\s*['"]info['"]\s*\|\s*['"]warn['"]\s*\|\s*['"]error['"]/,
    'logger should define LogLevel as debug|info|warn|error union',
  );
});

test('logger sets default log level to info', () => {
  assert.match(
    source,
    /logLevel\s*:\s*LogLevel\s*=\s*['"]info['"]/,
    'WebviewLogger should default to info level',
  );
});

test('logger exports WebviewLogger class', () => {
  assert.match(
    source,
    /(?:class|export)\s+WebviewLogger/,
    'logger should export WebviewLogger class',
  );
});

test('WebviewLogger has public debug/info/warn/error methods', () => {
  assert.match(
    source,
    /(?:public\s+)?debug\s*\(/,
    'WebviewLogger should have debug method',
  );
  assert.match(
    source,
    /(?:public\s+)?info\s*\(/,
    'WebviewLogger should have info method',
  );
  assert.match(
    source,
    /(?:public\s+)?warn\s*\(/,
    'WebviewLogger should have warn method',
  );
  assert.match(
    source,
    /(?:public\s+)?error\s*\(/,
    'WebviewLogger should have error method',
  );
});

test('WebviewLogger prefixes messages with [WebView]', () => {
  assert.match(
    source,
    /\[WebView\]/,
    'WebviewLogger should prefix console output with [WebView]',
  );
});

test('WebviewLogger posts log messages to extension host', () => {
  assert.match(
    source,
    /postMessage\s*\(\s*\{[\s\S]*?type\s*:\s*['"]webviewLog['"]\s*[,}]/,
    'WebviewLogger should postMessage with type webviewLog',
  );
  assert.match(
    source,
    /source\s*:\s*['"]webview-react['"]/,
    'WebviewLogger should identify as webview-react source',
  );
});

test('WebviewLogger includes timestamp in log messages', () => {
  assert.match(
    source,
    /timestamp\s*:\s*Date\.now\s*\(\s*\)/,
    'WebviewLogger should include Date.now() timestamp',
  );
});

test('WebviewLogger implements log level filtering', () => {
  assert.match(
    source,
    /shouldLog\s*\(\s*(?:level|logLevel)\s*\)/,
    'WebviewLogger should filter by log level',
  );
});

test('logger exports default singleton instance', () => {
  assert.match(
    source,
    /export\s+default\s+(?:new\s+WebviewLogger|logger)/,
    'logger should export default singleton',
  );
});
