/**
 * StatusBarProvider Regression Tests
 *
 * These tests prevent regressions in status bar functionality.
 * The status bar shows connection state and provides quick access to chat.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const statusBarSource = readSource(
  [joinFromRoot('src', 'providers', 'StatusBarProvider.ts')],
  'StatusBarProvider.ts',
);

test.describe('StatusBarProvider - Initialization', () => {

  test('creates status bar item on right side', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /createStatusBarItem[\s\S]*StatusBarAlignment\.Right/s,
      'must create status bar item on right side'
    );
  });

  test('sets priority for status bar item', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /createStatusBarItem[\s\S]*\b100\b.*priority/s,
      'must set priority to 100 for status bar item'
    );
  });

  test('sets click command to focus chat', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.command.*opencode\.focus/s,
      'must set click command to opencode.focus'
    );
  });

  test('shows status bar item on initialization', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.show\(\)/s,
      'must show status bar item on initialization'
    );
  });

  test('updates status on initialization', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /constructor[\s\S]*this\.updateStatus\(\)/s,
      'must update status on construction'
    );
  });

});

test.describe('StatusBarProvider - Status Updates', () => {

  test('has updateStatus method', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus.*void|function updateStatus/s,
      'must provide updateStatus method'
    );
  });

  test('checks client availability', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*serverManager\.getClient\(\)/s,
      'must check if server client is available'
    );
  });

  test('shows connected icon when client exists', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*client.*\$\(robot\).*OpenCode/s,
      'must show robot icon when connected'
    );
  });

  test('shows disconnected icon when no client', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*client.*\$\(debug-disconnect\).*OpenCode/s,
      'must show disconnect icon when not connected'
    );
  });

  test('updates tooltip with port when connected', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*tooltip.*Port:.*serverManager\.getPort\(\)/s,
      'must include port number in tooltip when connected'
    );
  });

  test('updates tooltip when disconnected', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*tooltip.*disconnected/s,
      'must show disconnected message in tooltip'
    );
  });

});

test.describe('StatusBarProvider - Icon Display', () => {

  test('uses robot icon for connected state', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /\$\(robot\)/s,
      'must use robot icon for connected state'
    );
  });

  test('uses debug-disconnect icon for disconnected state', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /\$\(debug-disconnect\)/s,
      'must use debug-disconnect icon for disconnected state'
    );
  });

  test('includes OpenCode label in status text', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.text.*OpenCode/s,
      'must include "OpenCode" in status text'
    );
  });

});

test.describe('StatusBarProvider - Server Manager Integration', () => {

  test('accepts server manager in constructor', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /constructor[\s\S]*serverManager.*OpencodeServerManager/s,
      'must accept server manager as constructor parameter'
    );
  });

  test('stores server manager as private field', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /constructor.*private serverManager/s,
      'must store server manager as private field'
    );
  });

  test('gets client from server manager', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*serverManager\.getClient\(\)/s,
      'must get client from server manager'
    );
  });

  test('gets port from server manager', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*serverManager\.getPort\(\)/s,
      'must get port from server manager'
    );
  });

});

test.describe('StatusBarProvider - Tooltip Content', () => {

  test('shows connection status in tooltip', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.tooltip.*connected|disconnected/s,
      'must show connection status in tooltip'
    );
  });

  test('includes dynamic port number in tooltip', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /tooltip.*Port:.*getPort\(\)/s,
      'must include actual port number in tooltip'
    );
  });

  test('updates tooltip on status change', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*statusBarItem\.tooltip\s*=/s,
      'must update tooltip when status changes'
    );
  });

});

test.describe('StatusBarProvider - Event Integration', () => {

  test('documents manual subscription to status changes', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /serverManager\.onStatusChange.*updateStatus|Subscribe to status changes/s,
      'must document subscribing to server manager status changes'
    );
  });

});

test.describe('StatusBarProvider - Disposal', () => {

  test('has dispose method', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /dispose.*void|function dispose/s,
      'must provide dispose method'
    );
  });

  test('disposes status bar item', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /dispose[\s\S]*statusBarItem\.dispose\(\)/s,
      'must dispose status bar item on disposal'
    );
  });

});

test.describe('StatusBarProvider - Configuration', () => {

  test('uses right alignment for status bar', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /StatusBarAlignment\.Right/s,
      'must align status bar item to the right'
    );
  });

  test('uses priority 100 for positioning', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /createStatusBarItem[\s\S]*,\s*100\s*\)/s,
      'must use priority 100 for status bar positioning'
    );
  });

  test('registers opencode.focus command', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.command\s*=\s*"opencode\.focus"/s,
      'must register opencode.focus as click command'
    );
  });

});

test.describe('StatusBarProvider - Documentation', () => {

  test('documents status display behavior', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /Connected.*robot|Disconnected.*debug-disconnect/s,
      'must document status display behavior'
    );
  });

  test('documents interaction behavior', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /Clicking.*opencode\.focus|open and focus/s,
      'must document click interaction behavior'
    );
  });

  test('documents update strategy', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /Update Strategy|Server status changes|Port number changes/s,
      'must document when status bar should be updated'
    );
  });

});
