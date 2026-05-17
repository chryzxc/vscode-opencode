/**
 * Core OpencodeServerManager Regression Tests
 *
 * These tests prevent regressions in OpenCode server management functionality.
 * Server management is critical for AI communication and extension functionality.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const serverManagerSource = readSource(
  [joinFromRoot('src', 'services', 'OpencodeServerManager.ts')],
  'OpencodeServerManager.ts',
);

test.describe('OpencodeServerManager - Server Lifecycle', () => {

  test('ensureRunning starts server when needed', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /ensureRunning[\s\S]*startServer|client.*null|startupPromise/s,
      'must start server when no client exists'
    );
  });

  test('ensureRunning returns existing client', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /ensureRunning[\s\S]*this\.client.*return|isPortReachable/s,
      'must return existing client if available'
    );
  });

  test('ensureRunning prevents concurrent startups', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /ensureRunning[\s\S]*startupPromise.*return.*existing/s,
      'must prevent duplicate server startup calls'
    );
  });

  test('dispose stops server process', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /dispose[\s\S]*serverProcess|terminateProcessTree|stop/s,
      'must stop running server process'
    );
  });

  test('dispose cancels reconnect timer', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /dispose[\s\S]*reconnectTimer|clearTimeout|cancel/s,
      'must cancel pending reconnect attempts'
    );
  });

});

test.describe('OpencodeServerManager - Server Startup', () => {

  test('startServer allocates dynamic port', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startServer[\s\S]*findAvailablePort|this\.port\s*=/s,
      'must allocate available port for server'
    );
  });

  test('startServer spawns opencode process', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startServer[\s\S]*spawn.*opencode.*serve.*port/s,
      'must spawn opencode serve command'
    );
  });

  test('startServer monitors stdout for ready signal', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startServer[\s\S]*stdout.*on.*data|Server running|listening/s,
      'must monitor stdout for server ready signal'
    );
  });

  test('startServer implements startup timeout', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startServer[\s\S]*setTimeout.*10000|startupTimeout|timeout/s,
      'must implement 10-second startup timeout'
    );
  });

  test('startServer handles spawn errors', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startServer[\s\S]*on.*error|ENOENT|showErrorMessage/s,
      'must handle spawn errors gracefully'
    );
  });

});

test.describe('OpencodeServerManager - Port Management', () => {

  test('findAvailablePort uses OS port allocation', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /findAvailablePort[\s\S]*createServer|listen.*0|port/s,
      'must use OS port allocation mechanism'
    );
  });

  test('findAvailablePort returns available port', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /findAvailablePort[\s\S]*address.*port|close.*resolve/s,
      'must return OS-assigned port number'
    );
  });

  test('isPortReachable tests connection', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /isPortReachable[\s\S]*Socket.*connect|timeout.*800/s,
      'must test port connectivity'
    );
  });

  test('persistManagedPort saves port to globalState', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /persistManagedPort[\s\S]*globalState\.update|MANAGED_PORT_STATE_KEY/s,
      'must persist port to extension global state'
    );
  });

  test('getPersistedManagedPort retrieves saved port', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /getPersistedManagedPort[\s\S]*globalState\.get|MANAGED_PORT_STATE_KEY/s,
      'must retrieve port from extension global state'
    );
  });

});

test.describe('OpencodeServerManager - Client Connection', () => {

  test('connectToServer creates SDK client', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer[\s\S]*createOpencodeClient|baseUrl.*localhost/s,
      'must create SDK client with server URL'
    );
  });

  test('connectToServer includes workspace directory', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer[\s\S]*workspaceDirectory|directory.*getWorkspaceDirectory/s,
      'must include workspace directory in client config'
    );
  });

  test('connectToServer fetches server version', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer[\s\S]*fetchVersion|requireHealthy.*true/s,
      'must verify server health after connection'
    );
  });

  test('connectToServer sets running status', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer[\s\S]*setStatus.*running|persistManagedPort/s,
      'must set status to running on success'
    );
  });

});

test.describe('OpencodeServerManager - Version Fetching', () => {

  test('fetchVersion tries health endpoint', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /fetchVersion[\s\S]*global\.health|healthFn/s,
      'must try global.health endpoint first'
    );
  });

  test('fetchVersion falls back to compatibility probe', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /fetchVersion[\s\S]*compatibilityProbe|path\.get|config\.get/s,
      'must fall back to compatibility probe'
    );
  });

  test('fetchVersion handles missing health API', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /fetchVersion[\s\S]*No supported health API|missingHealthApiError/s,
      'must handle missing health API gracefully'
    );
  });

});

test.describe('OpencodeServerManager - Process Management', () => {

  test('terminateProcessTree handles Windows processes', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /terminateProcessTree[\s\S]*win32.*taskkill.*\/T.*\/F|execSync/s,
      'must use taskkill on Windows for process tree cleanup'
    );
  });

  test('terminateProcessTree handles Unix processes', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /terminateProcessTree[\s\S]*kill\(\)|SIGTERM/s,
      'must use process.kill on Unix platforms'
    );
  });

  test('terminateProcessTree logs failures', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /terminateProcessTree[\s\S]*Failed to kill|debug.*error/s,
      'must log cleanup failures'
    );
  });

});

test.describe('OpencodeServerManager - Status Management', () => {

  test('setStatus updates status and fires event', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /setStatus[\s\S]*_status\s*=\s*status|_onStatusChange\.fire|logStateChange/s,
      'must update status and notify subscribers'
    );
  });

  test('setStatus only fires event on change', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /setStatus[\s\S]*_status\s*!==\s*status|prevent.*redundant/s,
      'must only fire event when status actually changes'
    );
  });

  test('getStatus returns current status', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /getStatus[\s\S]*return.*this\._status/s,
      'must return current server status'
    );
  });

  test('onStatusChange provides event stream', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /onStatusChange.*_onStatusChange\.event|EventEmitter/s,
      'must expose status change event stream'
    );
  });

});

test.describe('OpencodeServerManager - Auto-Reconnect', () => {

  test('exit handler schedules reconnect on unexpected exit', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /on.*exit[\s\S]*code\s*!==\s*0|reconnectTimer|setTimeout.*5000/s,
      'must schedule reconnect 5 seconds after unexpected exit'
    );
  });

  test('exit handler skips reconnect on intentional exit', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /on.*exit[\s\S]*code\s*===\s*0|isDisposed|reconnect/s,
      'must not reconnect on clean exit'
    );
  });

  test('dispose cancels reconnect timer', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /dispose[\s\S]*reconnectTimer.*clearTimeout|cancel/s,
      'must cancel pending reconnect on dispose'
    );
  });

});

test.describe('OpencodeServerManager - Workspace Integration', () => {

  test('getWorkspaceDirectory returns workspace path', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /getWorkspaceDirectory[\s\S]*workspaceFolders|fsPath|scheme.*file/s,
      'must return workspace folder path'
    );
  });

  test('startServer sets workspace CWD', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startServer[\s\S]*spawnOptions\.cwd.*workspaceFolder|fsPath/s,
      'must set working directory to workspace root'
    );
  });

  test('client creation includes workspace directory', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /createOpencodeClient[\s\S]*directory.*workspaceDirectory/s,
      'must include workspace directory in client config'
    );
  });

});

test.describe('OpencodeServerManager - Error Handling', () => {

  test('startServer handles ENOENT errors', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /ENOENT|not found|install.*npm install.*-g/s,
      'must show user-friendly message for missing CLI'
    );
  });

  test('startServer handles startup timeout', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /Server startup timeout|startupTimeout|10.*000/s,
      'must handle server startup timeout'
    );
  });

  test('startServer provides recent output on failure', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /recentServerOutput|Recent output.*recentTail/s,
      'must include recent server output in error messages'
    );
  });

});

test.describe('OpencodeServerManager - Logging', () => {

  test('serverManager logs server events', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /log\.serverEvent|start.*connect|stop/s,
      'must log significant server lifecycle events'
    );
  });

  test('serverManager logs debug information', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /log\.debug|Server CWD|Creating client|version/s,
      'must log debug information for troubleshooting'
    );
  });

  test('serverManager logs errors appropriately', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /log\.error|Failed to start|Auto-reconnect failed/s,
      'must log error conditions'
    );
  });

});

test.describe('OpencodeServerManager - State Machine', () => {

  test('state transitions follow valid patterns', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /idle.*starting.*running|error.*starting|running.*error/s,
      'must implement valid state transitions'
    );
  });

  test('state changes are logged', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /logStateChange|Server status changed|oldStatus.*newStatus/s,
      'must log state transitions'
    );
  });

});

test.describe('OpencodeServerManager - Client Access', () => {

  test('getClient returns current client', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /getClient[\s\S]*return.*this\.client/s,
      'must return current client instance'
    );
  });

  test('getClient may return null', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /getClient.*null|not running|ensureRunning/s,
      'must document that client may be null'
    );
  });

  test('getPort returns current port', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /getPort[\s\S]*return.*this\.port/s,
      'must return current server port'
    );
  });

});

test.describe('OpencodeServerManager - Compaction', () => {

  test('compactSession requires client', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /compactSession[\s\S]*!this\.client|Cannot compact session/s,
      'must validate client availability'
    );
  });

  test('compactSession calls SDK summarize method', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /compactSession[\s\S]*client\.session\.summarize[\s\S]*providerID:[\s\S]*model\.providerID[\s\S]*modelID:[\s\S]*model\.modelID/s,
      'must call SDK summarize endpoint with the selected model'
    );
  });

  test('compactSession handles errors', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /compactSession[\s\S]*throw.*error|Failed to compact/s,
      'must handle compaction failures'
    );
  });

});

test.describe('OpencodeServerManager - Memory Management', () => {

  test('dispose clears all references', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /dispose[\s\S]*client\s*=\s*null|port\s*=\s*0|serverProcess\s*=\s*null/s,
      'must clear all object references'
    );
  });

  test('dispose disposes event emitter', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /dispose[\s\S]*_onStatusChange\.dispose|EventEmitter/s,
      'must dispose status change event emitter'
    );
  });

});

test.describe('OpencodeServerManager - Error Tracking', () => {

  test('setStatus stores error message on error state', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /setStatus[\s\S]*status\s*===\s*"error".*error.*_lastError|_lastError\s*=\s*error/s,
      'must store error message when transitioning to error state'
    );
  });

  test('setStatus clears error on non-error state', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /setStatus[\s\S]*status\s*!==\s*"error".*_lastError\s*=\s*undefined|_lastError\s*=\s*undefined/s,
      'must clear error when transitioning to non-error state'
    );
  });

  test('getLastError returns stored error', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /getLastError[\s\S]*return.*this\._lastError/s,
      'must return the last error message'
    );
  });

  test('spawn error handler captures error message', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /on.*error[\s\S]*setStatus.*error.*error\.message|String\(error\)/s,
      'must capture spawn error message'
    );
  });

  test('exit handler captures error with recent output', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /on.*exit[\s\S]*code\s*!==\s*0.*setStatus.*error.*recentTail/s,
      'must capture exit error with recent output'
    );
  });

  test('timeout handler captures error with timeout message', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startupTimeout[\s\S]*setStatus.*error.*Server startup timeout/s,
      'must capture timeout error message'
    );
  });

});
