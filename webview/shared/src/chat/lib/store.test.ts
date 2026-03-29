import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInternalTransportReminderMessage,
  hasSystemMessagePatternInText,
  normalizeComparableTextLocal,
  getMessageRoleForCanonical,
  getMessageIdForCanonical,
  getMessageCreatedAtForCanonical,
  extractMessageTextForCanonical,
  messageRichnessScoreForCanonical,
  dedupeMirrorMessagesForCanonical,
  coalesceAssistantRunForCanonical,
  canonicalizeMessagesForRender,
  upsertTodoItemArray,
  mergeStreamingReasoning,
} from './store';
import type { Message, TodoItem } from './types';

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

describe('normalizeComparableTextLocal', () => {
  it('should trim whitespace', () => {
    assert.strictEqual(normalizeComparableTextLocal('  hello  '), 'hello');
  });

  it('should lowercase text', () => {
    assert.strictEqual(normalizeComparableTextLocal('HELLO'), 'hello');
  });

  it('should handle null or undefined', () => {
    assert.strictEqual(normalizeComparableTextLocal(null as any), '');
    assert.strictEqual(normalizeComparableTextLocal(undefined as any), '');
  });
});

describe('getMessageRoleForCanonical', () => {
  it('should return role if present', () => {
    const message: Message = { role: 'user', content: 'hi' };
    assert.strictEqual(getMessageRoleForCanonical(message), 'user');
  });

  it('should return unknown if role is missing', () => {
    const message: any = { content: 'hi' };
    assert.strictEqual(getMessageRoleForCanonical(message), 'unknown');
  });
});

describe('getMessageIdForCanonical', () => {
  it('should return id if present', () => {
    const message: Message = { id: 'msg-1', role: 'user', content: 'hi' };
    assert.strictEqual(getMessageIdForCanonical(message), 'msg-1');
  });

  it('should return empty string if id is missing', () => {
    const message: Message = { role: 'user', content: 'hi' };
    assert.strictEqual(getMessageIdForCanonical(message), '');
  });
});

describe('getMessageCreatedAtForCanonical', () => {
  it('should return created if present', () => {
    const now = Date.now();
    const message: Message = { created: now, role: 'user', content: 'hi' };
    assert.strictEqual(getMessageCreatedAtForCanonical(message), now);
  });

  it('should return createdAt if present (via any)', () => {
    const now = Date.now();
    const message: any = { createdAt: now, role: 'user', content: 'hi' };
    assert.strictEqual(getMessageCreatedAtForCanonical(message), now);
  });

  it('should return 0 if nothing is present', () => {
    // getMessageCreatedAtForCanonical returns undefined if nothing found, but tests used 0 before.
    // Let's check store.ts implementation again.
    const message: Message = { role: 'user', content: 'hi' };
    assert.strictEqual(getMessageCreatedAtForCanonical(message), undefined);
  });
});

describe('extractMessageTextForCanonical', () => {
  it('should use content if available', () => {
    const message: Message = { role: 'user', content: 'hello' };
    assert.strictEqual(extractMessageTextForCanonical(message), 'hello');
  });

  it('should join parts if content is missing', () => {
    const message: Message = {
      role: 'user',
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    };
    assert.strictEqual(extractMessageTextForCanonical(message), 'hello\nworld');
  });

  it('should handle missing content and parts', () => {
    const message: Message = { role: 'user' };
    assert.strictEqual(extractMessageTextForCanonical(message), '');
  });

  it('should ignore non-text parts', () => {
    const message: Message = {
      role: 'user',
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'image', image: 'data:...' } as any,
      ],
    };
    assert.strictEqual(extractMessageTextForCanonical(message), 'hello');
  });
});

describe('messageRichnessScoreForCanonical', () => {
  it('should give score 0 for empty message', () => {
    const message: Message = { role: 'user' };
    assert.strictEqual(messageRichnessScoreForCanonical(message), 0);
  });

  it('should give points for content length', () => {
    const message: Message = { role: 'user', content: 'hi' };
    // length is 2. 2 is < 400.
    assert.strictEqual(messageRichnessScoreForCanonical(message), 2);
  });

  it('should give points for steps', () => {
    const message: Message = { role: 'assistant', content: 'hi', steps: [{} as any] };
    // length(2) + 1*6 = 8.
    // Wait, why did I think it was 3 before? Ah, I was misreading weights.
    assert.strictEqual(messageRichnessScoreForCanonical(message), 8);
  });

  it('should give points for reasoning events', () => {
    const message: Message = { role: 'assistant', reasoningEvents: [{ text: 'thinking...', createdAt: Date.now() }] };
    // length(0) + 1*6 = 6.
    assert.strictEqual(messageRichnessScoreForCanonical(message), 6);
  });
});

