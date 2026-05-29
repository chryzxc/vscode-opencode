import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from './types';
import { normalizeMessage, dedupeSystemMessages } from './messageHandler';

describe('normalizeMessage - responseType handling', () => {
  it('should handle message with responseType field without throwing', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message with responseType',
      responseType: 'question',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message without throwing');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Test message with responseType');
  });

  it('should handle message with both responseType and structuredOutput.responseType', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message',
      responseType: 'implementation_plan',
      structuredOutput: {
        responseType: 'question',
        message: 'Test question',
        interactiveEvents: [],
      }
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.responseType || resultRecord.structuredOutput, 'Should handle responseType fields');
  });
});

describe('normalizeMessage - structuredOutput handling', () => {
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

    const normalizedRecord = result as Record<string, unknown>;
    assert.ok(normalizedRecord.structuredOutput, 'structuredOutput should be preserved');
    assert.strictEqual(
      (normalizedRecord.structuredOutput as Record<string, unknown>).responseType,
      'question',
      'structuredOutput.responseType should be preserved'
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

  it('should prefer canonical structuredOutput over truncated rawResponse structured payload', () => {
    const fullPlanContent =
      '# Plan\n\n- Setup completion rate\n- Time to first route generated\n- Add-rate of missed gems';
    const truncatedPlanContent =
      '# Plan\n\n- Setup completion rate\n- Time to first route generated\n- Add-rate of ...<truncated 940 chars>';

    const inputMessage = {
      id: 'msg-plan-precedence',
      role: 'assistant',
      responseType: 'implementation_plan',
      structuredOutput: {
        responseType: 'implementation_plan',
        plan: {
          file: 'docs/plans/tuklasia-unique-itinerary-flow-plan.md',
          content: fullPlanContent,
        },
      },
      rawResponse: {
        info: {
          structured: {
            responseType: 'implementation_plan',
            plan: {
              file: 'docs/plans/tuklasia-unique-itinerary-flow-plan.md',
              content: truncatedPlanContent,
            },
          },
        },
        parts: [],
      },
    } as Message & { rawResponse: unknown };

    const result = normalizeMessage(inputMessage, null);
    const normalized = result as Message & {
      structuredOutput?: { plan?: { content?: string } };
    };

    assert.ok(normalized, 'normalizeMessage should return a message');
    assert.ok(normalized.structuredOutput?.plan?.content, 'plan.content should exist');
    assert.strictEqual(
      normalized.structuredOutput?.plan?.content,
      fullPlanContent,
      'local structuredOutput plan.content should win over rawResponse truncated content',
    );
    assert.ok(
      !(normalized.structuredOutput?.plan?.content || '').includes('<truncated'),
      'normalized plan.content should not contain truncation markers',
    );
  });
});

describe('normalizeMessage - chatHistory regression tests', () => {
  it('should handle chatHistory messages with responseType from server', () => {
    // This is the exact scenario that was failing when switching sessions
    const chatHistoryMessage: Message = {
      id: 'ses_123_msg_1',
      role: 'assistant',
      content: 'Here is my response',
      responseType: 'text',
      timestamp: Date.now(),
    };

    const result = normalizeMessage(chatHistoryMessage, null);

    assert.ok(result, 'Should successfully normalize chatHistory message');
    assert.strictEqual(result?.id, 'ses_123_msg_1');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Here is my response');
  });

  it('should handle chatHistory messages with plan and responseType', () => {
    const chatHistoryMessage: Message = {
      id: 'ses_123_msg_2',
      role: 'assistant',
      content: 'Plan content',
      responseType: 'implementation_plan',
      plan: {
        id: 'plan-1',
        summary: 'Test plan summary',
        steps: [
          { id: 'step-1', instruction: 'Step 1', status: 'pending' },
          { id: 'step-2', instruction: 'Step 2', status: 'pending' },
        ],
      },
    };

    const result = normalizeMessage(chatHistoryMessage, null);

    assert.ok(result, 'Should successfully normalize message with plan and responseType');
    assert.strictEqual(result?.role, 'assistant');
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.plan, 'Plan should be preserved');
  });

  it('should handle multiple chatHistory messages in sequence', () => {
    const messages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Create a plan',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Plan content',
        responseType: 'implementation_plan',
        plan: {
          id: 'plan-1',
          summary: 'Test plan',
          steps: [],
        },
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Proceed with this plan.',
      },
      {
        id: 'msg-4',
        role: 'assistant',
        content: 'Execution started',
        responseType: 'text',
      },
    ];

    // Process all messages without throwing
    const results = messages.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(results.length, 4, 'All messages should be processed');
    results.forEach((result, index) => {
      assert.ok(result, `Message ${index + 1} should be normalized successfully`);
      assert.strictEqual(result?.id, messages[index].id);
      assert.strictEqual(result?.role, messages[index].role);
    });
  });

  it('should handle chatHistory messages with missing optional fields', () => {
    const minimalMessage: Message = {
      role: 'assistant',
      content: 'Simple message',
    };

    const result = normalizeMessage(minimalMessage, null);

    assert.ok(result, 'Should handle minimal message structure');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Simple message');
  });

  it('should handle chatHistory messages with nested structuredOutput', () => {
    const messageWithStructuredOutput: Message = {
      id: 'msg-structured',
      role: 'assistant',
      content: 'Question for user',
      responseType: 'question',
      structuredOutput: {
        responseType: 'question',
        message: 'Please choose:',
        interactiveEvents: [{
          type: 'question',
          id: 'q-1',
          question: 'Select an option',
          options: [
            { id: 'opt1', label: 'Option 1', value: 'opt1' },
            { id: 'opt2', label: 'Option 2', value: 'opt2' },
          ],
          multiSelect: false,
          allowCustomInput: false,
        }],
      },
    };

    const result = normalizeMessage(messageWithStructuredOutput, null);

    assert.ok(result, 'Should handle message with nested responseType fields');
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.structuredOutput, 'structuredOutput should be preserved');
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

describe('normalizeMessage - slash commands and file attachments', () => {
  it('should handle messages with slash commands', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '/plan Create a new feature',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle slash commands');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, '/plan Create a new feature');
  });

  it('should handle messages with @ mentions', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '@claude help me with this code',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle @ mentions');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, '@claude help me with this code');
  });

  it('should handle messages with both slash commands and @ mentions', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '/debug @claude fix this bug',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle combined commands and mentions');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, '/debug @claude fix this bug');
  });

  it('should handle messages with file attachments', () => {
    const inputMessage: Message = {
      role: 'user',
      content: 'Please review this file',
      attachments: [{
        id: 'file-1',
        dataUrl: 'data:text/plain;base64,SGVsbG8gV29ybGQ=',
        filename: 'example.ts',
        mimeType: 'text/plain',
      }],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle file attachments');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, 'Please review this file');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.attachments), 'attachments should be preserved');
    assert.strictEqual(resultRecord.attachments.length, 1, 'should have one attachment');

    const attachment = resultRecord.attachments as Array<Record<string, unknown>>;
    assert.strictEqual(attachment[0].id, 'file-1', 'attachment id should be preserved');
    assert.strictEqual(attachment[0].filename, 'example.ts', 'attachment filename should be preserved');
    assert.strictEqual(attachment[0].mimeType, 'text/plain', 'attachment mimeType should be preserved');
  });

  it('should handle messages with multiple file attachments', () => {
    const inputMessage: Message = {
      role: 'user',
      content: 'Review these files',
      attachments: [
        {
          id: 'file-1',
          dataUrl: 'data:text/plain;base64,SGVsbG8=',
          filename: 'file1.ts',
          mimeType: 'text/plain',
        },
        {
          id: 'file-2',
          dataUrl: 'data:text/plain;base64,V29ybGQ=',
          filename: 'file2.ts',
          mimeType: 'text/plain',
        },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle multiple file attachments');
    assert.strictEqual(result?.content, 'Review these files');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.attachments), 'attachments should be preserved');
    assert.strictEqual(resultRecord.attachments.length, 2, 'should have two attachments');
  });

  it('should handle messages with images', () => {
    const inputMessage: Message = {
      role: 'user',
      content: 'What do you see in this image?',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle images');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, 'What do you see in this image?');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.images), 'images should be preserved');
    assert.strictEqual(resultRecord.images.length, 1, 'should have one image');
  });

  it('should handle messages with slash commands and file attachments combined', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '/review Please review this code',
      attachments: [{
        id: 'file-code',
        dataUrl: 'data:text/plain;base64,Y29uc3QgeCA9IDEwOw==',
        filename: 'code.ts',
        mimeType: 'text/plain',
      }],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle slash commands with file attachments');
    assert.strictEqual(result?.content, '/review Please review this code');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.attachments), 'attachments should be preserved with commands');
    assert.strictEqual(resultRecord.attachments.length, 1, 'should have one attachment with command');
  });

  it('should handle messages with @ mentions and images combined', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '@claude What do you see in this screenshot?',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle @ mentions with images');
    assert.strictEqual(result?.content, '@claude What do you see in this screenshot?');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.images), 'images should be preserved with mentions');
    assert.strictEqual(resultRecord.images.length, 1, 'should have one image with mention');
  });
});

