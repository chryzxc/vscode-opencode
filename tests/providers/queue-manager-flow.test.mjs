import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const source = readSource([joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts')], 'QueueManager.ts');

test('enqueuePrompt exists and accepts prompt payloads', () => {
  assert.match(source, /enqueuePrompt\(prompt: QueuedPrompt, atFront = false\): void/, 'enqueuePrompt should accept prompt payloads and atFront flag');
  assert.match(source, /addToQueue\(prompt: QueuedPrompt\): void/, 'QueueManager should keep addToQueue for plain enqueue path');
});

test('handleExecuteQueue exists and accepts session payloads', () => {
  assert.match(source, /async handleExecuteQueue\(payload: \{ sessionId: string \}\): Promise<void>/, 'handleExecuteQueue should accept a session payload');
  assert.match(source, /const \{ sessionId \} = payload;/, 'handleExecuteQueue should destructure sessionId from payload');
});

test('queue maintains order using push, unshift, and shift', () => {
  assert.match(source, /this\.queue\.push\(prompt\);/, 'QueueManager should append prompts with push');
  assert.match(source, /this\.queue\.unshift\(prompt\);/, 'QueueManager should support prioritizing prompts with unshift');
  assert.match(source, /const prompt = this\.queue\.shift\(\)!;/, 'QueueManager should drain prompts in FIFO order with shift');
});

test('queue state guard prevents concurrent execution', () => {
  assert.match(source, /private isExecuting = false;/, 'QueueManager should track execution state');
  assert.match(source, /if \(this\.isExecuting\) \{[\s\S]*return;/, 'QueueManager should skip duplicate execution attempts');
  assert.match(source, /this\.isExecuting = true;/, 'QueueManager should mark execution active when draining');
  assert.match(source, /this\.isExecuting = false;/, 'QueueManager should clear execution state after draining');
});

test('steer mode and prioritized queue insertion are wired', () => {
  const dispatchBody = extractFunctionBody(source, '  async handleDispatchQueuedItem(');
  assert.match(source, /enqueuePrompt\(prompt: QueuedPrompt, atFront = false\): void/, 'QueueManager should allow prioritizing items at the front');
  assert.match(dispatchBody, /await this\.handleSendMessage\(/, 'handleDispatchQueuedItem should forward queued prompts into the send pipeline');
  assert.match(dispatchBody, /prompt\.userFacingText/, 'handleDispatchQueuedItem should preserve userFacingText in dispatched prompts');
});

test('queue preserves attachments and agent data when dispatching', () => {
  const dispatchBody = extractFunctionBody(source, '  async handleDispatchQueuedItem(');
  assert.match(dispatchBody, /prompt\.files/, 'dispatch should preserve file attachments');
  assert.match(dispatchBody, /prompt\.contexts/, 'dispatch should preserve context attachments');
  assert.match(dispatchBody, /prompt\.images/, 'dispatch should preserve image attachments');
  assert.match(dispatchBody, /prompt\.agent/, 'dispatch should preserve agent selection');
});

test('queue clears after execution and removal paths', () => {
  assert.match(source, /clearQueue\(\): void/, 'QueueManager should expose clearQueue');
  assert.match(source, /this\.queue = \[\];/, 'clearQueue should empty the queue array');
  assert.match(source, /this\.queue\.splice\(index, 1\);/, 'QueueManager should remove individual queued prompts');
});

test('queue execution has error handling around prompt dispatch', () => {
  const executeBody = extractFunctionBody(source, '  async executeQueue(');
  assert.match(executeBody, /try \{[\s\S]*await executePrompt\(prompt\);[\s\S]*\} catch \(error\) \{/, 'executeQueue should catch prompt execution failures');
  assert.match(executeBody, /this\.logger\.error\(/, 'executeQueue should log prompt execution failures');
});

test('queue drain updates the webview after each completed item', () => {
  const executeBody = extractFunctionBody(source, '  async handleExecuteQueue(');
  assert.match(executeBody, /this\.executeQueue\([\s\S]*\(\) => \{\s*this\.sendQueueUpdate\(sessionId\);\s*\}/, 'handleExecuteQueue should update queue state after each prompt');
  assert.match(executeBody, /await this\.executeQueue\(/, 'handleExecuteQueue should wait for queue draining to complete');
});

test('queue operations are logged for observability', () => {
  assert.match(source, /this\.logger\.info\('Prompt added to queue'/, 'QueueManager should log queue additions');
  assert.match(source, /this\.logger\.info\('Prompt prioritized in queue'/, 'QueueManager should log prioritized queue insertions');
  assert.match(source, /this\.logger\.info\('Queue execution completed'/, 'QueueManager should log queue completion');
  assert.match(source, /this\.logger\.debug\('Execute queue called with empty queue'/, 'QueueManager should log empty queue conditions');
});
