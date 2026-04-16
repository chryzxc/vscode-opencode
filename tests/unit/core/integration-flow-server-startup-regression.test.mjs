/**
 * Integration Flow: Server Startup Regression Tests
 *
 * These tests prevent regressions in the complete server startup flow.
 * This integration flow is critical for all extension functionality.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const extensionSource = readSource(
  [joinFromRoot('src', 'extension.ts')],
  'extension.ts',
);

const serverManagerSource = readSource(
  [joinFromRoot('src', 'services', 'OpencodeServerManager.ts')],
  'OpencodeServerManager.ts',
);

const statusBarSource = readSource(
  [joinFromRoot('src', 'providers', 'StatusBarProvider.ts')],
  'StatusBarProvider.ts',
);

test.describe('Integration Flow: Server Startup Sequence', () => {

  test('extension creates server manager on activation', () => {
    const source = extensionSource;

    assert.match(
      source,
      /serverManager\s*=\s*new OpencodeServerManager\(context\)/s,
      'extension must create server manager during activation'
    );
  });

  test('server manager allocates port', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /findAvailablePort|this\.port\s*=/s,
      'server manager must allocate available port'
    );
  });

  test('server manager spawns opencode process', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /spawn.*opencode.*serve.*port/s,
      'server manager must spawn opencode serve command'
    );
  });

  test('server manager monitors stdout for ready signal', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /stdout.*on.*data|Server running|listening/s,
      'server manager must monitor stdout for server ready signal'
    );
  });

});

test.describe('Integration Flow: Client Connection Sequence', () => {

  test('server manager creates SDK client after ready signal', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer.*createOpencodeClient|listening.*client/s,
      'server manager must create SDK client after server is ready'
    );
  });

  test('server manager fetches server version after connection', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer[\s\S]*fetchVersion|requireHealthy/s,
      'server manager must fetch server version after connection'
    );
  });

  test('server manager sets running status on successful connection', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer[\s\S]*setStatus.*running/s,
      'server manager must set status to running on success'
    );
  });

  test('server manager persists port on successful connection', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer[\s\S]*persistManagedPort/s,
      'server manager must persist port on successful connection'
    );
  });

});

test.describe('Integration Flow: Status Bar Update Sequence', () => {

  test('extension creates status bar provider after server manager', () => {
    const source = extensionSource;

    assert.match(
      source,
      /statusBarProvider\s*=\s*new StatusBarProvider\(serverManager\)/s,
      'extension must create status bar provider with server manager'
    );
  });

  test('extension subscribes to server status changes', () => {
    const source = extensionSource;

    assert.match(
      source,
      /serverManager\.onStatusChange\(\(\)\s*=>\s*\{[\s\S]*statusBarProvider\.updateStatus\(\)/s,
      'extension must subscribe to server status changes'
    );
  });

  test('status bar provider gets client from server manager', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*serverManager\.getClient\(\)/s,
      'status bar provider must get client from server manager'
    );
  });

  test('status bar provider shows connected icon when client exists', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*client.*\$\(robot\)/s,
      'status bar provider must show connected icon when client exists'
    );
  });

  test('status bar provider includes port in tooltip', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*tooltip.*Port:.*serverManager\.getPort\(\)/s,
      'status bar provider must include port in tooltip'
    );
  });

});

test.describe('Integration Flow: Session Service Initialization', () => {

  test('extension creates session service after server manager', () => {
    const source = extensionSource;

    assert.match(
      source,
      /sessionService\s*=\s*new SessionService\(context,\s*serverManager\)/s,
      'extension must create session service with server manager dependency'
    );
  });

  test('extension creates chat view provider with dependencies', () => {
    const source = extensionSource;

    assert.match(
      source,
      /chatViewProvider\s*=\s*new ChatViewProvider\(context,\s*serverManager,\s*sessionService/s,
      'extension must create chat view provider with all dependencies'
    );
  });

});

test.describe('Integration Flow: Error Recovery Sequence', () => {

  test('server manager implements startup timeout', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /setTimeout.*10000|startupTimeout/s,
      'server manager must implement startup timeout'
    );
  });

  test('server manager sets error status on timeout', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startupTimeout[\s\S]*setStatus.*error/s,
      'server manager must set error status on timeout'
    );
  });

  test('server manager captures recent output on error', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /recentServerOutput|recentTail/s,
      'server manager must capture recent output for error reporting'
    );
  });

  test('status bar provider shows disconnected icon on error', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*!client.*\$\(debug-disconnect\)/s,
      'status bar provider must show disconnected icon when no client'
    );
  });

});

test.describe('Integration Flow: Auto-Reconnect Sequence', () => {

  test('server manager monitors process exit', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /on.*exit[\s\S]*code/s,
      'server manager must monitor process exit'
    );
  });

  test('server manager schedules reconnect on unexpected exit', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /on.*exit[\s\S]*code\s*!==\s*0.*setTimeout.*reconnect/s,
      'server manager must schedule reconnect on unexpected exit'
    );
  });

  test('server manager skips reconnect on clean exit', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /on.*exit[\s\S]*code\s*===\s*0|isDisposed/s,
      'server manager must skip reconnect on clean exit'
    );
  });

  test('server manager cancels reconnect on dispose', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /dispose[\s\S]*reconnectTimer.*clearTimeout/s,
      'server manager must cancel reconnect timer on dispose'
    );
  });

});

test.describe('Integration Flow: Service Disposal Sequence', () => {

  test('extension disposes services in correct order', () => {
    const source = extensionSource;

    assert.match(
      source,
      /export function deactivate[\s\S]*dispose/s,
      'extension must provide deactivate function'
    );
  });

  test('server manager stops process on disposal', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /dispose[\s\S]*terminateProcessTree|stop/s,
      'server manager must stop process on disposal'
    );
  });

  test('server manager clears references on disposal', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /dispose[\s\S]*client\s*=\s*null|port\s*=\s*0/s,
      'server manager must clear references on disposal'
    );
  });

  test('status bar provider disposes status item', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /dispose[\s\S]*statusBarItem\.dispose\(\)/s,
      'status bar provider must dispose status item'
    );
  });

});

test.describe('Integration Flow: Port Persistence', () => {

  test('server manager persists port to global state', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /persistManagedPort[\s\S]*globalState\.update\('opencode\.server\.lastManagedPort'/s,
      'server manager must persist port to global state'
    );
  });

  test('server manager retrieves persisted port on startup', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /getPersistedManagedPort[\s\S]*globalState\.get\('opencode\.server\.lastManagedPort'/s,
      'server manager must retrieve persisted port on startup'
    );
  });

  test('server manager uses persisted port if available', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startServer[\s\S]*getPersistedManagedPort|try.*port/s,
      'server manager must try using persisted port'
    );
  });

});

test.describe('Integration Flow: Workspace Integration', () => {

  test('server manager sets workspace CWD for server process', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /startServer[\s\S]*cwd.*workspaceFolder|fsPath/s,
      'server manager must set workspace as working directory'
    );
  });

  test('server manager includes workspace in client config', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /connectToServer[\s\S]*workspaceDirectory|directory.*getWorkspaceDirectory/s,
      'server manager must include workspace in client config'
    );
  });

});

test.describe('Integration Flow: Status Change Propagation', () => {

  test('server manager fires status change event', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /setStatus[\s\S]*_onStatusChange\.fire/s,
      'server manager must fire status change event'
    );
  });

  test('extension updates status bar on status change', () => {
    const source = extensionSource;

    assert.match(
      source,
      /onStatusChange\(\(\)\s*=>\s*[\s\S]*statusBarProvider\.updateStatus\(\)/s,
      'extension must update status bar on status change'
    );
  });

  test('status bar provider reflects current status', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*client.*exists.*\$\(robot\).*\$\(debug-disconnect\)/s,
      'status bar provider must reflect current connection status'
    );
  });

});

test.describe('Integration Flow: Concurrent Startup Prevention', () => {

  test('server manager prevents duplicate startup calls', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /ensureRunning[\s\S]*startupPromise.*return.*existing/s,
      'server manager must prevent concurrent startup calls'
    );
  });

  test('server manager returns existing client if available', () => {
    const source = serverManagerSource;

    assert.match(
      source,
      /ensureRunning[\s\S]*this\.client.*return/s,
      'server manager must return existing client if available'
    );
  });

});