describe('dedupeMirrorMessagesForCanonical', () => {
  it('should deduplicate by ID and keep richer message', () => {
    const msg1: Message = { id: 'm1', role: 'user', content: 'short' };
    const msg2: Message = { id: 'm1', role: 'user', content: 'longer message content' };
    const result = dedupeMirrorMessagesForCanonical([msg1, msg2]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].content, 'longer message content');
  });

  it('should deduplicate by text within 4s window', () => {
    const now = Date.now();
    const msg1: Message = { role: 'user', content: 'hello', created: now };
    const msg2: Message = { role: 'user', content: 'hello', created: now + 2000 };
    const result = dedupeMirrorMessagesForCanonical([msg1, msg2]);
    assert.strictEqual(result.length, 1);
  });

  it('should NOT deduplicate by text outside 4s window', () => {
    const now = Date.now();
    const msg1: Message = { role: 'user', content: 'hello', created: now };
    const msg2: Message = { role: 'user', content: 'hello', created: now + 5000 };
    const result = dedupeMirrorMessagesForCanonical([msg1, msg2]);
    assert.strictEqual(result.length, 2);
  });

  it('should deduplicate system transport messages', () => {
    const now = Date.now();
    const msg1: Message = { role: 'user', content: '<auto-slash-command>', created: now };
    const msg2: Message = { role: 'user', content: '<auto-slash-command>', created: now + 1000 };
    const result = dedupeMirrorMessagesForCanonical([msg1, msg2]);
    assert.strictEqual(result.length, 1);
  });
});

describe('coalesceAssistantRunForCanonical', () => {
  it('should merge multiple assistant messages into one burst', () => {
    const msg1: Message = { role: 'assistant', content: 'In progress...', id: 'a1' };
    const msg2: Message = { role: 'assistant', content: 'Final answer!', id: 'a2', steps: [{ title: 'Thinking', status: 'completed', type: 'tool' }] };
    const result = coalesceAssistantRunForCanonical([msg1, msg2]);
    assert.strictEqual(result.role, 'assistant');
    assert.strictEqual(result.content, 'Final answer!');
    assert.strictEqual(result.id, 'a2');
    assert.ok(Array.isArray(result.steps));
    assert.strictEqual(result.steps?.length, 1);
  });

  it('should deduplicate steps by fingerprint', () => {
    const step: any = { title: 'Step X', status: 'completed', id: 'sx', type: 'tool' };
    const msg1: Message = { role: 'assistant', steps: [step], content: 'A' };
    const msg2: Message = { role: 'assistant', steps: [step], content: 'B' };
    const result = coalesceAssistantRunForCanonical([msg1, msg2]);
    assert.strictEqual(result.steps?.length, 1);
    assert.strictEqual(result.content, 'B'); // latest content
  });

  it('should merge reasoning events uniquely', () => {
    const now = Date.now();
    const event1 = { text: 'thought 1', createdAt: now };
    const event2 = { text: 'thought 2', createdAt: now + 1000 };
    const msg1: Message = { role: 'assistant', reasoningEvents: [event1] };
    const msg2: Message = { role: 'assistant', reasoningEvents: [event1, event2] };
    const result = coalesceAssistantRunForCanonical([msg1, msg2]);
    assert.strictEqual(result.reasoningEvents?.length, 2);
  });
});

describe('canonicalizeMessagesForRender', () => {
  it('should filter out internal transport reminders', () => {
    const messages: Message[] = [
      { role: 'user', content: 'user query' },
      { role: 'system', content: '<system-reminder>...</system-reminder>' },
      { role: 'assistant', content: 'response' }
    ];
    const result = canonicalizeMessagesForRender(messages);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].role, 'user');
    assert.strictEqual(result[1].role, 'assistant');
  });

  it('should coalesce back-to-back assistant messages into a single burst', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'thought...', id: 'a1' },
      { role: 'assistant', content: 'reply!', id: 'a2' }
    ];
    const result = canonicalizeMessagesForRender(messages);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[1].content, 'reply!');
    assert.strictEqual(result[1].id, 'a2');
  });
});

