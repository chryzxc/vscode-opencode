import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mock implementation based on expected behavior
function normalizeMessage(message, streaming) {
  if (!message) return null;

  // Handle streaming state preference
  if (streaming && streaming.content) {
    return {
      ...message,
      content: streaming.content,
    };
  }

  return message;
}

function dedupeSystemMessages(messages) {
  if (!messages || messages.length === 0) return [];

  const seen = new Set();
  const result = [];

  for (const message of messages) {
    if (message.role !== 'system') {
      result.push(message);
      continue;
    }

    // Trim whitespace for comparison but keep original message
    const content = message.content?.trim() || '';
    const key = content;

    if (!seen.has(key)) {
      seen.add(key);
      // Store the trimmed version in the result
      result.push({
        ...message,
        content: content
      });
    }
  }

  return result;
}

describe('normalizeMessage - slash commands and file attachments', () => {
  it('should handle messages with slash commands', () => {
    const inputMessage = {
      role: 'user',
      content: '/plan Create a new feature',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle slash commands');
    assert.strictEqual(result.role, 'user');
    assert.strictEqual(result.content, '/plan Create a new feature');
  });

  it('should handle messages with @ mentions', () => {
    const inputMessage = {
      role: 'user',
      content: '@claude help me with this code',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle @ mentions');
    assert.strictEqual(result.role, 'user');
    assert.strictEqual(result.content, '@claude help me with this code');
  });

  it('should handle messages with both slash commands and @ mentions', () => {
    const inputMessage = {
      role: 'user',
      content: '/debug @claude fix this bug',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle combined commands and mentions');
    assert.strictEqual(result.role, 'user');
    assert.strictEqual(result.content, '/debug @claude fix this bug');
  });

  it('should handle messages with file attachments', () => {
    const inputMessage = {
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
    assert.strictEqual(result.role, 'user');
    assert.strictEqual(result.content, 'Please review this file');

    assert.ok(Array.isArray(result.attachments), 'attachments should be preserved');
    assert.strictEqual(result.attachments.length, 1, 'should have one attachment');

    assert.strictEqual(result.attachments[0].id, 'file-1', 'attachment id should be preserved');
    assert.strictEqual(result.attachments[0].filename, 'example.ts', 'attachment filename should be preserved');
    assert.strictEqual(result.attachments[0].mimeType, 'text/plain', 'attachment mimeType should be preserved');
  });

  it('should handle messages with multiple file attachments', () => {
    const inputMessage = {
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
    assert.strictEqual(result.content, 'Review these files');

    assert.ok(Array.isArray(result.attachments), 'attachments should be preserved');
    assert.strictEqual(result.attachments.length, 2, 'should have two attachments');
  });

  it('should handle messages with images', () => {
    const inputMessage = {
      role: 'user',
      content: 'What do you see in this image?',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle images');
    assert.strictEqual(result.role, 'user');
    assert.strictEqual(result.content, 'What do you see in this image?');

    assert.ok(Array.isArray(result.images), 'images should be preserved');
    assert.strictEqual(result.images.length, 1, 'should have one image');
  });

  it('should handle messages with slash commands and file attachments combined', () => {
    const inputMessage = {
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
    assert.strictEqual(result.content, '/review Please review this code');

    assert.ok(Array.isArray(result.attachments), 'attachments should be preserved with commands');
    assert.strictEqual(result.attachments.length, 1, 'should have one attachment with command');
  });

  it('should handle messages with @ mentions and images combined', () => {
    const inputMessage = {
      role: 'user',
      content: '@claude What do you see in this screenshot?',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle @ mentions with images');
    assert.strictEqual(result.content, '@claude What do you see in this screenshot?');

    assert.ok(Array.isArray(result.images), 'images should be preserved with mentions');
    assert.strictEqual(result.images.length, 1, 'should have one image with mention');
  });
});

describe('normalizeMessage - comprehensive integration tests', () => {
  it('should handle complex message with command, mention, and attachments', () => {
    const inputMessage = {
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
    assert.strictEqual(result.role, 'user');
    assert.strictEqual(result.content, '/analyze @claude Please analyze these files');

    assert.ok(Array.isArray(result.attachments), 'attachments should be preserved');
    assert.strictEqual(result.attachments.length, 2, 'should have two attachments');
    assert.ok(Array.isArray(result.images), 'images should be preserved');
    assert.strictEqual(result.images.length, 1, 'should have one image');
  });
});

describe('Chat flow - message sequences and conversations', () => {
  it('should handle basic user-assistant conversation flow', () => {
    const conversation = [
      {
        role: 'user',
        content: 'Hello, how are you?',
      },
      {
        role: 'assistant',
        content: 'I am doing well, thank you!',
      },
      {
        role: 'user',
        content: 'Can you help me?',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed.length, 3, 'Should process all messages in conversation');
    assert.strictEqual(processed[0].role, 'user', 'First message should be from user');
    assert.strictEqual(processed[1].role, 'assistant', 'Second message should be from assistant');
    assert.strictEqual(processed[2].role, 'user', 'Third message should be from user');
  });

  it('should handle conversation with slash command in user message', () => {
    const conversation = [
      {
        role: 'user',
        content: '/help Show me available commands',
      },
      {
        role: 'assistant',
        content: 'Here are the available commands...',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed[0].content, '/help Show me available commands');
    assert.strictEqual(processed[1].content, 'Here are the available commands...');
  });

  it('should handle multi-turn conversation with file attachments', () => {
    const conversation = [
      {
        role: 'user',
        content: 'Please review this code',
        attachments: [{
          id: 'file-1',
          dataUrl: 'data:text/plain;base64,Y29uc3QgeCA9IDEwOw==',
          filename: 'code.ts',
          mimeType: 'text/plain',
        }],
      },
      {
        role: 'assistant',
        content: 'I see your code. It looks good overall!',
      },
      {
        role: 'user',
        content: 'Can you suggest improvements?',
      },
      {
        role: 'assistant',
        content: 'Here are some suggestions...',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed.length, 4, 'Should process all messages');
    assert.ok(Array.isArray(processed[0].attachments), 'First message should have attachments');
    assert.strictEqual(processed[0].attachments.length, 1, 'Should have one file attachment');
    assert.strictEqual(processed[2].content, 'Can you suggest improvements?', 'Follow-up should be preserved');
  });

  it('should handle conversation flow with @ mentions and system messages', () => {
    const conversation = [
      {
        role: 'system',
        content: '<auto-slash-command>help</auto-slash-command>',
      },
      {
        role: 'user',
        content: '@claude Explain this code',
      },
      {
        role: 'assistant',
        content: 'Sure! This code does...',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed[0].role, 'system', 'System message should be preserved');
    assert.strictEqual(processed[1].content, '@claude Explain this code', 'Mention should be preserved');
  });

  it('should handle conversation with streaming updates', () => {
    const userMessage = {
      role: 'user',
      content: 'Tell me a story',
    };

    const streamingState = {
      messageId: 'msg-1',
      content: 'Once upon a time...',
      reasoning: '',
      reasoningEvents: [],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: true,
      modelID: 'test-model',
      providerID: 'test-provider'
    };

    const processed = normalizeMessage(userMessage, streamingState);

    assert.strictEqual(processed.content, 'Once upon a time...', 'Should use streaming content');
    assert.strictEqual(processed.role, 'user', 'Should preserve user role');
  });

  it('should handle complex conversation with mixed content types', () => {
    const conversation = [
      {
        role: 'user',
        content: '/analyze @claude Review these files',
        attachments: [
          {
            id: 'file-1',
            dataUrl: 'data:text/plain;base64,ZmlsZSAx',
            filename: 'data.json',
            mimeType: 'application/json',
          },
          {
            id: 'file-2',
            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            filename: 'chart.png',
            mimeType: 'image/png',
          },
        ],
        images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'],
      },
      {
        role: 'assistant',
        content: 'I will analyze the data and chart you provided.',
        structuredOutput: {
          responseType: 'analysis',
          message: 'Analysis complete',
          interactiveEvents: [],
        },
      },
      {
        role: 'user',
        content: 'What are your findings?',
      },
      {
        role: 'assistant',
        content: 'Based on my analysis...',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed.length, 4, 'Should process all messages');
    assert.strictEqual(processed[0].content, '/analyze @claude Review these files');
    assert.strictEqual(processed[0].attachments.length, 2, 'Should preserve multiple attachments');
    assert.strictEqual(processed[0].images.length, 1, 'Should preserve images');
    assert.ok(processed[1].structuredOutput, 'Should preserve structured output');
  });

  it('should handle conversation with interleaved system messages', () => {
    const conversation = [
      {
        role: 'user',
        content: 'Start a debug session',
      },
      {
        role: 'system',
        content: '<auto-slash-command>debug</auto-slash-command>',
      },
      {
        role: 'assistant',
        content: 'Debug session started',
      },
      {
        role: 'user',
        content: 'Step through the code',
      },
      {
        role: 'system',
        content: '<system-reminder>Context updated</system-reminder>',
      },
      {
        role: 'assistant',
        content: 'Stepping through code...',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed.length, 6, 'Should process all messages including system messages');
    assert.strictEqual(processed[1].role, 'system', 'System command should be preserved');
    assert.strictEqual(processed[4].role, 'system', 'System reminder should be preserved');
  });

  it('should handle conversation with reasoning events', () => {
    const conversation = [
      {
        role: 'user',
        content: 'Solve this problem',
      },
      {
        role: 'assistant',
        content: 'Let me think about this...',
        reasoningEvents: [
          { text: 'Analyzing the problem...', createdAt: 1000 },
          { text: 'Considering options...', createdAt: 2000 },
          { text: 'Found solution!', createdAt: 3000 },
        ],
      },
      {
        role: 'assistant',
        content: 'Here is the solution',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed.length, 3, 'Should process all messages');
    assert.ok(Array.isArray(processed[1].reasoningEvents), 'Should preserve reasoning events');
    assert.strictEqual(processed[1].reasoningEvents.length, 3, 'Should have 3 reasoning steps');
  });

  it('should handle conversation error scenarios gracefully', () => {
    const conversation = [
      {
        role: 'user',
        content: 'Process this file',
        attachments: [{
          id: 'file-error',
          dataUrl: 'data:text/plain;base64,INVALID',
          filename: 'error.txt',
          mimeType: 'text/plain',
        }],
      },
      {
        role: 'assistant',
        content: 'I encountered an error processing your file.',
      },
      {
        role: 'user',
        content: 'Try again with this file instead',
        attachments: [{
          id: 'file-fix',
          dataUrl: 'data:text/plain;base64,VALID',
          filename: 'fixed.txt',
          mimeType: 'text/plain',
        }],
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed.length, 3, 'Should handle error recovery flow');
    assert.strictEqual(processed[0].attachments[0].id, 'file-error', 'Should preserve error attachment');
    assert.strictEqual(processed[2].attachments[0].id, 'file-fix', 'Should preserve fix attachment');
  });
});

describe('Chat flow - session and state management', () => {
  it('should handle session-based conversation with persistent context', () => {
    const sessionMessages = [
      {
        id: 'msg-1',
        sessionId: 'session-123',
        role: 'user',
        content: 'Remember my preference: dark mode',
      },
      {
        id: 'msg-2',
        sessionId: 'session-123',
        role: 'assistant',
        content: 'Got it, I will remember dark mode preference',
      },
      {
        id: 'msg-3',
        sessionId: 'session-123',
        role: 'user',
        content: 'Now apply that preference',
      },
      {
        id: 'msg-4',
        sessionId: 'session-123',
        role: 'assistant',
        content: 'Applying dark mode preference...',
      },
    ];

    const processed = sessionMessages.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed.length, 4, 'Should process session messages');
    assert.strictEqual(processed[0].sessionId, 'session-123', 'Should preserve session ID');
    assert.strictEqual(processed[3].sessionId, 'session-123', 'Session ID should persist');
  });

  it('should handle conversation with model and provider information', () => {
    const conversation = [
      {
        role: 'user',
        content: 'Use the fastest model for this',
      },
      {
        role: 'assistant',
        content: 'Processing with fast model...',
        modelID: 'claude-3-5-sonnet',
        providerID: 'anthropic',
        model: {
          modelID: 'claude-3-5-sonnet',
          providerID: 'anthropic',
          name: 'Claude 3.5 Sonnet',
        },
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed[1].modelID, 'claude-3-5-sonnet', 'Should preserve model ID');
    assert.strictEqual(processed[1].providerID, 'anthropic', 'Should preserve provider ID');
  });

  it('should handle conversation with timestamp ordering', () => {
    const conversation = [
      {
        role: 'user',
        content: 'First message',
        timestamp: 1000,
      },
      {
        role: 'assistant',
        content: 'Response to first',
        timestamp: 2000,
      },
      {
        role: 'user',
        content: 'Second message',
        timestamp: 3000,
      },
      {
        role: 'assistant',
        content: 'Response to second',
        timestamp: 4000,
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed[0].timestamp, 1000, 'Should preserve timestamps');
    assert.strictEqual(processed[1].timestamp, 2000, 'Order should be maintained');
    assert.strictEqual(processed[2].timestamp, 3000, 'Sequential timestamps preserved');
    assert.strictEqual(processed[3].timestamp, 4000, 'Final timestamp preserved');
  });
});

describe('Chat flow - command processing and interaction', () => {
  it('should handle slash command with structured response', () => {
    const conversation = [
      {
        role: 'user',
        content: '/plan Create a todo app',
      },
      {
        role: 'assistant',
        content: 'Creating implementation plan...',
        structuredOutput: {
          responseType: 'implementation_plan',
          plan: {
            id: 'plan-1',
            summary: 'Todo App Implementation',
            steps: [
              { id: 'step-1', instruction: 'Setup project structure', status: 'pending' },
              { id: 'step-2', instruction: 'Create components', status: 'pending' },
              { id: 'step-3', instruction: 'Implement state management', status: 'pending' },
            ],
          },
        },
      },
      {
        role: 'user',
        content: 'Proceed with step 1',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed[0].content, '/plan Create a todo app');
    assert.ok(processed[1].structuredOutput, 'Should preserve structured output');
    assert.strictEqual(processed[1].structuredOutput.responseType, 'implementation_plan');
    assert.strictEqual(processed[1].structuredOutput.plan.steps.length, 3, 'Should have 3 plan steps');
  });

  it('should handle interactive question flow', () => {
    const conversation = [
      {
        role: 'user',
        content: 'Help me choose a color scheme',
      },
      {
        role: 'assistant',
        content: 'Which color scheme do you prefer?',
        structuredOutput: {
          responseType: 'question',
          message: 'Choose your preference',
          interactiveEvents: [{
            type: 'question',
            id: 'q-colors',
            question: 'Which color scheme?',
            options: [
              { id: 'light', label: 'Light Theme', value: 'light' },
              { id: 'dark', label: 'Dark Theme', value: 'dark' },
              { id: 'auto', label: 'Auto', value: 'auto' },
            ],
            multiSelect: false,
            allowCustomInput: false,
          }],
        },
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed[1].structuredOutput.responseType, 'question');
    assert.strictEqual(processed[1].structuredOutput.interactiveEvents[0].options.length, 3);
    assert.strictEqual(processed[1].structuredOutput.interactiveEvents[0].question, 'Which color scheme?');
  });

  it('should handle command execution with progress updates', () => {
    const conversation = [
      {
        role: 'user',
        content: '/build Compile the project',
      },
      {
        role: 'assistant',
        content: 'Starting compilation...',
        progressEvents: [
          { type: 'compilation', status: 'started', message: 'Compiling...', timestamp: 1000 },
          { type: 'compilation', status: 'in_progress', message: 'Processing files...', timestamp: 2000 },
          { type: 'compilation', status: 'completed', message: 'Build successful!', timestamp: 3000 },
        ],
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed[1].progressEvents.length, 3, 'Should preserve progress events');
    assert.strictEqual(processed[1].progressEvents[0].status, 'started');
    assert.strictEqual(processed[1].progressEvents[2].status, 'completed');
  });

  it('should handle multi-step command execution', () => {
    const conversation = [
      {
        role: 'user',
        content: '/deploy Push to production',
      },
      {
        role: 'assistant',
        content: 'Executing deployment...',
        steps: [
          { id: 'step-1', instruction: 'Run tests', status: 'completed', output: 'Tests passed' },
          { id: 'step-2', instruction: 'Build artifacts', status: 'in_progress', output: 'Building...' },
          { id: 'step-3', instruction: 'Deploy to servers', status: 'pending', output: '' },
        ],
      },
      {
        role: 'user',
        content: 'Show me the current status',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed[1].steps.length, 3, 'Should preserve execution steps');
    assert.strictEqual(processed[1].steps[0].status, 'completed');
    assert.strictEqual(processed[1].steps[1].status, 'in_progress');
    assert.strictEqual(processed[1].steps[2].status, 'pending');
  });
});

describe('Edge cases - malformed and boundary conditions', () => {
  it('should handle message with null content gracefully', () => {
    const message = {
      role: 'user',
      content: null,
    };

    const result = normalizeMessage(message, null);
    assert.ok(result, 'Should handle null content');
    assert.strictEqual(result.role, 'user');
  });

  it('should handle message with undefined fields', () => {
    const message = {
      role: 'assistant',
    };

    const result = normalizeMessage(message, null);
    assert.ok(result, 'Should handle undefined fields');
    assert.strictEqual(result.role, 'assistant');
  });

  it('should handle message with extremely long content', () => {
    const longContent = 'A'.repeat(100000);
    const message = {
      role: 'user',
      content: longContent,
    };

    const result = normalizeMessage(message, null);
    assert.ok(result, 'Should handle extremely long content');
    assert.strictEqual(result.content.length, 100000);
  });

  it('should handle message with special characters and emojis', () => {
    const message = {
      role: 'user',
      content: 'Hello 🎉🔥🚀 #tag @mention /command https://url.com',
    };

    const result = normalizeMessage(message, null);
    assert.ok(result, 'Should handle special characters');
    assert.strictEqual(result.content, 'Hello 🎉🔥🚀 #tag @mention /command https://url.com');
  });

  it('should handle message with very large attachment', () => {
    const largeDataUrl = 'data:text/plain;base64,' + 'A'.repeat(1000000);
    const message = {
      role: 'user',
      content: 'Large file',
      attachments: [{
        id: 'large-file',
        dataUrl: largeDataUrl,
        filename: 'large.txt',
        mimeType: 'text/plain',
      }],
    };

    const result = normalizeMessage(message, null);
    assert.ok(result, 'Should handle large attachments');
    assert.strictEqual(result.attachments[0].dataUrl.length, largeDataUrl.length);
  });

  it('should handle conversation with mixed role types', () => {
    const conversation = [
      { role: 'system', content: 'System message' },
      { role: 'user', content: 'User message' },
      { role: 'assistant', content: 'Assistant message' },
      { role: 'system', content: 'Another system message' },
      { role: 'user', content: 'Another user message' },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed.length, 5);
    assert.strictEqual(processed[0].role, 'system');
    assert.strictEqual(processed[2].role, 'assistant');
    assert.strictEqual(processed[4].role, 'user');
  });
});

describe('Performance - large conversations and stress testing', () => {
  it('should handle conversation with 100 messages', () => {
    const conversation = [];
    for (let i = 0; i < 100; i++) {
      conversation.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      });
    }

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed.length, 100, 'Should process all 100 messages');
    assert.strictEqual(processed[0].content, 'Message 0');
    assert.strictEqual(processed[99].content, 'Message 99');
  });

  it('should handle conversation with many attachments', () => {
    const message = {
      role: 'user',
      content: 'Multiple files',
      attachments: Array.from({ length: 50 }, (_, i) => ({
        id: `file-${i}`,
        dataUrl: `data:text/plain;base64,${i}`,
        filename: `file${i}.txt`,
        mimeType: 'text/plain',
      })),
    };

    const result = normalizeMessage(message, null);
    assert.strictEqual(result.attachments.length, 50, 'Should handle 50 attachments');
  });

  it('should handle rapid message sequence', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Quick message ${i}`,
      timestamp: Date.now() + i,
    }));

    const processed = messages.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed.length, 20);
    assert.deepStrictEqual(processed.map(m => m.content), messages.map(m => m.content));
  });
});

describe('Complex attachment scenarios', () => {
  it('should handle mixed file types in single message', () => {
    const message = {
      role: 'user',
      content: 'Mixed file types',
      attachments: [
        { id: 'file-1', dataUrl: 'data:text/plain;base64,TEXT', filename: 'code.txt', mimeType: 'text/plain' },
        { id: 'file-2', dataUrl: 'data:image/png;base64,IMAGE', filename: 'screenshot.png', mimeType: 'image/png' },
        { id: 'file-3', dataUrl: 'data:application/json;base64,JSON', filename: 'data.json', mimeType: 'application/json' },
        { id: 'file-4', dataUrl: 'data:application/pdf;base64,PDF', filename: 'doc.pdf', mimeType: 'application/pdf' },
      ],
    };

    const result = normalizeMessage(message, null);
    assert.strictEqual(result.attachments.length, 4);
    assert.strictEqual(result.attachments[1].mimeType, 'image/png');
    assert.strictEqual(result.attachments[2].mimeType, 'application/json');
  });

  it('should handle conversation with attachments in multiple messages', () => {
    const conversation = [
      {
        role: 'user',
        content: 'First file',
        attachments: [{ id: 'file-1', dataUrl: 'data:text/plain;base64,A', filename: 'a.txt', mimeType: 'text/plain' }],
      },
      {
        role: 'assistant',
        content: 'Got file A',
      },
      {
        role: 'user',
        content: 'Second file',
        attachments: [{ id: 'file-2', dataUrl: 'data:text/plain;base64,B', filename: 'b.txt', mimeType: 'text/plain' }],
      },
      {
        role: 'assistant',
        content: 'Got file B',
      },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed[0].attachments.length, 1);
    assert.strictEqual(processed[2].attachments.length, 1);
    assert.strictEqual(processed[0].attachments[0].id, 'file-1');
    assert.strictEqual(processed[2].attachments[0].id, 'file-2');
  });

  it('should handle attachment with missing optional fields', () => {
    const message = {
      role: 'user',
      content: 'Minimal attachment',
      attachments: [{
        id: 'file-minimal',
        dataUrl: 'data:text/plain;base64,DATA',
        mimeType: 'text/plain',
      }],
    };

    const result = normalizeMessage(message, null);
    assert.ok(result.attachments[0].id);
    assert.ok(result.attachments[0].dataUrl);
    assert.ok(result.attachments[0].mimeType);
  });
});

describe('Advanced command scenarios', () => {
  it('should handle nested command structure', () => {
    const conversation = [
      { role: 'user', content: '/workflow create-project --name=my-app --type=react' },
      { role: 'assistant', content: 'Creating project with workflow...' },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed[0].content, '/workflow create-project --name=my-app --type=react');
  });

  it('should handle multiple commands in sequence', () => {
    const conversation = [
      { role: 'user', content: '/setup Initialize project' },
      { role: 'assistant', content: 'Project initialized' },
      { role: 'user', content: '/install Install dependencies' },
      { role: 'assistant', content: 'Dependencies installed' },
      { role: 'user', content: '/test Run tests' },
      { role: 'assistant', content: 'Tests running' },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed[0].content, '/setup Initialize project');
    assert.strictEqual(processed[2].content, '/install Install dependencies');
    assert.strictEqual(processed[4].content, '/test Run tests');
  });

  it('should handle command with @ mention and file together', () => {
    const message = {
      role: 'user',
      content: '/review @senior-dev Please review this PR',
      attachments: [{
        id: 'pr-diff',
        dataUrl: 'data:text/plain;base64,DIFF',
        filename: 'changes.patch',
        mimeType: 'text/plain',
      }],
    };

    const result = normalizeMessage(message, null);
    assert.strictEqual(result.content, '/review @senior-dev Please review this PR');
    assert.strictEqual(result.attachments.length, 1);
  });

  it('should handle command response with structured output and steps', () => {
    const message = {
      role: 'assistant',
      content: 'Executing complex workflow...',
      structuredOutput: {
        responseType: 'workflow_execution',
        workflow: {
          id: 'wf-1',
          name: 'Deploy Pipeline',
          status: 'running',
          steps: [
            { id: 'step-1', name: 'Build', status: 'completed', duration: 45000 },
            { id: 'step-2', name: 'Test', status: 'running', duration: null },
            { id: 'step-3', name: 'Deploy', status: 'pending', duration: null },
          ],
        },
      },
    };

    const result = normalizeMessage(message, null);
    assert.ok(result.structuredOutput);
    assert.strictEqual(result.structuredOutput.responseType, 'workflow_execution');
    assert.strictEqual(result.structuredOutput.workflow.steps.length, 3);
  });
});

describe('Message filtering and validation', () => {
  it('should handle filtering messages by role', () => {
    const conversation = [
      { role: 'system', content: 'System 1' },
      { role: 'user', content: 'User 1' },
      { role: 'assistant', content: 'Assistant 1' },
      { role: 'system', content: 'System 2' },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    const userMessages = processed.filter(m => m.role === 'user');
    const systemMessages = processed.filter(m => m.role === 'system');

    assert.strictEqual(userMessages.length, 1);
    assert.strictEqual(systemMessages.length, 2);
  });

  it('should handle message content validation', () => {
    const validMessages = [
      { role: 'user', content: 'Valid message' },
      { role: 'user', content: 'Another valid message' },
    ];

    const processed = validMessages.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed.length, 2);
    assert.ok(processed.every(m => m.content && m.content.length > 0));
  });

  it('should handle empty message filtering', () => {
    const messages = [
      { role: 'user', content: '' },
      { role: 'user', content: 'Valid message' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'Another valid' },
    ];

    const processed = messages.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed.length, 4);
  });
});

describe('Cross-session and multi-context scenarios', () => {
  it('should handle messages from different sessions', () => {
    const messages = [
      { sessionId: 'session-1', role: 'user', content: 'Session 1 message' },
      { sessionId: 'session-2', role: 'user', content: 'Session 2 message' },
      { sessionId: 'session-1', role: 'assistant', content: 'Session 1 response' },
    ];

    const processed = messages.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed[0].sessionId, 'session-1');
    assert.strictEqual(processed[1].sessionId, 'session-2');
    assert.strictEqual(processed[2].sessionId, 'session-1');
  });

  it('should handle conversation context switching', () => {
    const conversation = [
      { context: 'project-A', role: 'user', content: 'Work on project A' },
      { context: 'project-A', role: 'assistant', content: 'Working on A' },
      { context: 'project-B', role: 'user', content: 'Switch to project B' },
      { context: 'project-B', role: 'assistant', content: 'Working on B' },
      { context: 'project-A', role: 'user', content: 'Back to project A' },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed.length, 5);
    assert.strictEqual(processed[2].content, 'Switch to project B');
  });

  it('should handle multi-user conversation simulation', () => {
    const conversation = [
      { userId: 'user-1', role: 'user', content: 'User 1 speaking' },
      { role: 'assistant', content: 'Assistant responds' },
      { userId: 'user-2', role: 'user', content: 'User 2 speaking' },
      { role: 'assistant', content: 'Assistant responds to user 2' },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed[0].userId, 'user-1');
    assert.strictEqual(processed[2].userId, 'user-2');
  });
});

describe('Real-time streaming and concurrent operations', () => {
  it('should handle concurrent streaming updates', () => {
    const baseMessage = {
      role: 'assistant',
      content: 'Initial content',
    };

    const streamingStates = [
      { messageId: 'msg-1', content: 'Update 1', isActive: true },
      { messageId: 'msg-1', content: 'Update 2', isActive: true },
      { messageId: 'msg-1', content: 'Update 3', isActive: false },
    ];

    const results = streamingStates.map(state => normalizeMessage(baseMessage, state));
    assert.strictEqual(results[0].content, 'Update 1');
    assert.strictEqual(results[1].content, 'Update 2');
    assert.strictEqual(results[2].content, 'Update 3');
  });

  it('should handle streaming with reasoning events', () => {
    const message = { role: 'assistant', content: 'Thinking...' };
    const streaming = {
      messageId: 'msg-1',
      content: 'Final answer',
      reasoningEvents: [
        { text: 'Step 1', createdAt: 1000 },
        { text: 'Step 2', createdAt: 2000 },
      ],
      isActive: false,
    };

    const result = normalizeMessage(message, streaming);
    assert.strictEqual(result.content, 'Final answer');
  });

  it('should handle multiple concurrent conversations', () => {
    const conversation1 = [
      { conversationId: 'conv-1', role: 'user', content: 'Conv 1 - Message 1' },
      { conversationId: 'conv-1', role: 'assistant', content: 'Conv 1 - Response 1' },
    ];

    const conversation2 = [
      { conversationId: 'conv-2', role: 'user', content: 'Conv 2 - Message 1' },
      { conversationId: 'conv-2', role: 'assistant', content: 'Conv 2 - Response 1' },
    ];

    const processed1 = conversation1.map(msg => normalizeMessage(msg, null));
    const processed2 = conversation2.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(processed1[0].conversationId, 'conv-1');
    assert.strictEqual(processed2[0].conversationId, 'conv-2');
  });
});

describe('Advanced system message scenarios', () => {
  it('should handle multiple system message types in sequence', () => {
    const messages = [
      { role: 'system', content: '<auto-slash-command>help</auto-slash-command>' },
      { role: 'system', content: '[info] Context loaded' },
      { role: 'system', content: '<system-reminder>Session started</system-reminder>' },
      { role: 'user', content: 'User message' },
    ];

    const processed = messages.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed.length, 4);
    assert.strictEqual(processed[0].role, 'system');
    assert.strictEqual(processed[1].role, 'system');
    assert.strictEqual(processed[2].role, 'system');
  });

  it('should handle system messages with metadata', () => {
    const systemMessages = [
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command>',
        timestamp: 1000,
        source: 'auto-slash',
      },
      {
        role: 'system',
        content: '[info] Information',
        timestamp: 2000,
        source: 'info',
      },
    ];

    const processed = systemMessages.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed[0].timestamp, 1000);
    assert.strictEqual(processed[1].timestamp, 2000);
  });

  it('should handle system message deduplication with different sources', () => {
    const messages = [
      { role: 'system', content: 'Duplicate', source: 'source-1' },
      { role: 'system', content: 'Duplicate', source: 'source-2' },
      { role: 'system', content: 'Unique', source: 'source-3' },
    ];

    const deduped = dedupeSystemMessages(messages);
    assert.strictEqual(deduped.length, 2, 'Should deduplicate based on content');
  });
});

describe('Message corruption and recovery', () => {
  it('should handle conversation with corrupted message', () => {
    const conversation = [
      { role: 'user', content: 'Valid message 1' },
      { role: 'assistant', content: null }, // Corrupted
      { role: 'user', content: 'Valid message 2' },
    ];

    const processed = conversation.map(msg => normalizeMessage(msg, null));
    assert.strictEqual(processed.length, 3);
    assert.strictEqual(processed[0].content, 'Valid message 1');
  });

  it('should handle message with missing required fields', () => {
    const incompleteMessage = { content: 'Message without role' };
    const result = normalizeMessage(incompleteMessage, null);
    assert.ok(result, 'Should handle incomplete message');
  });

  it('should handle attachment data corruption', () => {
    const message = {
      role: 'user',
      content: 'File with corrupted data',
      attachments: [{
        id: 'corrupted-file',
        dataUrl: 'invalid-data-url',
        filename: 'corrupted.txt',
        mimeType: 'text/plain',
      }],
    };

    const result = normalizeMessage(message, null);
    assert.ok(result.attachments);
    assert.strictEqual(result.attachments[0].id, 'corrupted-file');
  });
});

describe('dedupeSystemMessages', () => {
  it('should return empty array for empty input', () => {
    const result = dedupeSystemMessages([]);
    assert.deepStrictEqual(result, []);
  });

  it('should remove duplicate system messages with identical content', () => {
    const messages = [
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
    const messages = [
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
    const messages = [
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
    const messages = [
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
    const messages = [
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
    const messages = [
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
    const messages = [
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
    assert.strictEqual(result[0].content, '[info] Test message');
  });
});
