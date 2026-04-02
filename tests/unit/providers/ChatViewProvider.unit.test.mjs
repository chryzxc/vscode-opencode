import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readAllSources } from '../../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([joinFromRoot('src', 'providers', 'ChatViewProvider.ts'), joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'), joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'), joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'), joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'), joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'), joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'ChatViewProvider.ts',
);

/**
 * Robustly extracts a switch case block by looking for the case label 
 * and matching braces or the next case/break/default.
 * This is a specialized version of extractFunctionBody for switch cases.
 */
function extractCaseBlock(source, caseLabel) {
  const labelIndex = source.indexOf(`case "${caseLabel}":`);
  if (labelIndex === -1) {
    const altLabelIndex = source.indexOf(`case '${caseLabel}':`);
    if (altLabelIndex === -1) return '';
  }

  const startIndex = source.indexOf(`case "${caseLabel}":`) === -1
    ? source.indexOf(`case '${caseLabel}':`)
    : source.indexOf(`case "${caseLabel}":`);

  const searchSnippet = source.slice(startIndex);
  // Find the first opening brace or the start of the next line
  const firstBrace = searchSnippet.indexOf('{');
  const firstBreak = searchSnippet.indexOf('break;');

  if (firstBrace !== -1 && (firstBreak === -1 || firstBrace < firstBreak)) {
    // It's a braced block, use standard extraction from the brace
    return extractFunctionBody(searchSnippet, searchSnippet.slice(0, firstBrace));
  } else {
    // It's a block ending with break;
    return searchSnippet.slice(0, firstBreak !== -1 ? firstBreak : 500);
  }
}

test('ChatViewProvider onDidReceiveMessage handles all expected message types', () => {
  const cases = [
    'ready', 'sendMessage', 'sendPrompt', 'persistAssistantMessage',
    'interactiveResponse', 'batchInteractiveResponse', 'newSession',
    'createSession', 'viewPlan', 'openDiff', 'openFile', 'reviewChanges',
    'searchFiles', 'getMentions', 'getOpenCodeConfig', 'saveOpenCodeConfig',
    'selectModel', 'setModel', 'selectAgent', 'setAgent', 'getAgents',
    'getCommands', 'getModels', 'getSessions', 'loadSession', 'openSession',
    'switchSession', 'deleteSession', 'renameSession', 'stopRequest',
    'compactSession', 'setCompactionViewState', 'addToQueue', 'steerMessage',
    'sendQueuedItemNow', 'steerQueuedItem', 'attachFiles', 'attachImage',
    'removeFromQueue', 'clearQueue', 'executeQueue', 'log', 'refreshQuota',
    'setThinkingLevel', 'addAttachment', 'retryLastMessage',
  ];

  for (const messageType of cases) {
    assert.match(
      chatProviderSource,
      new RegExp(`case ["']${messageType}["']`),
      `ChatViewProvider should handle ${messageType} case`,
    );
  }
});