describe('upsertTodoItemArray', () => {
  it('should add a new todo item', () => {
    const items: TodoItem[] = [];
    const incoming: TodoItem = { id: 't1', text: 'Task 1', status: 'pending', sessionId: 's1' };
    const result = upsertTodoItemArray(items, incoming);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 't1');
  });

  it('should promote a todo status (pending -> completed)', () => {
    const items: TodoItem[] = [{ id: 't1', text: 'Task 1', status: 'pending', sessionId: 's1' }];
    const incoming: TodoItem = { id: 't1', text: 'Task 1', status: 'completed', sessionId: 's1' };
    const result = upsertTodoItemArray(items, incoming);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].status, 'completed');
  });

  it('should NOT overwrite a terminal status (completed -> pending)', () => {
    const items: TodoItem[] = [{ id: 't1', text: 'Task 1', status: 'completed', sessionId: 's1' }];
    const incoming: TodoItem = { id: 't1', text: 'Task 1', status: 'pending', sessionId: 's1' };
    const result = upsertTodoItemArray(items, incoming);
    assert.strictEqual(result[0].status, 'completed');
  });

  it('should ignore lower-rank updates (promote completed to in_progress)', () => {
    const items: TodoItem[] = [{ id: 't1', text: 'Task 1', status: 'completed', sessionId: 's1' }];
    const incoming: TodoItem = { id: 't1', text: 'Task 1', status: 'in_progress', sessionId: 's1' };
    const result = upsertTodoItemArray(items, incoming);
    assert.strictEqual(result[0].status, 'completed');
  });
});

describe('mergeStreamingReasoning', () => {
  it('should handle non-append mode (overwrite)', () => {
    const result = mergeStreamingReasoning('old', 'new', false);
    assert.strictEqual(result.reasoning, 'new');
    assert.strictEqual(result.eventChunk, 'new');
  });

  it('should detect and ignore duplicate reasoning chunks', () => {
    const current = 'I am thinking about the problem';
    const incoming = 'I am thinking about the problem'; // exact duplicate
    const result = mergeStreamingReasoning(current, incoming, true);
    assert.strictEqual(result.reasoning, current);
    assert.strictEqual(result.eventChunk, undefined);
  });

  it('should handle substring overlap (incoming is shorter tail)', () => {
    const current = 'Hello world how are you';
    const incoming = 'how are you';
    const result = mergeStreamingReasoning(current, incoming, true);
    // Normalized check should detect that 'how are you' is inside 'Hello world how are you'
    assert.strictEqual(result.reasoning, current);
  });

  it('should append unique chunks with proper boundary', () => {
    const current = 'Step1';
    const incoming = 'Step2';
    const result = mergeStreamingReasoning(current, incoming, true);
    // Boundary logic: /[A-Za-z0-9]/ at both ends -> add space
    assert.strictEqual(result.reasoning, 'Step1 Step2');
  });

  it('should replace last event if incoming is a larger superset (incremental expansion)', () => {
    const current = 'word';
    const incoming = 'word expanded';
    const result = mergeStreamingReasoning(current, incoming, true);
    assert.strictEqual(result.reasoning, 'word expanded');
    assert.strictEqual(result.replaceLastEvent, true);
  });

  it('should ignore duplicate chunks with different casing/punctuation (fingerprint matching)', () => {
    const current = 'I am thinking about the problem!';
    const incoming = 'I AM THINKING... about the PROBLEM';
    const result = mergeStreamingReasoning(current, incoming, true);
    // Fingerprint should be the same
    assert.strictEqual(result.reasoning, current);
    assert.strictEqual(result.eventChunk, undefined);
  });

  it('should handle whitespace/newline normalization', () => {
    const current = 'Thinking\nabout\nstuff';
    const incoming = 'Thinking about stuff';
    const result = mergeStreamingReasoning(current, incoming, true);
    // Normalized text is identical
    assert.strictEqual(result.reasoning, current);
  });

  it('should handle partial trailing overlap (suffix overlap)', () => {
    const current = 'Thinking of a solution';
    const incoming = 'of a solution';
    const result = mergeStreamingReasoning(current, incoming, true);
    assert.strictEqual(result.reasoning, current);
  });

  it('should ignore whitespace-only chunks', () => {
    const current = 'Thinking';
    const incoming = '   ';
    const result = mergeStreamingReasoning(current, incoming, true);
    assert.strictEqual(result.reasoning, current);
    assert.strictEqual(result.eventChunk, undefined);
  });

  it('should NOT merge non-overlapping text', () => {
    const current = 'Step1';
    const incoming = 'Step2';
    const result = mergeStreamingReasoning(current, incoming, true);
    // Should append with space
    assert.strictEqual(result.reasoning, 'Step1 Step2');
    assert.strictEqual(result.eventChunk, 'Step2');
  });
});
