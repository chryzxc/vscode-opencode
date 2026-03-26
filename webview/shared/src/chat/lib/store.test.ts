import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInternalTransportReminderMessage,
  hasSystemMessagePatternInText,
} from './store.ts';
import type { Message } from './types';

describe('isInternalTransportReminderMessage', () => {
  it('should detect square-bracketed system messages', () => {
    const message: Message = {
      role: 'user',
      content: '[analyze-mode]',
      parts: [{ type: 'text', text: '[analyze-mode]' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });

  it('should detect square-bracketed system messages with spaces', () => {
    const message: Message = {
      role: 'user',
      content: '[background task completed]',
      parts: [{ type: 'text', text: '[background task completed]' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });

  it('should detect angle-bracketed system messages', () => {
    const message: Message = {
      role: 'user',
      content: '<auto-slash-command>',
      parts: [{ type: 'text', text: '<auto-slash-command>' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });

  it('should detect angle-bracketed system messages with content', () => {
    const message: Message = {
      role: 'user',
      content: '<system-reminder>',
      parts: [{ type: 'text', text: '<system-reminder>' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });

  it('should detect comment-style system messages', () => {
    const message: Message = {
      role: 'user',
      content: '<!-- omo_internal_initiator -->',
      parts: [{ type: 'text', text: '<!-- omo_internal_initiator -->' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });

  it('should detect system messages with additional content', () => {
    const message: Message = {
      role: 'user',
      content: '<auto-slash-command>\n# /skill-creator Command\n\n**Description**: Guide for creating effective skills.',
      parts: [{ type: 'text', text: '<auto-slash-command>\n# /skill-creator Command' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });

  it('should not detect regular user messages', () => {
    const message: Message = {
      role: 'user',
      content: 'Hello, how are you?',
      parts: [{ type: 'text', text: 'Hello, how are you?' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), false);
  });

  it('should not detect assistant messages', () => {
    const message: Message = {
      role: 'assistant',
      content: '[analyze-mode]',
      parts: [{ type: 'text', text: '[analyze-mode]' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), false);
  });

  it('should not detect system role messages without patterns', () => {
    const message: Message = {
      role: 'system',
      content: 'You are a helpful assistant.',
      parts: [{ type: 'text', text: 'You are a helpful assistant.' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), false);
  });

  it('should not detect empty messages', () => {
    const message: Message = {
      role: 'user',
      content: '',
      parts: [{ type: 'text', text: '' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), false);
  });

  it('should not detect messages with brackets in the middle', () => {
    const message: Message = {
      role: 'user',
      content: 'This is a message with [brackets] in the middle',
      parts: [{ type: 'text', text: 'This is a message with [brackets] in the middle' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), false);
  });

  it('should be case insensitive for square brackets', () => {
    const message: Message = {
      role: 'user',
      content: '[ANALYZE-MODE]',
      parts: [{ type: 'text', text: '[ANALYZE-MODE]' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });

  it('should be case insensitive for angle brackets', () => {
    const message: Message = {
      role: 'user',
      content: '<AUTO-SLASH-COMMAND>',
      parts: [{ type: 'text', text: '<AUTO-SLASH-COMMAND>' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });

  it('should detect system messages with complex bracket patterns', () => {
    const message: Message = {
      role: 'user',
      content: '[search-model maximize search effort]',
      parts: [{ type: 'text', text: '[search-model maximize search effort]' }],
    };
    assert.strictEqual(isInternalTransportReminderMessage(message), true);
  });
});

describe('hasSystemMessagePatternInText', () => {
  it('should detect square-bracketed system messages in plain text', () => {
    const text = '[analyze-mode]';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should detect square-bracketed system messages with spaces', () => {
    const text = '[background task completed]';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should detect angle-bracketed system messages', () => {
    const text = '<auto-slash-command>';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should detect angle-bracketed system messages with content', () => {
    const text = '<system-reminder>';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should detect comment-style system messages', () => {
    const text = '<!-- omo_internal_initiator -->';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should detect system messages with additional content', () => {
    const text = '<auto-slash-command>\n# /skill-creator Command\n\n**Description**: Guide for creating effective skills.';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should not detect regular user messages', () => {
    const text = 'Hello, how are you?';
    assert.strictEqual(hasSystemMessagePatternInText(text), false);
  });

  it('should not detect empty text', () => {
    const text = '';
    assert.strictEqual(hasSystemMessagePatternInText(text), false);
  });

  it('should not detect whitespace-only text', () => {
    const text = '   ';
    assert.strictEqual(hasSystemMessagePatternInText(text), false);
  });

  it('should not detect messages with brackets in the middle', () => {
    const text = 'This is a message with [brackets] in the middle';
    assert.strictEqual(hasSystemMessagePatternInText(text), false);
  });

  it('should not detect messages with angle brackets in the middle', () => {
    const text = 'This is a message with <brackets> in the middle';
    assert.strictEqual(hasSystemMessagePatternInText(text), false);
  });

  it('should be case insensitive for square brackets', () => {
    const text = '[ANALYZE-MODE]';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should be case insensitive for angle brackets', () => {
    const text = '<AUTO-SLASH-COMMAND>';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should detect system messages with complex bracket patterns', () => {
    const text = '[search-model maximize search effort]';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should detect system messages with leading whitespace', () => {
    const text = '  [analyze-mode]';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should detect system messages with trailing whitespace', () => {
    const text = '[analyze-mode]  ';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });

  it('should not detect incomplete bracket patterns', () => {
    const text = '[analyze-mode';
    assert.strictEqual(hasSystemMessagePatternInText(text), false);
  });

  it('should not detect incomplete angle bracket patterns', () => {
    const text = '<auto-slash-command';
    assert.strictEqual(hasSystemMessagePatternInText(text), false);
  });

  it('should detect comment-style system messages with content', () => {
    const text = '<!-- internal_initiator some_content -->';
    assert.strictEqual(hasSystemMessagePatternInText(text), true);
  });
});