test('ChatViewProvider.ready handler logic', () => {
  const readyBody = extractCaseBlock(chatProviderSource, 'ready');

  assert.match(readyBody, /type:\s*["']initState["']/, 'Ready flow must send initState');
  assert.match(readyBody, /this\.modelAndAgentManager\.handleGetModels\(\)/, 'Ready flow must trigger model discovery');
  assert.match(readyBody, /this\.modelAndAgentManager\.handleGetAgents\(\)/, 'Ready flow must trigger agent discovery');
  assert.match(readyBody, /this\.sessionService\.getCurrentSession\(\)/, 'Ready flow must resolve current session');
  assert.match(readyBody, /this\.sendBudgetInfo\(\)/, 'Ready flow must send budget info');
  assert.match(readyBody, /type:\s*["']chatHistory["']/, 'Ready flow must send chat history');
});

test('ChatViewProvider.sendMessage handler logic', () => {
  const sendMessageBody = extractCaseBlock(chatProviderSource, 'sendMessage');

  assert.match(sendMessageBody, /this\.schedulePromptDispatch\("send-now"/, 'sendMessage must call schedulePromptDispatch');
});

test('ChatViewProvider.handleSendMessage core logic', () => {
  const sendMessageBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );

  assert.match(sendMessageBody, /this\.budgeter\.canMakeRequest\(\)/, 'handleSendMessage must check budgeter');
  assert.match(sendMessageBody, /this\.sessionService\.getCurrentSession\(\)/, 'handleSendMessage must resolve session');
  assert.match(sendMessageBody, /this\.serverManager\.ensureRunning\(\)/, 'handleSendMessage must ensure server');
  assert.match(sendMessageBody, /this\.promptWithStructuredOutput\(/, 'handleSendMessage must call prompt engine');
  assert.match(sendMessageBody, /this\.sendBudgetInfo\(\)/, 'handleSendMessage must update budget UI');
});

test('ChatViewProvider.handleExecuteQueue core logic', () => {
  const executeQueueBody = extractFunctionBody(
    chatProviderSource,
    'async maybeAutoDrainQueue(',
  );

  assert.match(executeQueueBody, /this\.executingQueueSessionIds\.add\(sessionId\)/, 'Must track executing session');
  assert.match(executeQueueBody, /while\s*\(/, 'Must loop through queue');
  assert.match(executeQueueBody, /await this\.handleSendMessage\(/, 'Must call handleSendMessage for items');
  assert.match(executeQueueBody, /this\.executingQueueSessionIds\.delete\(sessionId\)/, 'Must cleanup tracking');
});

test('ChatViewProvider.schedulePromptDispatch core logic', () => {
  const dispatchBody = extractFunctionBody(
    chatProviderSource,
    'async schedulePromptDispatch(',
  );

  assert.match(dispatchBody, /if \(mode === "send-now"\)/, 'send-now should have a direct dispatch branch');
  assert.match(dispatchBody, /await this\.handleSendMessage\(/, 'send-now should call handleSendMessage directly');
  assert.match(dispatchBody, /await this\.queueManager\.schedulePromptDispatch\(/, 'non-send-now modes should still delegate to QueueManager');
});

test('ChatViewProvider.applyStructuredOutputToMessage uses structured.message as canonical text', () => {
  const applyBody = extractFunctionBody(
    chatProviderSource,
    'private applyStructuredOutputToMessage(',
  );

  assert.match(
    applyBody,
    /const messageContent =[\s\S]*structured\.message \|\|[\s\S]*this\.createFallbackMessage\(structured\);/s,
    'applyStructuredOutputToMessage should derive assistant text from structured.message only',
  );
});

test('ChatViewProvider.sendProcessingSessionsUpdate publishes active processing sessions', () => {
  const updateBody = extractFunctionBody(
    chatProviderSource,
    'private sendProcessingSessionsUpdate(): void',
  );

  assert.match(
    updateBody,
    /type:\s*["']SET_PROCESSING_SESSIONS["']/,
    'sendProcessingSessionsUpdate should emit SET_PROCESSING_SESSIONS event',
  );
  assert.match(
    updateBody,
    /payload:\s*Array\.from\(this\.processingSessionIds\)/,
    'sendProcessingSessionsUpdate should use ChatViewProvider processingSessionIds as payload',
  );
});

test('ChatViewProvider handles stream events via subscription callback', () => {
  assert.match(
    chatProviderSource,
    /this\.unsubscribe\s*=\s*this\.streamService\.subscribe\(async\s*\(event\)\s*=>\s*\{/,
    'Should subscribe to streamService'
  );

  assert.match(
    chatProviderSource,
    /this\.subagentTracker\.consumeStreamEvent\(event\)/,
    'Stream handler must update subagent tracker'
  );

  assert.match(
    chatProviderSource,
    /type:\s*["']streamEvent["']/,
    'Stream handler must forward events to webview'
  );
});

test('ChatViewProvider.handleGetSessions logic', () => {
  const getSessionsBody = extractFunctionBody(
    chatProviderSource,
    'async handleGetSessions(): Promise<void> {',
  );

  assert.match(getSessionsBody, /this\.sessionService\.listSessions\(\)/, 'Must fetch sessions from service');
  assert.match(getSessionsBody, /type:\s*["']sessionsList["']/, 'Must send sessions to webview');
});

test('ChatViewProvider.handleLoadSession logic', () => {
  const loadSessionBody = extractFunctionBody(
    chatProviderSource,
    'async handleLoadSession(',
  );

  assert.match(loadSessionBody, /this\.sessionService\.(getMessages|loadSessionMessages)\(/, 'Must load messages from service');
  assert.match(loadSessionBody, /type:\s*["']chatHistory["']/, 'Must send chatHistory to webview');
});

test('ChatViewProvider.handleLoadSession shows loading state', () => {
  const loadSessionBody = extractFunctionBody(
    chatProviderSource,
    'async handleLoadSession(',
  );

  assert.match(
    loadSessionBody,
    /this\.processingSessionIds\.add\(sessionId\)/,
    'Must add sessionId to processing state at start'
  );
  assert.match(
    loadSessionBody,
    /this\.sendProcessingSessionsUpdate\(\)/,
    'Must send processing state update to webview'
  );
  assert.match(
    loadSessionBody,
    /finally\s*\{[\s\S]*this\.processingSessionIds\.delete\(sessionId\)/s,
    'Must remove sessionId from processing state in finally block'
  );
  assert.match(
    loadSessionBody,
    /finally\s*\{[\s\S]*this\.sendProcessingSessionsUpdate\(\)/s,
    'Must send processing state update in finally block'
  );
});

test('ChatViewProvider.handleStopRequest logic', () => {
  const stopRequestBody = extractFunctionBody(
    chatProviderSource,
    'async handleStopRequest(sessionId?: string): Promise<void> {',
  );

  assert.match(stopRequestBody, /client\.session\.abort\(/, 'Must abort the session via client');
  assert.match(stopRequestBody, /type:\s*["']stopRequestHandled["']/, 'Must notify webview of stop');
});

test('ChatViewProvider initializes all required services in constructor', () => {
  const ctorBody = extractFunctionBody(
    chatProviderSource, 'constructor(',
  );

  const services = [
    ['streamService', 'MessageStreamService'],
    ['quotaService', 'QuotaService'],
    ['subagentTracker', 'SubagentTracker'],
    ['budgeter', 'RequestBudgeter'],
    ['configFilesProvider', 'ConfigFilesProvider'],
    ['skillManager', 'SkillManagerService'],
  ];

  for (const [prop, type] of services) {
    assert.match(
      ctorBody,
      new RegExp(`this\\.${prop}\\s*=\\s*new\\s+${type}`),
      `Constructor should initialize ${prop} (${type})`,
    );
  }
});
