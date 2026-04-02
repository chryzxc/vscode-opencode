import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from './types';
import { normalizeMessage } from './messageHandler';

describe('normalizeMessage', () => {
  it('should preserve structuredOutput field when present', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message',
      structuredOutput: {
        responseType: 'question',
        message: 'Test question',
        interactiveEvents: [{
          type: 'question',
          id: 'test-1',
          question: 'What is your favorite color?',
          options: [
            { id: 'red', label: 'Red', value: 'red' },
            { id: 'blue', label: 'Blue', value: 'blue' }
          ],
          multiSelect: false,
          allowCustomInput: true
        }]
      }
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Test message');
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should be preserved in the normalized message'
    );

    const normalizedRecord = result as Record<string, unknown>;
    assert.ok(normalizedRecord.structuredOutput, 'structuredOutput exists');
    assert.strictEqual(
      (normalizedRecord.structuredOutput as Record<string, unknown>).responseType,
      'question',
      'structuredOutput.responseType should be preserved'
    );
  });

  it('should preserve structuredOutput with snake_case format', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message',
    } as Message & { structured_output: unknown };

    (inputMessage as Record<string, unknown>).structured_output = {
      responseType: 'question',
      message: 'Test question',
      interactiveEvents: [{
        type: 'question',
        id: 'test-2',
        question: 'Continue?',
        options: [
          { id: 'yes', label: 'Yes', value: 'yes' },
          { id: 'no', label: 'No', value: 'no' }
        ],
        multiSelect: false,
        allowCustomInput: false
      }]
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should be preserved from snake_case field'
    );
  });

  it('should handle message without structuredOutput', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Regular message without structured output',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Regular message without structured output');

    const normalizedRecord = result as Record<string, unknown>;
    assert.ok(
      !normalizedRecord.structuredOutput,
      'structuredOutput should not exist when not present in input'
    );
  });

  it('should preserve other message fields alongside structuredOutput', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message',
      parts: [{ type: 'text', text: 'Test message' }],
      structuredOutput: {
        responseType: 'question',
        message: 'Test question',
        interactiveEvents: [{
          type: 'question',
          id: 'test-3',
          question: 'Choose option',
          options: [
            { id: 'a', label: 'Option A', value: 'a' },
            { id: 'b', label: 'Option B', value: 'b' }
          ],
          multiSelect: false,
          allowCustomInput: false
        }]
      },
      reasoningEvents: [
        { text: 'Thinking step 1', createdAt: 1000 },
        { text: 'Thinking step 2', createdAt: 2000 }
      ]
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should be preserved'
    );
    assert.ok(
      Array.isArray(result?.reasoningEvents) && result?.reasoningEvents.length === 2,
      'reasoningEvents should also be preserved'
    );
    assert.ok(
      Array.isArray(result?.parts) && result?.parts.length === 1,
      'parts should be preserved'
    );
  });

  it('should prefer streaming content over message content when structuredOutput is present', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Original content',
      structuredOutput: {
        responseType: 'question',
        message: 'Test question',
        interactiveEvents: [{
          type: 'question',
          id: 'test-4',
          question: 'Select one',
          options: [
            { id: 'x', label: 'X', value: 'x' },
            { id: 'y', label: 'Y', value: 'y' }
          ],
          multiSelect: false,
          allowCustomInput: false
        }]
      }
    };

    const streaming = {
      messageId: 'test-msg-1',
      content: 'Streaming content',
      reasoning: '',
      reasoningEvents: [],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: false,
      modelID: 'test-model',
      providerID: 'test-provider'
    };

    const result = normalizeMessage(inputMessage, streaming);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(result?.content, 'Streaming content', 'should prefer streaming content');
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should still be preserved when preferring streaming content'
    );
  });
});

describe('structuredOutput preservation - Integration Tests', () => {
  it('should ensure structuredOutput survives through full normalization pipeline', () => {
    const inputMessage: Message = {
      id: 'msg-test-1',
      role: 'assistant',
      content: 'Question for user',
      structuredOutput: {
        responseType: 'question',
        message: 'Please choose an option:',
        interactiveEvents: [{
          type: 'question',
          id: 'q1',
          title: 'Choice Required',
          question: 'Which option do you prefer?',
          options: [
            { id: 'opt1', label: 'Option 1', value: 'option1' },
            { id: 'opt2', label: 'Option 2', value: 'option2' },
            { id: 'opt3', label: 'Option 3', value: 'option3' }
          ],
          multiSelect: false,
          allowCustomInput: true
        }]
      },
      parts: [{ type: 'text', text: 'Question for user' }],
      reasoningEvents: []
    };

    // Simulate the full normalization pipeline
    const result = normalizeMessage(inputMessage, null);

    // Verify the result
    assert.ok(result, 'Result should exist');
    assert.strictEqual(result?.id, 'msg-test-1', 'Message ID should be preserved');
    assert.strictEqual(result?.role, 'assistant', 'Role should be preserved');

    // Critical: Verify structuredOutput is preserved
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.structuredOutput, 'structuredOutput must be preserved');

    const structuredOutput = resultRecord.structuredOutput as Record<string, unknown>;
    assert.strictEqual(structuredOutput.responseType, 'question', 'responseType must be preserved');
    assert.ok(Array.isArray(structuredOutput.interactiveEvents), 'interactiveEvents must be an array');
    assert.strictEqual(structuredOutput.interactiveEvents.length, 1, 'Should have one interactive event');

    const interactiveEvent = structuredOutput.interactiveEvents[0] as Record<string, unknown>;
    assert.strictEqual(interactiveEvent.type, 'question', 'Event type must be preserved');
    assert.strictEqual(interactiveEvent.id, 'q1', 'Event ID must be preserved');
    assert.strictEqual(interactiveEvent.question, 'Which option do you prefer?', 'Question text must be preserved');
    assert.ok(Array.isArray(interactiveEvent.options), 'Options must be preserved');
    assert.strictEqual(interactiveEvent.options.length, 3, 'Should have 3 options');
  });

  it('should preserve structuredOutput when coalescing with streaming state', () => {
    const baseMessage: Message = {
      id: 'msg-base',
      role: 'assistant',
      content: 'Base message',
      structuredOutput: {
        responseType: 'question',
        message: 'Base question',
        interactiveEvents: [{
          type: 'question',
          id: 'q-base',
          question: 'Base question?',
          options: [
            { id: 'a', label: 'A', value: 'a' },
            { id: 'b', label: 'B', value: 'b' }
          ],
          multiSelect: false,
          allowCustomInput: true
        }]
      }
    };

    const streaming = {
      messageId: 'msg-stream',
      content: 'Streaming content',
      reasoning: '',
      reasoningEvents: [],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: false,
      modelID: 'test-model',
      providerID: 'test-provider'
    };

    const result = normalizeMessage(baseMessage, streaming);

    assert.ok(result, 'Result should exist');
    assert.strictEqual(result?.content, 'Streaming content', 'Should prefer streaming content');

    // Critical: structuredOutput must be preserved even when preferring streaming content
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.structuredOutput, 'structuredOutput must be preserved with streaming');

    const structuredOutput = resultRecord.structuredOutput as Record<string, unknown>;
    assert.strictEqual(structuredOutput.responseType, 'question', 'responseType must be preserved');
    assert.strictEqual(
      (structuredOutput.interactiveEvents as Array<Record<string, unknown>>)[0].id,
      'q-base',
      'Original event ID must be preserved'
    );
  });
});
