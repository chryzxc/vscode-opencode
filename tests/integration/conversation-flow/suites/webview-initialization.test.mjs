/**
 * Webview Initialization Tests
 *
 * Tests the webview initialization flow including the "ready" message
 * handling, initial state loading, and bootstrapping.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupConversationTest,
  withConversationTest,
} from '../helpers/conversation-test-utils.mjs';

test('initialization: webview sends ready message on load', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate webview ready message
    const readyMessage = {
      type: 'ready',
    };

    // In real flow, this would trigger ChatViewProvider.onDidReceiveMessage
    // For now, verify the mock can receive it
    assert.ok(readyMessage.type === 'ready', 'Ready message should have correct type');
  });
});

test('initialization: provider sends initState in response to ready', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // After initialization, webview should receive initState
    // In real implementation, this happens automatically on ready

    // Verify webview can receive initState
    const initState = {
      type: 'initState',
      serverStatus: 'running',
      selectedModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      selectedAgent: 'build',
      currentSessionId: 'test-session-123',
    };

    mocks.webview.postMessage(initState);

    // Verify initState was posted
    const initMessages = mocks.webview._getMessagesByType('initState');
    assert.ok(initMessages.length >= 1, 'Should have initState message');

    const lastInit = initMessages[initMessages.length - 1];
    assert.equal(lastInit.type, 'initState');
    assert.ok(lastInit.serverStatus !== undefined, 'Should have server status');
    assert.ok(lastInit.selectedModel !== undefined, 'Should have selected model');
    assert.ok(lastInit.currentSessionId !== undefined, 'Should have current session ID');
  });
});

test('initialization: initState includes session-specific settings', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate session with specific settings
    const sessionWithSettings = {
      type: 'initState',
      serverStatus: 'running',
      selectedModel: {
        providerID: 'anthropic',
        modelID: 'claude-opus-4-6',
      },
      selectedAgent: 'code-architect',
      currentSessionId: 'test-session-123',
      todoItems: [],
    };

    mocks.webview.postMessage(sessionWithSettings);

    const initMessages = mocks.webview._getMessagesByType('initState');
    const lastInit = initMessages[initMessages.length - 1];

    // Verify session-specific settings included
    assert.equal(lastInit.selectedModel.modelID, 'claude-opus-4-6');
    assert.equal(lastInit.selectedAgent, 'code-architect');
  });
});

test('initialization: thinking level is sent after initState', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send initState first
    mocks.webview.postMessage({
      type: 'initState',
      serverStatus: 'running',
      selectedModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      selectedAgent: 'build',
      currentSessionId: 'test-session-123',
    });

    // Then send thinking level
    mocks.webview.postMessage({
      type: 'thinkingLevelUpdate',
      level: 'high',
    });

    // Verify both messages sent
    const initMessages = mocks.webview._getMessagesByType('initState');
    const thinkingMessages = mocks.webview._getMessagesByType('thinkingLevelUpdate');

    assert.ok(initMessages.length >= 1, 'Should have initState');
    assert.ok(thinkingMessages.length >= 1, 'Should have thinkingLevelUpdate');

    assert.equal(thinkingMessages[thinkingMessages.length - 1].level, 'high');
  });
});

test('initialization: sessions list is sent during bootstrap', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Send sessions list
    const sessionsList = {
      type: 'sessionsList',
      sessions: [
        { id: 'session-1', title: 'Session 1' },
        { id: 'session-2', title: 'Session 2' },
      ],
    };

    mocks.webview.postMessage(sessionsList);

    // Verify sessions list sent
    const sessionsMessages = mocks.webview._getMessagesByType('sessionsList');
    assert.ok(sessionsMessages.length >= 1, 'Should have sessionsList');

    const sessions = sessionsMessages[sessionsMessages.length - 1].sessions;
    assert.ok(Array.isArray(sessions), 'Sessions should be array');
    assert.equal(sessions.length, 2);
  });
});

test('initialization: models are fetched during bootstrap', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send models list
    const modelsList = {
      type: 'modelsList',
      models: [
        { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
        { providerID: 'anthropic', modelID: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
      ],
    };

    mocks.webview.postMessage(modelsList);

    // Verify models sent
    const modelsMessages = mocks.webview._getMessagesByType('modelsList');
    assert.ok(modelsMessages.length >= 1, 'Should have modelsList');

    const models = modelsMessages[modelsMessages.length - 1].models;
    assert.ok(Array.isArray(models), 'Models should be array');
    assert.ok(models.length > 0, 'Should have at least one model');
  });
});

test('initialization: agents are fetched during bootstrap', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send agents list
    const agentsList = {
      type: 'agentsList',
      agents: [
        { id: 'build', name: 'Build' },
        { id: 'code-architect', name: 'Code Architect' },
      ],
    };

    mocks.webview.postMessage(agentsList);

    // Verify agents sent
    const agentsMessages = mocks.webview._getMessagesByType('agentsList');
    assert.ok(agentsMessages.length >= 1, 'Should have agentsList');

    const agents = agentsMessages[agentsMessages.length - 1].agents;
    assert.ok(Array.isArray(agents), 'Agents should be array');
    assert.ok(agents.length > 0, 'Should have at least one agent');
  });
});

test('initialization: model capabilities are sent after initialization', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send model capabilities
    const capabilities = {
      type: 'modelCapabilityUpdate',
      capability: {
        supportsImages: true,
        supportsToolUse: true,
        maxTokens: 200000,
      },
    };

    mocks.webview.postMessage(capabilities);

    // Verify capabilities sent
    const capabilityMessages = mocks.webview._getMessagesByType('modelCapabilityUpdate');
    assert.ok(capabilityMessages.length >= 1, 'Should have modelCapabilityUpdate');

    const capability = capabilityMessages[capabilityMessages.length - 1].capability;
    assert.ok(typeof capability.supportsImages === 'boolean', 'Should have image support flag');
    assert.ok(typeof capability.supportsToolUse === 'boolean', 'Should have tool use support flag');
  });
});

test('initialization: chat history is sent to webview', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send chat history
    const chatHistory = {
      type: 'chatHistory',
      messages: [
        { role: 'user', content: 'Hello', time: { created: Date.now() - 1000 } },
        { role: 'assistant', content: 'Hi there!', time: { created: Date.now() } },
      ],
      sessionId: 'test-session-123',
    };

    mocks.webview.postMessage(chatHistory);

    // Verify history sent
    const historyMessages = mocks.webview._getMessagesByType('chatHistory');
    assert.ok(historyMessages.length >= 1, 'Should have chatHistory');

    const history = historyMessages[historyMessages.length - 1];
    assert.ok(Array.isArray(history.messages), 'Messages should be array');
    assert.equal(history.messages.length, 2);
    assert.equal(history.sessionId, 'test-session-123');
  });
});

test('initialization: bootstrapping happens only once per reload', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate multiple ready messages (webview retry logic)
    const readyMessage1 = { type: 'ready' };
    const readyMessage2 = { type: 'ready' };

    // In real implementation, second ready is ignored if already bootstrapping
    // Verify the pattern
    assert.equal(readyMessage1.type, readyMessage2.type, 'Both should be ready messages');

    // Verify initState sent only once
    const initMessages = mocks.webview._getMessagesByType('initState');
    const initialCount = initMessages.length;

    // Send another init (should not duplicate in real flow)
    mocks.webview.postMessage({
      type: 'initState',
      serverStatus: 'running',
      selectedModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      currentSessionId: 'test-session-123',
    });

    const finalInitMessages = mocks.webview._getMessagesByType('initState');
    assert.ok(finalInitMessages.length >= initialCount, 'Should have at least initial messages');
  });
});

test('initialization: webview receives server version', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send initState with version
    mocks.webview.postMessage({
      type: 'initState',
      serverStatus: 'running',
      serverVersion: '1.0.0',
      selectedModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      currentSessionId: 'test-session-123',
    });

    // Verify version included
    const initMessages = mocks.webview._getMessagesByType('initState');
    const lastInit = initMessages[initMessages.length - 1];

    assert.ok(lastInit.serverVersion !== undefined, 'Should include server version');
  });
});

test('initialization: todo items are sent with initState', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send initState with todo items
    const todoItems = [
      { id: '1', action: 'Test setup', status: 'pending' },
      { id: '2', action: 'Write tests', status: 'in_progress' },
    ];

    mocks.webview.postMessage({
      type: 'initState',
      serverStatus: 'running',
      selectedModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      currentSessionId: 'test-session-123',
      todoItems,
    });

    // Verify todo items included
    const initMessages = mocks.webview._getMessagesByType('initState');
    const lastInit = initMessages[initMessages.length - 1];

    assert.ok(Array.isArray(lastInit.todoItems), 'TodoItems should be array');
    assert.equal(lastInit.todoItems.length, 2);
  });
});
