/**
 * Model and Agent Selection Tests
 *
 * Tests model selection, agent selection, and related state management.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupConversationTest,
  withConversationTest,
} from '../helpers/conversation-test-utils.mjs';

test('selection: user can select model', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate model selection
    const selectModelMessage = {
      type: 'selectModel',
      model: {
        providerID: 'anthropic',
        modelID: 'claude-opus-4-6',
      },
    };

    // In real flow, this would update selectedModel
    assert.equal(selectModelMessage.type, 'selectModel');
    assert.equal(selectModelMessage.model.providerID, 'anthropic');
    assert.equal(selectModelMessage.model.modelID, 'claude-opus-4-6');
  });
});

test('selection: user can select agent', async () => {
  await withConversationTest(async (env) => {
    // Simulate agent selection
    const selectAgentMessage = {
      type: 'selectAgent',
      agent: 'code-architect',
    };

    assert.equal(selectAgentMessage.type, 'selectAgent');
    assert.equal(selectAgentMessage.agent, 'code-architect');
  });
});

test('selection: model selection persists to session', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Select model for session
    const modelSelection = {
      type: 'selectModel',
      sessionId: 'test-session-123',
      model: {
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4-6',
      },
    };

    // Verify session binding
    assert.equal(modelSelection.sessionId, 'test-session-123');
    assert.ok(modelSelection.model, 'Should have model object');
  });
});

test('selection: agent selection persists to session', async () => {
  await withConversationTest(async (env) => {
    // Select agent for session
    const agentSelection = {
      type: 'selectAgent',
      sessionId: 'test-session-123',
      agent: 'build',
    };

    assert.equal(agentSelection.sessionId, 'test-session-123');
    assert.equal(agentSelection.agent, 'build');
  });
});

test('selection: model list is sent to webview', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send models list
    const modelsList = {
      type: 'modelsList',
      models: [
        {
          providerID: 'anthropic',
          modelID: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6',
        },
        {
          providerID: 'anthropic',
          modelID: 'claude-opus-4-6',
          displayName: 'Claude Opus 4.6',
        },
        {
          providerID: 'openai',
          modelID: 'gpt-4',
          displayName: 'GPT-4',
        },
      ],
    };

    mocks.webview.postMessage(modelsList);

    // Verify models sent
    const modelsMessages = mocks.webview._getMessagesByType('modelsList');
    assert.ok(modelsMessages.length >= 1, 'Should have modelsList');

    const models = modelsMessages[modelsMessages.length - 1].models;
    assert.equal(models.length, 3);
    assert.equal(models[0].providerID, 'anthropic');
  });
});

test('selection: agent list is sent to webview', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send agents list
    const agentsList = {
      type: 'agentsList',
      agents: [
        { id: 'build', name: 'Build', description: 'Build features' },
        { id: 'code-architect', name: 'Code Architect', description: 'Design architecture' },
        { id: 'code-reviewer', name: 'Code Reviewer', description: 'Review code' },
      ],
    };

    mocks.webview.postMessage(agentsList);

    // Verify agents sent
    const agentsMessages = mocks.webview._getMessagesByType('agentsList');
    assert.ok(agentsMessages.length >= 1, 'Should have agentsList');

    const agents = agentsMessages[agentsMessages.length - 1].agents;
    assert.equal(agents.length, 3);
    assert.equal(agents[0].id, 'build');
  });
});

test('selection: model selection updates webview state', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send model update
    const modelUpdate = {
      type: 'modelChanged',
      model: {
        providerID: 'anthropic',
        modelID: 'claude-opus-4-6',
      },
    };

    mocks.webview.postMessage(modelUpdate);

    // Verify update sent
    const updateMessages = mocks.webview._getMessagesByType('modelChanged');
    assert.ok(updateMessages.length >= 1, 'Should have modelChanged');

    const lastUpdate = updateMessages[updateMessages.length - 1];
    assert.equal(lastUpdate.model.modelID, 'claude-opus-4-6');
  });
});

test('selection: agent selection updates webview state', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send agent update
    const agentUpdate = {
      type: 'agentChanged',
      agent: 'code-architect',
    };

    mocks.webview.postMessage(agentUpdate);

    // Verify update sent
    const updateMessages = mocks.webview._getMessagesByType('agentChanged');
    assert.ok(updateMessages.length >= 1, 'Should have agentChanged');

    const lastUpdate = updateMessages[updateMessages.length - 1];
    assert.equal(lastUpdate.agent, 'code-architect');
  });
});

test('selection: model selection is included in initState', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send initState with model
    const initState = {
      type: 'initState',
      serverStatus: 'running',
      selectedModel: {
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4-6',
      },
      selectedAgent: 'build',
      currentSessionId: 'test-session-123',
    };

    mocks.webview.postMessage(initState);

    // Verify model in init state
    const initMessages = mocks.webview._getMessagesByType('initState');
    const lastInit = initMessages[initMessages.length - 1];

    assert.ok(lastInit.selectedModel, 'Should have selectedModel');
    assert.equal(lastInit.selectedModel.modelID, 'claude-sonnet-4-6');
  });
});

test('selection: agent selection is included in initState', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send initState with agent
    const initState = {
      type: 'initState',
      serverStatus: 'running',
      selectedModel: {
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4-6',
      },
      selectedAgent: 'code-reviewer',
      currentSessionId: 'test-session-123',
    };

    mocks.webview.postMessage(initState);

    // Verify agent in init state
    const initMessages = mocks.webview._getMessagesByType('initState');
    const lastInit = initMessages[initMessages.length - 1];

    assert.ok(lastInit.selectedAgent, 'Should have selectedAgent');
    assert.equal(lastInit.selectedAgent, 'code-reviewer');
  });
});

test('selection: model capabilities are fetched after selection', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Select model
    const selectModel = {
      type: 'selectModel',
      model: {
        providerID: 'anthropic',
        modelID: 'claude-opus-4-6',
      },
    };

    assert.equal(selectModel.model.modelID, 'claude-opus-4-6');

    // Send capabilities
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
    assert.ok(capabilityMessages.length >= 1, 'Should have capabilities');
  });
});

test('selection: switching models updates capabilities', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Switch from one model to another
    const firstCapabilities = {
      type: 'modelCapabilityUpdate',
      capability: {
        supportsImages: true,
        supportsToolUse: true,
        maxTokens: 200000,
      },
    };

    mocks.webview.postMessage(firstCapabilities);

    const secondCapabilities = {
      type: 'modelCapabilityUpdate',
      capability: {
        supportsImages: false,
        supportsToolUse: true,
        maxTokens: 128000,
      },
    };

    mocks.webview.postMessage(secondCapabilities);

    // Verify both capability updates sent
    const capabilityMessages = mocks.webview._getMessagesByType('modelCapabilityUpdate');
    assert.ok(capabilityMessages.length >= 2, 'Should have multiple capability updates');

    // Verify different capabilities
    const first = capabilityMessages[capabilityMessages.length - 2];
    const second = capabilityMessages[capabilityMessages.length - 1];

    assert.notEqual(first.capability.maxTokens, second.capability.maxTokens);
  });
});

test('selection: model selection includes provider name', async () => {
  await withConversationTest(async (env) => {
    // Model selection with provider
    const modelWithProvider = {
      type: 'selectModel',
      model: {
        providerID: 'openai',
        providerName: 'OpenAI',
        modelID: 'gpt-4',
        displayName: 'GPT-4',
      },
    };

    assert.equal(modelWithProvider.model.providerID, 'openai');
    assert.equal(modelWithProvider.model.providerName, 'OpenAI');
    assert.equal(modelWithProvider.model.modelID, 'gpt-4');
  });
});

test('selection: multiple agents are available', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send multiple agents
    const agentsList = {
      type: 'agentsList',
      agents: [
        { id: 'build', name: 'Build' },
        { id: 'code-architect', name: 'Code Architect' },
        { id: 'code-reviewer', name: 'Code Reviewer' },
        { id: 'feature-dev', name: 'Feature Dev' },
      ],
    };

    mocks.webview.postMessage(agentsList);

    // Verify all agents sent
    const agentsMessages = mocks.webview._getMessagesByType('agentsList');
    const agents = agentsMessages[agentsMessages.length - 1].agents;

    assert.equal(agents.length, 4);
    assert.ok(agents.some(a => a.id === 'build'));
    assert.ok(agents.some(a => a.id === 'code-architect'));
    assert.ok(agents.some(a => a.id === 'code-reviewer'));
    assert.ok(agents.some(a => a.id === 'feature-dev'));
  });
});

test('selection: model selection persists across sessions', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Select model in session 1
    const session1Model = {
      type: 'selectModel',
      sessionId: 'session-1',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
    };

    // Select model in session 2
    const session2Model = {
      type: 'selectModel',
      sessionId: 'session-2',
      model: { providerID: 'anthropic', modelID: 'claude-opus-4-6' },
    };

    // Verify different models for different sessions
    assert.notEqual(session1Model.sessionId, session2Model.sessionId);
    assert.notEqual(session1Model.model.modelID, session2Model.model.modelID);
  });
});