describe('normalizeMessage - comprehensive integration tests', () => {
  it('should handle complex message with command, mention, and attachments', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '/analyze @claude Please analyze these files',
      attachments: [
        {
          id: 'file-1',
          dataUrl: 'data:text/plain;base64,ZmlsZSAxIGNvbnRlbnQ=',
          filename: 'data.json',
          mimeType: 'application/json',
        },
        {
          id: 'file-2',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          filename: 'screenshot.png',
          mimeType: 'image/png',
        },
      ],
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle complex messages');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, '/analyze @claude Please analyze these files');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.attachments), 'attachments should be preserved');
    assert.strictEqual(resultRecord.attachments.length, 2, 'should have two attachments');
    assert.ok(Array.isArray(resultRecord.images), 'images should be preserved');
    assert.strictEqual(resultRecord.images.length, 1, 'should have one image');
  });
});

describe('dedupeSystemMessages', () => {
  it('should return empty array for empty input', () => {
    const result = dedupeSystemMessages([]);
    assert.deepStrictEqual(result, []);
  });

  it('should return single message for single message input', () => {
    const messages: Message[] = [{
      role: 'system',
      content: '<auto-slash-command>test</auto-slash-command>',
    }];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].content, '<auto-slash-command>test</auto-slash-command>');
  });

  it('should remove duplicate system messages with identical content', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command>',
      },
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command>',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].content, '<auto-slash-command>test</auto-slash-command>');
    assert.strictEqual(result[1].content, 'Hello');
  });

  it('should preserve different system messages', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '<auto-slash-command>command1</auto-slash-command>',
      },
      {
        role: 'system',
        content: '<auto-slash-command>command2</auto-slash-command>',
      },
      {
        role: 'system',
        content: '[info] Different format',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].content, '<auto-slash-command>command1</auto-slash-command>');
    assert.strictEqual(result[1].content, '<auto-slash-command>command2</auto-slash-command>');
    assert.strictEqual(result[2].content, '[info] Different format');
  });

  it('should keep only first occurrence of duplicate system messages', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '<system-reminder>First occurrence</system-reminder>',
        time: { created: 1000 },
      },
      {
        role: 'system',
        content: '<system-reminder>First occurrence</system-reminder>',
        time: { created: 2000 },
      },
      {
        role: 'system',
        content: '<system-reminder>First occurrence</system-reminder>',
        time: { created: 3000 },
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].time?.created, 1000, 'Should keep first occurrence');
  });

  it('should not deduplicate non-system messages', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'assistant',
        content: 'Hi there',
      },
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'assistant',
        content: 'Hi there',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 4, 'Should not deduplicate non-system messages');
  });

  it('should preserve message order when deduplicating', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '[info] Message 1',
      },
      {
        role: 'system',
        content: '[info] Message 2',
      },
      {
        role: 'system',
        content: '[info] Message 1',
      },
      {
        role: 'system',
        content: '[info] Message 3',
      },
      {
        role: 'system',
        content: '[info] Message 2',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].content, '[info] Message 1');
    assert.strictEqual(result[1].content, '[info] Message 2');
    assert.strictEqual(result[2].content, '[info] Message 3');
  });

  it('should deduplicate system messages with different whitespace', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command>',
      },
      {
        role: 'system',
        content: '  <auto-slash-command>test</auto-slash-command>  ',
      },
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command> ',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 1, 'Should deduplicate messages with different whitespace');
    assert.strictEqual(result[0].content, '<auto-slash-command>test</auto-slash-command>');
  });

  it('should deduplicate system messages with leading/trailing newlines', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '\n[info] Test message\n',
      },
      {
        role: 'system',
        content: '[info] Test message',
      },
      {
        role: 'system',
        content: '[info] Test message\n\n',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 1, 'Should deduplicate messages with different newlines');
  });
});
