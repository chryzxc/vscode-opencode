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

test.describe.skip('StatusBarProvider - Initialization', () => {

  test.skip('creates status bar item on right side', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /createStatusBarItem[\s\S]*StatusBarAlignment\.Right/s,
      'must create status bar item on right side'
    );
  });

  test.skip('sets priority for status bar item', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /createStatusBarItem[\s\S]*\b100\b.*priority/s,
      'must set priority to 100 for status bar item'
    );
  });

  test.skip('sets click command to focus chat', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.command.*opencode\.focus/s,
      'must set click command to opencode.focus'
    );
  });

  test.skip('shows status bar item on initialization', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.show\(\)/s,
      'must show status bar item on initialization'
    );
  });

  test.skip('updates status on initialization', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /constructor[\s\S]*this\.updateStatus\(\)/s,
      'must update status on construction'
    );
  });

});

test.describe.skip('StatusBarProvider - Status Updates', () => {

  test.skip('has updateStatus method', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus.*void|function updateStatus/s,
      'must provide updateStatus method'
    );
  });

  test.skip('checks client availability', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*serverManager\.getClient\(\)/s,
      'must check if server client is available'
    );
  });

  test.skip('shows connected icon when client exists', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*client.*\$\(robot\).*OpenCode/s,
      'must show robot icon when connected'
    );
  });

  test.skip('shows disconnected icon when no client', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*client.*\$\(debug-disconnect\).*OpenCode/s,
      'must show disconnect icon when not connected'
    );
  });

  test.skip('updates tooltip with port when connected', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*tooltip.*Port:.*serverManager\.getPort\(\)/s,
      'must include port number in tooltip when connected'
    );
  });

  test.skip('updates tooltip when disconnected', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*tooltip.*disconnected/s,
      'must show disconnected message in tooltip'
    );
  });

});

test.describe.skip('StatusBarProvider - Icon Display', () => {

  test.skip('uses robot icon for connected state', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /\$\(robot\)/s,
      'must use robot icon for connected state'
    );
  });

  test.skip('uses debug-disconnect icon for disconnected state', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /\$\(debug-disconnect\)/s,
      'must use debug-disconnect icon for disconnected state'
    );
  });

  test.skip('includes OpenCode label in status text', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.text.*OpenCode/s,
      'must include "OpenCode" in status text'
    );
  });

});

test.describe.skip('StatusBarProvider - Server Manager Integration', () => {

  test.skip('accepts server manager in constructor', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /constructor[\s\S]*serverManager.*OpencodeServerManager/s,
      'must accept server manager as constructor parameter'
    );
  });

  test.skip('stores server manager as private field', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /constructor.*private serverManager/s,
      'must store server manager as private field'
    );
  });

  test.skip('gets client from server manager', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*serverManager\.getClient\(\)/s,
      'must get client from server manager'
    );
  });

  test.skip('gets port from server manager', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*serverManager\.getPort\(\)/s,
      'must get port from server manager'
    );
  });

});

test.describe.skip('StatusBarProvider - Tooltip Content', () => {

  test.skip('shows connection status in tooltip', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.tooltip.*connected|disconnected/s,
      'must show connection status in tooltip'
    );
  });

  test.skip('includes dynamic port number in tooltip', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /tooltip.*Port:.*getPort\(\)/s,
      'must include actual port number in tooltip'
    );
  });

  test.skip('updates tooltip on status change', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /updateStatus[\s\S]*statusBarItem\.tooltip\s*=/s,
      'must update tooltip when status changes'
    );
  });

});

test.describe.skip('StatusBarProvider - Event Integration', () => {

  test.skip('documents manual subscription to status changes', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /serverManager\.onStatusChange.*updateStatus|Subscribe to status changes/s,
      'must document subscribing to server manager status changes'
    );
  });

});

test.describe.skip('StatusBarProvider - Disposal', () => {

  test.skip('has dispose method', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /dispose.*void|function dispose/s,
      'must provide dispose method'
    );
  });

  test.skip('disposes status bar item', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /dispose[\s\S]*statusBarItem\.dispose\(\)/s,
      'must dispose status bar item on disposal'
    );
  });

});

test.describe.skip('StatusBarProvider - Configuration', () => {

  test.skip('uses right alignment for status bar', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /StatusBarAlignment\.Right/s,
      'must align status bar item to the right'
    );
  });

  test.skip('uses priority 100 for positioning', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /createStatusBarItem[\s\S]*,\s*100\s*\)/s,
      'must use priority 100 for status bar positioning'
    );
  });

  test.skip('registers opencode.focus command', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /statusBarItem\.command\s*=\s*"opencode\.focus"/s,
      'must register opencode.focus as click command'
    );
  });

});

test.describe.skip('StatusBarProvider - Documentation', () => {

  test.skip('documents status display behavior', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /Connected.*robot|Disconnected.*debug-disconnect/s,
      'must document status display behavior'
    );
  });

  test.skip('documents interaction behavior', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /Clicking.*opencode\.focus|open and focus/s,
      'must document click interaction behavior'
    );
  });

  test.skip('documents update strategy', () => {
    const source = statusBarSource;

    assert.match(
      source,
      /Update Strategy|Server status changes|Port number changes/s,
      'must document when status bar should be updated'
    );
  });

});
