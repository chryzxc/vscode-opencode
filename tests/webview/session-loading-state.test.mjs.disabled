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

test('Session loading: ChatShell imports Loader2 component', () => {
  assert.match(
    chatShellSource,
    /import.*Loader2.*from.*lucide-react/,
    'ChatShell should import Loader2 from lucide-react'
  );
});

test('Session loading: ChatContent detects session loading state', () => {
  const chatContentBody = extractFunctionBody(
    chatShellSource,
    'function ChatContent()'
  );

  assert.match(
    chatContentBody,
    /isSwitchingSession.*state\.switchingSessionId.*state\.currentSessionId/s,
    'ChatContent should check if switchingSessionId matches currentSessionId'
  );
});

test('Session loading: ChatContent shows loading spinner when session is loading', () => {
  const chatContentBody = extractFunctionBody(
    chatShellSource,
    'function ChatContent()'
  );

  assert.match(
    chatContentBody,
    /isSwitchingSession\s*\?[\s\S]*Loader2[\s\S]*animate-spin/s,
    'ChatContent should show Loader2 spinner when session is loading'
  );
  assert.match(
    chatContentBody,
    /Loading conversation\.\.\./s,
    'ChatContent should show loading text'
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
    /isSwitchingSession\s*\?[\s\S]*Loading conversation[\s\S]*:[\s\S]*visibleMessages\.map/s,
    'Messages should only render when not loading (ternary operator)'
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
    /state\.switchingSessionId\s*===\s*state\.currentSessionId/s,
    'isSwitchingSession should check if switchingSessionId matches current session'
  );
  assert.match(
    chatContentBody,
    /state\.messages\.length\s*>\s*0/s,
    'isSwitchingSession should only be true when there are existing messages to hide'
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

test('Session loading: MessageHandler sets switchingSessionId when loading different session', () => {
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  // Verify that switchingSessionId is set when chatHistorySessionId differs from current session
  assert.match(
    messageHandlerSource,
    /isSwitchingSession.*currentState\.currentSessionId\s*!==\s*chatHistorySessionId/s,
    'MessageHandler should detect session switch when chatHistorySessionId differs from current'
  );
  assert.match(
    messageHandlerSource,
    /if\s*\(\s*isSwitchingSession\s*\)\s*{[\s\S]*dispatch\s*\(\s*{\s*type:\s*["']SET_SWITCHING_SESSION["'],\s*payload:\s*chatHistorySessionId/s,
    'MessageHandler should set switchingSessionId when switching sessions'
  );
  assert.match(
    messageHandlerSource,
    /dispatch\s*\(\s*{\s*type:\s*["']SET_SWITCHING_SESSION["'],\s*payload:\s*null\s*}\s*\)[\s\S]*SET_MESSAGES/s,
    'MessageHandler should clear switchingSessionId after messages are loaded'
  );
});
