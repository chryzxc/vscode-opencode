/**
 * Session Loading State Tests
 *
 * Tests for the full-page loading state when switching sessions
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);

test('Session loading: ChatShell imports SessionLoadingSpinner component', () => {
  assert.match(
    chatShellSource,
    /SessionLoadingSpinner/,
    'ChatShell should reference SessionLoadingSpinner for loading state'
  );
});

test('Session loading: ChatContent detects session loading state', () => {
  const chatContentBody = extractFunctionBody(
    chatShellSource,
    'function ChatContent()'
  );

  assert.match(
    chatContentBody,
    /isSwitchingSession.*state\.isLoadingSession/s,
    'ChatContent should derive isSwitchingSession from state.isLoadingSession'
  );
});

test('Session loading: ChatContent shows loading spinner when session is loading', () => {
  const chatContentBody = extractFunctionBody(
    chatShellSource,
    'function ChatContent()'
  );

  assert.match(
    chatContentBody,
    /isSwitchingSession\s*\?[\s\S]*SessionLoadingSpinner/s,
    'ChatContent should show SessionLoadingSpinner when session is loading'
  );
});

test('Session loading: ChatContent hides messages during session switch', () => {
  const chatContentBody = extractFunctionBody(
    chatShellSource,
    'function ChatContent()'
  );

  // Verify that when isSwitchingSession is true, messages are hidden
  assert.match(
    chatContentBody,
    /isSwitchingSession\s*\?[\s\S]*SessionLoadingSpinner[\s\S]*:[\s\S]*visibleMessages/s,
    'Messages should only render when not loading (ternary operator with SessionLoadingSpinner)'
  );
});

test('Session loading: Loading spinner is centered and prominent', () => {
  const chatContentBody = extractFunctionBody(
    chatShellSource,
    'function ChatContent()'
  );

  assert.match(
    chatContentBody,
    /flex h-full items-center justify-center/s,
    'Loading container should be centered using flexbox'
  );
  assert.match(
    chatContentBody,
    /flex flex-col items-center gap-4/s,
    'Loading content should use flex column layout with gap'
  );
});

test('Session loading: Loading state only shows when switching sessions with messages', () => {
  const chatContentBody = extractFunctionBody(
    chatShellSource,
    'function ChatContent()'
  );

  assert.match(
    chatContentBody,
    /state\.isLoadingSession/s,
    'isSwitchingSession should derive from state.isLoadingSession'
  );
});

test('Session loading: Preserves other UI elements during loading', () => {
  const chatContentBody = extractFunctionBody(
    chatShellSource,
    'function ChatContent()'
  );

  // StickyHeader should remain visible
  assert.match(
    chatContentBody,
    /<StickyHeader\s*\/>/s,
    'StickyHeader should render during loading'
  );

  // Input area should remain visible
  assert.match(
    chatContentBody,
    /<InputWrapper\s*\/>/s,
    'InputWrapper should render during loading'
  );
});

test('Session loading: MessageHandler dispatches START_SESSION_LOADING when loading different session', () => {
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  // Verify that isSwitchingSession is detected when chatHistorySessionId differs from current
  assert.match(
    messageHandlerSource,
    /isSwitchingSession.*currentSessionId\s*!==\s*chatHistorySessionId/s,
    'MessageHandler should detect session switch when chatHistorySessionId differs from current'
  );
  assert.match(
    messageHandlerSource,
    /isSwitchingSession\s*\)\s*\{[\s\S]*dispatch\s*\(\s*{\s*type:\s*["']START_SESSION_LOADING["']/s,
    'MessageHandler should dispatch START_SESSION_LOADING when switching sessions'
  );
  assert.match(
    messageHandlerSource,
    /dispatch\s*\(\s*{\s*type:\s*["']END_SESSION_LOADING["']/s,
    'MessageHandler should dispatch END_SESSION_LOADING after messages are loaded'
  );
  assert.match(
    messageHandlerSource,
    /cachedMessagesForSwitch[\s\S]*HYDRATE_SESSION_FROM_CACHE/s,
    "MessageHandler should hydrate cached session messages before showing loading spinner",
  );
  assert.match(
    messageHandlerSource,
    /type:\s*["']CACHE_SESSION_MESSAGES["']/,
    "MessageHandler should cache normalized session messages",
  );
});

test("Session loading: SessionModal checks cache before immediate loading dispatch", () => {
  const sessionModalSource = readSource(
    [joinFromRoot("webview", "shared", "src", "chat", "components", "SessionModal.tsx")],
    "SessionModal.tsx",
  );
  assert.match(
    sessionModalSource,
    /messagesBySessionId[\s\S]*hasCachedMessages[\s\S]*START_SESSION_LOADING/s,
    "SessionModal should skip eager loading state when cached messages exist",
  );
});
