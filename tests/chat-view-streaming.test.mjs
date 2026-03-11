import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('ChatViewProvider streams events to webview progressively', () => {
  const registerHandlersBody = extractFunctionBody(
    chatProviderSource,
    'resolveWebviewView(',
  );

  assert.match(
    registerHandlersBody,
    /this\.unsubscribe\s*=\s*this\.streamService\.subscribe\(/,
    'ChatViewProvider should subscribe to MessageStreamService'
  );

  assert.match(
    registerHandlersBody,
    /this\.logStreamEventDiagnostics\(event\)/,
    'ChatViewProvider should emit detailed diagnostics for each incoming stream event',
  );

  assert.match(
    registerHandlersBody,
    /const enrichedEvent\s*=\s*this\.enrichStreamEvent\(event\)/,
    'ChatViewProvider should enrich the raw stream event'
  );

  assert.match(
    registerHandlersBody,
    /this\.view\?\.webview\.postMessage\(\s*\{\s*type:\s*["']streamEvent["'],\s*event:\s*enrichedEvent,\s*\}\s*\)/,
    'ChatViewProvider should progressively dispatch streamEvent to the webview'
  );

  assert.match(
    registerHandlersBody,
    /console\.log\(\s*["']\[ChatViewProvider\] streamEvent forwarded["']/,
    'ChatViewProvider should log each forwarded streamEvent for debugging',
  );
});

test('ChatViewProvider logs final prompt response diagnostics when non-streaming fallback occurs', () => {
  const sendMessageBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(
    sendMessageBody,
    /this\.logPromptResponseDiagnostics\(session\.id,\s*response\.data\)/,
    'handleSendMessage should log detailed final response diagnostics for debugging',
  );
});

test('ChatViewProvider records streaming token usage during message.updated events', () => {
  const registerHandlersBody = extractFunctionBody(
    chatProviderSource,
    'resolveWebviewView(',
  );

  assert.match(
    registerHandlersBody,
    /event\.type\s*===\s*["']message\.updated["']/,
    'ChatViewProvider must check for message.updated when assessing final tokens'
  );

  assert.match(
    registerHandlersBody,
    /this\.geminiTokenTracker\.recordUsage/,
    'ChatViewProvider should securely record token usage through geminiTokenTracker'
  );
});
