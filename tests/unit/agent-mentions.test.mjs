import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([
  joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
  joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
], 'ChatViewProvider.ts');

test('agent mentions are fetched from model and agent manager and sent to webview', () => {
  // Verify handleGetAgents method exists and delegates to ModelAndAgentManager
  const getAgentsBody = extractFunctionBody(
    chatProviderSource,
    'async handleGetAgents(): Promise<void> {',
  );

  assert.match(
    getAgentsBody,
    /return\s+this\.modelAndAgentManager\.handleGetAgents\(\)/,
    'handleGetAgents must delegate to ModelAndAgentManager.handleGetAgents',
  );
});

test('agent mentions handler is properly wired in message router', () => {
  // Verify that getAgents message type is handled
  assert.match(
    chatProviderSource,
    /case\s+["']getAgents["']:\s*\{[\s\S]*this\.handleGetAgents\(\)[\s\S]*break/,
    'Message router must handle getAgents and call handleGetAgents method',
  );
});

test('model and agent manager defines built-in agents', () => {
  // Verify that ModelAndAgentManager has the handleGetAgents implementation
  const managerSource = readAllSources([
    joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
  ], 'ModelAndAgentManager.ts');

  const getAgentsBody = extractFunctionBody(
    managerSource,
    'async handleGetAgents(): Promise<void> {',
  );

  assert.match(
    getAgentsBody,
    /BUILTIN_AGENTS/,
    'handleGetAgents must define built-in agents',
  );

  assert.match(
    getAgentsBody,
    /type:\s*["']agentsList["']/,
    'handleGetAgents must post agentsList message to webview',
  );
});

test('webview message handler processes agentsList messages', () => {
  // Verify that the webview handles agentsList messages from the extension
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  assert.match(
    messageHandlerSource,
    /case\s+["']agentsList["']:/,
    'Webview messageHandler must handle agentsList message type',
  );

  assert.match(
    messageHandlerSource,
    /type:\s*["']SET_AGENTS_LIST["']/,
    'agentsList handler must dispatch SET_AGENTS_LIST action',
  );
});

test('webview triggers @ mention suggestions on @ character', () => {
  // Verify that the webview UI has logic to detect @ mentions
  const panelSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
    'PanelComponents.tsx',
  );

  // Check for @ mention trigger detection
  assert.match(
    panelSource,
    /const\s+mentionIndex\s*=\s*beforeCursor\.lastIndexOf\(["']@["']\)/,
    'Panel should detect @ character position for mentions',
  );

  assert.match(
    panelSource,
    /@.*to.*mention/,
    'Panel placeholder should mention @ for agent mentions',
  );
});

test('webview message handler processes commandsList messages', () => {
  // Verify that the webview handles commandsList messages from the extension
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );

  assert.match(
    messageHandlerSource,
    /case\s+["']commandsList["']:/,
    'Webview messageHandler must handle commandsList message type',
  );

  assert.match(
    messageHandlerSource,
    /type:\s*["']SET_COMMANDS_LIST["']/,
    'commandsList handler must dispatch SET_COMMANDS_LIST action',
  );
});
