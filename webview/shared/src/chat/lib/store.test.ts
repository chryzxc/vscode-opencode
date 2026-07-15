import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appReducer,
  initialState,
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

// Import the internal functions for testing
import {
  mergeActivityArraysLocal,
  getTimestampForItem,
} from './store';
import type { Message, Session, TodoItem } from './types';

describe('pending user messages', () => {
  it('adds a pending user message keyed by session', () => {
    const next = appReducer(initialState, {
      type: 'ADD_PENDING_USER_MESSAGE',
      payload: {
        id: 'pending-1',
        clientRequestId: 'req-1',
        sessionId: 'session-a',
        createdAt: 1000,
        text: 'hello',
      },
    });

    assert.deepStrictEqual(
      next.pendingUserMessagesBySessionId?.['session-a']?.map((message) => message.id),
      ['pending-1'],
    );
  });

  it('deduplicates optimistic pending user messages by client request id', () => {
    const seededState = appReducer(initialState, {
      type: 'ADD_PENDING_USER_MESSAGE',
      payload: {
        id: 'pending-1',
        clientRequestId: 'req-1',
        sessionId: 'session-a',
        createdAt: 1000,
        text: 'hello',
      },
    });

    const next = appReducer(seededState, {
      type: 'ADD_PENDING_USER_MESSAGE',
      payload: {
        id: 'pending-2',
        clientRequestId: 'req-1',
        sessionId: 'session-a',
        createdAt: 1001,
        text: 'hello again',
      },
    });

    assert.deepStrictEqual(
      next.pendingUserMessagesBySessionId?.['session-a']?.map((message) => message.id),
      ['pending-1'],
    );
  });

  it('confirms an optimistic pending user message without removing it before transcript handoff', () => {
    const seededState = appReducer(initialState, {
      type: 'ADD_PENDING_USER_MESSAGE',
      payload: {
        id: 'pending-1',
        clientRequestId: 'req-1',
        sessionId: 'session-a',
        createdAt: 1000,
        text: 'hello',
      },
    });

    const next = appReducer(seededState, {
      type: 'CONFIRM_PENDING_USER_MESSAGE',
      payload: {
        sessionId: 'session-a',
        clientRequestId: 'req-1',
        messageId: 'msg-1',
        createdAt: 1005,
        text: 'hello',
      },
    });

    assert.deepStrictEqual(
      next.pendingUserMessagesBySessionId?.['session-a']?.map((message) => ({
        id: message.id,
        confirmedMessageId: message.confirmedMessageId,
        confirmedAt: message.confirmedAt,
      })),
      [{ id: 'msg-1', confirmedMessageId: 'msg-1', confirmedAt: 1005 }],
    );
  });

  it('removes reconciled pending user messages by id', () => {
    const seededState = {
      ...initialState,
      currentSessionId: 'session-a',
      pendingUserMessagesBySessionId: {
        'session-a': [
          {
            id: 'pending-1',
            sessionId: 'session-a',
            createdAt: 1000,
            text: 'hello',
          },
          {
            id: 'pending-2',
            sessionId: 'session-a',
            createdAt: 1001,
            text: 'world',
          },
        ],
      },
    };

    const next = appReducer(seededState, {
      type: 'REMOVE_PENDING_USER_MESSAGES',
      payload: { sessionId: 'session-a', ids: ['pending-1'] },
    });

    assert.deepStrictEqual(
      next.pendingUserMessagesBySessionId?.['session-a']?.map((message) => message.id),
      ['pending-2'],
    );
  });

  it('moves draft-session pending messages onto the real session id during session hydration', () => {
    const seededState = {
      ...initialState,
      pendingUserMessagesBySessionId: {
        '__pending__:current': [
          {
            id: 'pending-1',
            sessionId: '__pending__:current',
            createdAt: 1000,
            text: 'hello',
          },
        ],
      },
    };

    const next = appReducer(seededState, {
      type: 'SET_SESSION_ID',
      payload: 'session-a',
    });

    assert.deepStrictEqual(
      next.pendingUserMessagesBySessionId?.['session-a']?.map((message) => message.id),
      ['pending-1'],
    );
    assert.strictEqual(
      next.pendingUserMessagesBySessionId?.['__pending__:current'],
      undefined,
    );
  });
});

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

describe('error message reducer state', () => {
  it('appends error toast messages', () => {
    const nextState = appReducer(initialState, {
      type: 'ADD_ERROR_MESSAGE',
      payload: 'Provider list timeout',
    });

    assert.deepStrictEqual(nextState.errorMessages, ['Provider list timeout']);
  });

  it('removes a dismissed error toast by index', () => {
    const seededState = {
      ...initialState,
      errorMessages: ['Could not auto-migrate plugin', 'Provider list timeout'],
    };

    const nextState = appReducer(seededState, {
      type: 'REMOVE_ERROR_MESSAGE',
      payload: 0,
    });

    assert.deepStrictEqual(nextState.errorMessages, ['Provider list timeout']);
  });

  it('stores live toast notifications separately from centralized raw events', () => {
    const nextState = appReducer(
      {
        ...initialState,
        currentSessionId: 'ses-live-toast',
      },
      {
        type: 'APPEND_LIVE_TOAST_NOTIFICATION',
        payload: {
          sessionId: 'ses-live-toast',
          notification: {
            key: 'toast-1',
            type: 'tui.toast.show',
            title: 'Heads up',
            message: 'Toast stays live-only',
            variant: 'info',
            durationMs: 1500,
          },
        },
      },
    );

    assert.deepStrictEqual(
      nextState.liveToastNotificationsBySessionId?.['ses-live-toast'],
      [
        {
          key: 'toast-1',
          type: 'tui.toast.show',
          title: 'Heads up',
          message: 'Toast stays live-only',
          variant: 'info',
          durationMs: 1500,
        },
      ],
    );
    assert.deepStrictEqual(
      nextState.rawSdkEventPayloadsBySessionId?.['ses-live-toast'],
      undefined,
    );
  });

  it('deduplicates live toast notifications by key', () => {
    const seededState = appReducer(
      {
        ...initialState,
        currentSessionId: 'ses-live-toast',
      },
      {
        type: 'APPEND_LIVE_TOAST_NOTIFICATION',
        payload: {
          sessionId: 'ses-live-toast',
          notification: {
            key: 'toast-1',
            type: 'tui.toast.show',
            title: 'Heads up',
            message: 'Toast stays live-only',
            variant: 'info',
            durationMs: 1500,
          },
        },
      },
    );

    const nextState = appReducer(seededState, {
      type: 'APPEND_LIVE_TOAST_NOTIFICATION',
      payload: {
        sessionId: 'ses-live-toast',
        notification: {
          key: 'toast-1',
          type: 'tui.toast.show',
          title: 'Heads up',
          message: 'Toast stays live-only',
          variant: 'info',
          durationMs: 1500,
        },
      },
    });

    assert.strictEqual(
      nextState.liveToastNotificationsBySessionId?.['ses-live-toast']?.length,
      1,
    );
  });
});

describe('streaming reasoning reducer state', () => {
  it('groups interleaved delta reasoning chunks by part id for live updates', () => {
    const seededState = appReducer(initialState, {
      type: 'SET_STREAMING',
      payload: {
        messageId: 'msg-reasoning',
        content: '',
        hasRenderableContent: false,
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true,
      },
    });

    const firstChunk = appReducer(seededState, {
      type: 'UPDATE_STREAMING_REASONING',
      payload: {
        reasoning: 'The',
        append: true,
        partID: 'part-1',
        messageID: 'msg-reasoning',
        delta: true,
      },
    });

    const interleavedPart = appReducer(firstChunk, {
      type: 'UPDATE_STREAMING_REASONING',
      payload: {
        reasoning: 'Plan',
        append: true,
        partID: 'part-2',
        messageID: 'msg-reasoning',
        delta: true,
      },
    });

    const nextState = appReducer(interleavedPart, {
      type: 'UPDATE_STREAMING_REASONING',
      payload: {
        reasoning: 'ory',
        append: true,
        partID: 'part-1',
        messageID: 'msg-reasoning',
        delta: true,
      },
    });

    assert.deepStrictEqual(
      nextState.streaming?.reasoningEvents.map((event) => ({
        partID: event.partID,
        messageID: event.messageID,
        text: event.text,
        delta: event.delta,
      })),
      [
        {
          partID: 'part-1',
          messageID: 'msg-reasoning',
          text: 'Theory',
          delta: true,
        },
        {
          partID: 'part-2',
          messageID: 'msg-reasoning',
          text: 'Plan',
          delta: true,
        },
      ],
    );
  });
});

describe('assistant turn pending lifecycle', () => {
  it('starts centralized streaming when a legacy state snapshot omits messages', () => {
    const seededState = {
      ...initialState,
      messages: undefined,
    } as unknown as typeof initialState;

    assert.doesNotThrow(() => appReducer(seededState, {
      type: 'SET_PROCESSING',
      payload: true,
    }));
  });

  it('tolerates a legacy streaming snapshot without content during centralized bootstrap', () => {
    const seededState = {
      ...initialState,
      streaming: {
        messageId: 'msg-old-assistant',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: false,
      } as unknown as NonNullable<typeof initialState.streaming>,
    };

    assert.doesNotThrow(() => appReducer(seededState, {
      type: 'SET_ASSISTANT_TURN_PENDING',
      payload: { pending: true, messageId: 'msg-new-assistant' },
    }));
  });

  it('clears a stale inactive streaming snapshot when a new assistant turn starts', () => {
    const seededState = {
      ...initialState,
      assistantTurnPending: false,
      assistantTurnMessageId: 'msg-old-assistant',
      streaming: {
        messageId: 'msg-old-assistant',
        content: 'previous assistant response',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: false,
      } as unknown as NonNullable<typeof initialState.streaming>,
    };

    const nextState = appReducer(seededState, {
      type: 'SET_ASSISTANT_TURN_PENDING',
      payload: {
        pending: true,
        messageId: 'msg-new-assistant',
      },
    });

    assert.strictEqual(nextState.assistantTurnPending, true);
    assert.strictEqual(nextState.assistantTurnMessageId, 'msg-new-assistant');
    assert.strictEqual(nextState.streaming, null);
  });

  it('does not carry the previous assistant message id into a fresh pending turn without an id yet', () => {
    const seededState = {
      ...initialState,
      assistantTurnPending: false,
      assistantTurnMessageId: 'msg-old-assistant',
    };

    const nextState = appReducer(seededState, {
      type: 'SET_ASSISTANT_TURN_PENDING',
      payload: {
        pending: true,
      },
    });

    assert.strictEqual(nextState.assistantTurnPending, true);
    assert.strictEqual(nextState.assistantTurnMessageId, null);
  });

  it('clears previous inactive streaming content when a fresh pending turn has no id yet', () => {
    const seededState = {
      ...initialState,
      currentSessionId: 'ses-1',
      assistantTurnPending: false,
      assistantTurnMessageId: 'msg-old-assistant',
      streaming: {
        messageId: 'msg-old-assistant',
        content: 'previous assistant response',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: false,
        hasRenderableContent: true,
      } as unknown as NonNullable<typeof initialState.streaming>,
      streamingBySessionId: {
        'ses-1': {
          messageId: 'msg-old-assistant',
          content: 'previous assistant response',
          reasoning: '',
          reasoningEvents: [],
          steps: [],
          progressEvents: [],
          edits: [],
          isActive: false,
          hasRenderableContent: true,
        } as NonNullable<typeof initialState.streaming>,
      },
    };

    const nextState = appReducer(seededState, {
      type: 'SET_ASSISTANT_TURN_PENDING',
      payload: {
        pending: true,
      },
    });

    assert.strictEqual(nextState.assistantTurnPending, true);
    assert.strictEqual(nextState.assistantTurnMessageId, null);
    assert.strictEqual(nextState.streaming, null);
    assert.strictEqual(nextState.streamingBySessionId?.['ses-1'], undefined);
  });

  it('does not keep assistant turn pending when switching to a fresh idle session', () => {
    const seededState = {
      ...initialState,
      currentSessionId: 'ses-old',
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg-old-assistant',
      isProcessing: true,
    };

    const nextState = appReducer(seededState, {
      type: 'SET_SESSION_ID',
      payload: 'ses-new',
    });

    assert.strictEqual(nextState.currentSessionId, 'ses-new');
    assert.strictEqual(nextState.assistantTurnPending, false);
    assert.strictEqual(nextState.assistantTurnMessageId, null);
    assert.strictEqual(nextState.isProcessing, false);
  });

  it('does not restore loading state from a hydrated aborted assistant turn', () => {
    const seededState = {
      ...initialState,
      currentSessionId: 'ses-old',
      processingSessionIds: ['ses-new'],
      messagesBySessionId: {
        'ses-new': [
          {
            id: 'msg-assistant-final',
            role: 'assistant',
            aborted: true,
            info: {
              id: 'msg-assistant-final',
              role: 'assistant',
              aborted: true,
              finish: 'stop',
            },
          } as Message,
        ],
      },
      streamingBySessionId: {
        'ses-new': {
          isActive: true,
          messageId: 'msg-assistant-final',
          content: 'still streaming?',
          reasoning: '',
          reasoningEvents: [],
          steps: [],
          progressEvents: [],
          edits: [],
        } as NonNullable<typeof initialState.streaming>,
      },
    };

    const nextState = appReducer(seededState, {
      type: 'HYDRATE_SESSION_FROM_CACHE',
      payload: {
        sessionId: 'ses-new',
      },
    });

    assert.strictEqual(nextState.currentSessionId, 'ses-new');
    assert.strictEqual(nextState.assistantTurnPending, false);
    assert.strictEqual(nextState.assistantTurnMessageId, null);
    assert.strictEqual(nextState.isProcessing, false);
    assert.strictEqual(nextState.streaming, null);
  });
});

describe('raw event capture', () => {
  it('stores the exact incoming SDK payload by session id', () => {
    const rawEvent = {
      type: 'message.part.updated',
      sessionId: 'ses_123',
      payload: {
        nested: true,
        text: 'raw text',
      },
    };

    const nextState = appReducer(
      {
        ...initialState,
        currentSessionId: 'ses_123',
      },
      {
        type: 'APPEND_RAW_SDK_EVENT_PAYLOAD',
        payload: {
          sessionId: 'ses_123',
          event: rawEvent,
        },
      },
    );

    assert.deepStrictEqual(
      nextState.rawSdkEventPayloadsBySessionId?.['ses_123'],
      [rawEvent],
    );
  });

  it('deduplicates identical SDK payloads by session id', () => {
    const rawEvent = {
      id: 'evt_123',
      type: 'message.part.updated',
      sessionId: 'ses_123',
      payload: {
        nested: true,
      },
    };

    const seededState = {
      ...initialState,
      currentSessionId: 'ses_123',
      rawSdkEventPayloadsBySessionId: {
        ses_123: [rawEvent],
      },
    };

    const nextState = appReducer(seededState, {
      type: 'APPEND_RAW_SDK_EVENT_PAYLOAD',
      payload: {
        sessionId: 'ses_123',
        event: rawEvent,
      },
    });

    assert.deepStrictEqual(
      nextState.rawSdkEventPayloadsBySessionId?.['ses_123'],
      [rawEvent],
    );
  });
});

describe('live event stream debug capture', () => {
  it('keeps unfiltered events in browser-only state and clears them on hydration', () => {
    const liveOnlyEvent = {
      type: 'message.part.updated',
      sessionId: 'ses_123',
      properties: { part: { type: 'reasoning', delta: 'private live chunk' } },
    };
    const captured = appReducer(
      { ...initialState, currentSessionId: 'ses_123' },
      {
        type: 'APPEND_LIVE_EVENT_STREAM_DEBUG',
        payload: { sessionId: 'ses_123', event: liveOnlyEvent },
      },
    );

    assert.deepStrictEqual(
      captured.liveEventStreamBySessionId?.['ses_123'],
      [liveOnlyEvent],
    );

    const cleared = appReducer(captured, { type: 'CLEAR_LIVE_EVENT_STREAM_DEBUG' });
    assert.deepStrictEqual(cleared.liveEventStreamBySessionId, {});
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

describe("appReducer render-stability guards", () => {
  it("marks streaming state when a terminal step-finish event arrives", () => {
    const streaming = {
      messageId: "msg-1",
      content: "",
      reasoning: "",
      reasoningEvents: [],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: true,
      hasRenderableContent: false,
      hasTerminalStepSignal: false,
    };
    const seededState = {
      ...initialState,
      streaming,
    };

    const next = appReducer(seededState, {
      type: "ADD_STREAMING_STEP",
      payload: {
        title: "Finishing step",
        type: "step",
        status: "done",
        partType: "step-finish",
      } as any,
    });

    assert.strictEqual(next.streaming?.hasTerminalStepSignal, true);
  });

  it("reuses state object for unchanged sessions list payload", () => {
    const sessions: Session[] = [
      { id: "s-1", title: "One", createdAt: 1 },
      { id: "s-2", title: "Two", createdAt: 2 },
    ];
    const first = appReducer(initialState, {
      type: "SET_SESSIONS_LIST",
      payload: sessions,
    });
    const second = appReducer(first, {
      type: "SET_SESSIONS_LIST",
      payload: [...sessions],
    });
    assert.strictEqual(second, first);
  });

  it("reuses state object for unchanged processing session ids", () => {
    const first = appReducer(initialState, {
      type: "SET_PROCESSING_SESSIONS",
      payload: ["session-a"],
    });
    const second = appReducer(first, {
      type: "SET_PROCESSING_SESSIONS",
      payload: ["session-a"],
    });
    assert.strictEqual(second, first);
  });

  it("preserves live interactive events during active turn when SET_MESSAGES has no question payload yet", () => {
    const liveInteractive = [
      {
        type: "question" as const,
        id: "q-live-1",
        question: "Pick one",
        options: [
          { label: "A", value: "A" },
          { label: "B", value: "B" },
        ],
      },
    ];
    const activeState = {
      ...initialState,
      isProcessing: true,
      interactiveEvents: liveInteractive,
      messages: [{ role: "user", content: "ask me" } as Message],
    };
    const next = appReducer(activeState, {
      type: "SET_MESSAGES",
      payload: [
        { role: "user", content: "ask me" },
        { role: "assistant", content: "Running question" },
      ],
    });

    assert.deepStrictEqual(next.interactiveEvents, liveInteractive);
  });

  it("keeps a dismissed interactive event hidden when SET_MESSAGES replays the same assistant payload", () => {
    const assistantMessage = {
      role: "assistant",
      content: "Running question",
      interactiveEvents: [
        {
          type: "question" as const,
          id: "q-dismiss-1",
          question: "Pick one",
          options: [
            { label: "A", value: "A" },
            { label: "B", value: "B" },
          ],
        },
      ],
    } as Message;

    const activeState = {
      ...initialState,
      isProcessing: true,
      interactiveEvents: assistantMessage.interactiveEvents ?? [],
      messages: [{ role: "user", content: "ask me" } as Message],
    };

    const dismissed = appReducer(activeState, {
      type: "DISMISS_INTERACTIVE_EVENT",
      payload: "q-dismiss-1",
    });
    assert.strictEqual(dismissed.interactiveEvents.length, 0);

    const next = appReducer(dismissed, {
      type: "SET_MESSAGES",
      payload: [
        { role: "user", content: "ask me" },
        assistantMessage,
      ],
    });

    assert.strictEqual(next.interactiveEvents.length, 0);
  });

  it("preserves rawSdkEventPayloads when caching session streaming state", () => {
    const payloads = [
      { type: "message.start", id: "evt-1" },
      { type: "message.delta", text: "hello" },
    ];
    const next = appReducer(initialState, {
      type: "SET_SESSION_STREAMING",
      payload: {
        sessionId: "session-a",
        streaming: {
          isActive: true,
          content: "hello",
          reasoning: "",
          reasoningEvents: [],
          progressEvents: [],
          steps: [],
          edits: [],
          interactiveEvents: [],
          rawSdkEventPayloads: payloads,
        } as any,
      },
    });

    assert.deepStrictEqual(
      next.streamingBySessionId?.["session-a"]?.rawSdkEventPayloads,
      payloads,
    );
  });

  it("preserves empty streaming arrays when a partial snapshot is merged", () => {
    const seededState = {
      ...initialState,
      streaming: {
        messageId: "msg-1",
        content: "",
        reasoning: "",
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        interactiveEvents: [],
        isActive: true,
      } as any,
    };

    const nextState = appReducer(seededState, {
      type: "SET_STREAMING",
      payload: {
        messageId: "msg-1",
        content: "",
        reasoning: "",
        isActive: true,
        hasRenderableContent: false,
      } as any,
    });

    assert.deepStrictEqual(nextState.streaming?.steps, []);
    assert.deepStrictEqual(nextState.streaming?.progressEvents, []);
    assert.deepStrictEqual(nextState.streaming?.reasoningEvents, []);
    assert.deepStrictEqual(nextState.streaming?.edits, []);
    assert.deepStrictEqual(nextState.streaming?.interactiveEvents, []);
  });

  it("normalizes incomplete streaming snapshots before subsequent updates", () => {
    const seededState = appReducer(initialState, {
      type: "SET_STREAMING",
      payload: {
        messageId: "msg-partial",
        isActive: true,
      } as any,
    });

    const nextState = appReducer(seededState, {
      type: "ADD_STREAMING_STEP",
      payload: { id: "step-1", title: "Working", status: "pending" },
    });

    assert.strictEqual(nextState.streaming?.content, "");
    assert.strictEqual(nextState.streaming?.reasoning, "");
    assert.strictEqual(nextState.streaming?.steps?.length, 1);
    assert.deepStrictEqual(nextState.streaming?.reasoningEvents, []);
  });

  it("preserves rawSdkEventPayloads order when canonicalizing duplicate assistant turns", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        id: "msg-1",
        rawSdkEventPayloads: [
          { id: "evt-1", type: "message.part.updated", properties: { time: 1 } },
        ],
        parts: [{ type: "text", text: "first" }],
      } as Message,
      {
        role: "assistant",
        id: "msg-1",
        rawSdkEventPayloads: [
          { id: "evt-2", type: "message.part.updated", properties: { time: 2 } },
        ],
        parts: [{ type: "text", text: "first again" }],
      } as Message,
    ];

    const deduped = dedupeMirrorMessagesForCanonical(messages);

    assert.strictEqual(deduped.length, 1);
    assert.deepStrictEqual(
      (deduped[0]?.rawSdkEventPayloads ?? []).map(
        (event) => (event as Record<string, unknown>).id,
      ),
      ["evt-1", "evt-2"],
    );
  });

  it("switches visible messages immediately on SET_SESSION_ID", () => {
    const stateWithSessionCache = {
      ...initialState,
      currentSessionId: "session-a",
      messages: [{ role: "user", content: "from A" } as Message],
      messagesBySessionId: {
        "session-a": [{ role: "user", content: "from A" } as Message],
        "session-b": [{ role: "user", content: "from B" } as Message],
      },
    };

    const next = appReducer(stateWithSessionCache, {
      type: "SET_SESSION_ID",
      payload: "session-b",
    });

    assert.strictEqual(next.currentSessionId, "session-b");
    assert.strictEqual(next.messages.length, 1);
    assert.strictEqual(next.messages[0].content, "from B");
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

  it('should prefer structured.message for explicit message response types', () => {
    const message: Message = {
      role: 'assistant',
      content: 'bridge text',
      structuredOutput: {
        responseType: 'message',
        message: 'final structured answer',
      } as any,
    };
    assert.strictEqual(
      extractMessageTextForCanonical(message),
      'final structured answer',
    );
  });

  it('should join parts if content is missing', () => {
    const message: Message = {
      role: 'user',
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    };
    assert.strictEqual(extractMessageTextForCanonical(message), 'hello world');
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

  it('should preserve rawResponse when deduplicating by ID', () => {
    const msgWithDebug: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Hello',
      rawResponse: '{"debug":true}',
    };
    const msgWithoutDebug: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Hello world',
    };

    const result = dedupeMirrorMessagesForCanonical([msgWithDebug, msgWithoutDebug]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual((result[0] as any).rawResponse, '{"debug":true}');
  });

  it('should preserve rawResponse when deduplicating by text', () => {
    const now = Date.now();
    const msgWithDebug: Message = {
      role: 'assistant',
      content: 'same text',
      created: now,
      rawResponse: '{"debug":"yes"}',
    };
    const msgWithoutDebug: Message = {
      role: 'assistant',
      content: 'same text',
      created: now + 500,
    };

    const result = dedupeMirrorMessagesForCanonical([msgWithDebug, msgWithoutDebug]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual((result[0] as any).rawResponse, '{"debug":"yes"}');
  });

  it('should deduplicate near-neighbor mirrored assistant text when createdAt is missing', () => {
    const msgHydrated: Message = {
      role: 'assistant',
      content: 'same assistant reply',
      rawResponse: '{"source":"hydrated"}',
    };
    const msgStreamFinal: Message = {
      role: 'assistant',
      content: 'same assistant reply',
      created: Date.now(),
    };

    const result = dedupeMirrorMessagesForCanonical([
      { role: 'user', content: 'prompt' },
      msgHydrated,
      msgStreamFinal,
    ]);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[1].content, 'same assistant reply');
    assert.strictEqual((result[1] as any).rawResponse, '{"source":"hydrated"}');
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

  it('preserves back-to-back SDK assistant messages as separate envelopes', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'thought...', id: 'a1' },
      { role: 'assistant', content: 'reply!', id: 'a2' }
    ];
    const result = canonicalizeMessagesForRender(messages);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[1].content, 'thought...');
    assert.strictEqual(result[1].id, 'a1');
    assert.strictEqual(result[2].content, 'reply!');
    assert.strictEqual(result[2].id, 'a2');
  });

  it('keeps an intermediate edit activity before the final assistant response', () => {
    const messages: Message[] = [
      { role: 'user', content: 'edit package.json', id: 'u1', created: 1 },
      { role: 'assistant', id: 'a-read', created: 2, steps: [{ type: 'tool', title: 'read' }] },
      { role: 'assistant', id: 'a-edit', created: 3, steps: [{ type: 'tool', title: 'edit' }] },
      { role: 'assistant', id: 'a-final', created: 4, content: 'Done.' },
    ];

    const result = canonicalizeMessagesForRender(messages);

    assert.deepStrictEqual(result.map((message) => message.id), [
      'u1', 'a-read', 'a-edit', 'a-final',
    ]);
  });

  it('should collapse an immediately repeated user+assistant turn', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hey there', id: 'u1', created: 10 },
      { role: 'assistant', content: 'Hello!', id: 'a1', created: 11 },
      { role: 'user', content: 'hey there', id: 'u2', created: 12 },
      { role: 'assistant', content: 'Hello!', id: 'a2', created: 13 },
    ];

    const result = canonicalizeMessagesForRender(messages);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, 'u1');
    assert.strictEqual(result[1].id, 'a1');
  });

  it('should collapse an immediately repeated user+assistant turn even when IDs differ', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hey there', id: 'u1', created: 10 },
      { role: 'assistant', content: 'Hello!', id: 'a1', created: 11 },
      { role: 'user', content: 'hey there', id: 'u2-different', created: 12 },
      { role: 'assistant', content: 'Hello!', id: 'a2-different', created: 13 },
    ];

    const result = canonicalizeMessagesForRender(messages);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].content, 'hey there');
    assert.strictEqual(result[1].content, 'Hello!');
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

describe('mergeActivityArraysLocal', () => {
  describe('temporal ordering preservation', () => {
    it('should preserve temporal order when merging items with timestamps', () => {
      const existing = [
        { id: 'step-1', title: 'First step', createdAt: 1000 },
        { id: 'step-3', title: 'Third step', createdAt: 3000 },
      ];

      const incoming = [
        { id: 'step-2', title: 'Second step', createdAt: 2000 },
        { id: 'step-4', title: 'Fourth step', createdAt: 4000 },
      ];

      const result = mergeActivityArraysLocal(existing, incoming);

      assert.ok(result, 'should return merged array');
      assert.strictEqual(result!.length, 4, 'should have all 4 steps');

      // Verify temporal order is preserved
      assert.strictEqual(result![0].id, 'step-1', 'first item should be step-1 (earliest timestamp)');
      assert.strictEqual(result![1].id, 'step-2', 'second item should be step-2 (second timestamp)');
      assert.strictEqual(result![2].id, 'step-3', 'third item should be step-3 (third timestamp)');
      assert.strictEqual(result![3].id, 'step-4', 'fourth item should be step-4 (latest timestamp)');
    });

    it('should handle user message during AI response streaming (real-world scenario)', () => {
      // Scenario: User sends message during active AI response stream
      // Existing: AI response steps already in progress
      // Incoming: New steps from continued streaming + user message interference

      const existing = [
        { id: 'tool-1', title: 'Reading file', createdAt: 1000, status: 'completed' },
        { id: 'tool-3', title: 'Analyzing code', createdAt: 3000, status: 'in_progress' },
      ];

      const incoming = [
        // User message came in at 2000, causing a new tool call
        { id: 'tool-2', title: 'User message received', createdAt: 2000, status: 'completed' },
        // AI continues after user message
        { id: 'tool-4', title: 'Generating response', createdAt: 4000, status: 'pending' },
      ];

      const result = mergeActivityArraysLocal(existing, incoming);

      assert.ok(result, 'should return merged array');
      assert.strictEqual(result!.length, 4, 'should have all 4 steps');

      // Verify the order respects actual timestamps, not array position
      assert.strictEqual(result![0].id, 'tool-1', 'should be tool-1 (1000)');
      assert.strictEqual(result![1].id, 'tool-2', 'should be tool-2 (2000) - user message step');
      assert.strictEqual(result![2].id, 'tool-3', 'should be tool-3 (3000)');
      assert.strictEqual(result![3].id, 'tool-4', 'should be tool-4 (4000)');
    });

    it('should maintain stable order for items without timestamps', () => {
      const existing = [
        { id: 'step-1', title: 'First' }, // no timestamp
        { id: 'step-3', title: 'Third' }, // no timestamp
      ];

      const incoming = [
        { id: 'step-2', title: 'Second' }, // no timestamp
        { id: 'step-4', title: 'Fourth' }, // no timestamp
      ];

      const result = mergeActivityArraysLocal(existing, incoming);

      assert.ok(result, 'should return merged array');
      assert.strictEqual(result!.length, 4, 'should have all 4 steps');

      // Without timestamps, existing items should come before incoming
      assert.strictEqual(result![0].id, 'step-1', 'existing items should come first');
      assert.strictEqual(result![1].id, 'step-3', 'existing items should come first');
      assert.strictEqual(result![2].id, 'step-2', 'incoming items should come after');
      assert.strictEqual(result![3].id, 'step-4', 'incoming items should come after');
    });

    it('should handle mixed items with and without timestamps', () => {
      const existing = [
        { id: 'step-1', title: 'First', createdAt: 1000 },
        { id: 'step-no-time-1', title: 'No time 1' }, // no timestamp
      ];

      const incoming = [
        { id: 'step-2', title: 'Second', createdAt: 2000 },
        { id: 'step-no-time-2', title: 'No time 2' }, // no timestamp
      ];

      const result = mergeActivityArraysLocal(existing, incoming);

      assert.ok(result, 'should return merged array');
      assert.strictEqual(result!.length, 4, 'should have all 4 steps');

      // Items with timestamps should be ordered first by time
      assert.strictEqual(result![0].id, 'step-1', 'step-1 has timestamp 1000');
      assert.strictEqual(result![1].id, 'step-2', 'step-2 has timestamp 2000');

      // Items without timestamps come after, maintaining relative order
      assert.strictEqual(result![2].id, 'step-no-time-1', 'no-time items come after timed items');
      assert.strictEqual(result![3].id, 'step-no-time-2', 'no-time items maintain source order');
    });

    it('should deduplicate items with same key while preserving temporal order', () => {
      const existing = [
        { id: 'step-1', title: 'First version', createdAt: 1000 },
        { id: 'step-2', title: 'Original step 2', createdAt: 2000 },
      ];

      const incoming = [
        { id: 'step-2', title: 'Updated step 2', createdAt: 2500 }, // same ID, later time
        { id: 'step-3', title: 'Step 3', createdAt: 3000 },
      ];

      const result = mergeActivityArraysLocal(existing, incoming);

      assert.ok(result, 'should return merged array');
      assert.strictEqual(result!.length, 3, 'should deduplicate step-2');

      assert.strictEqual(result![0].id, 'step-1', 'first item should be step-1');
      assert.strictEqual(result![1].id, 'step-2', 'step-2 should be updated but keep position');
      assert.strictEqual(result![1].title, 'Updated step 2', 'step-2 should have updated title');
      assert.strictEqual(result![2].id, 'step-3', 'last item should be step-3');
    });
  });

  describe('edge cases and hydration scenarios', () => {
    it('should handle empty arrays', () => {
      const result1 = mergeActivityArraysLocal([], []);
      assert.strictEqual(result1, undefined, 'two empty arrays should return undefined');

      const result2 = mergeActivityArraysLocal([{ id: '1', createdAt: 100 }], []);
      assert.strictEqual(result2!.length, 1, 'should return existing when incoming is empty');

      const result3 = mergeActivityArraysLocal([], [{ id: '2', createdAt: 200 }]);
      assert.strictEqual(result3!.length, 1, 'should return incoming when existing is empty');
    });

    it('should handle complex activity step scenario from user report', () => {
      // Simulate the exact scenario from the bug report:
      // User sends message during event stream, AI response comes after,
      // but when hydrated, AI response appears first (incorrect)

      const timestamp = Date.now();

      // Existing: Some steps from ongoing AI response
      const existingSteps = [
        { callID: 'tool-1', title: 'Reading config', createdAt: timestamp - 300, status: 'done' },
        { callID: 'tool-3', title: 'Analyzing requirements', createdAt: timestamp - 100, status: 'in_progress' },
      ];

      // Incoming: Steps that arrived during user message interruption
      const incomingSteps = [
        // User message came in and was processed
        { callID: 'user-msg-1', title: 'User message processed', createdAt: timestamp - 200, status: 'done' },
        // AI continues after interruption
        { callID: 'tool-4', title: 'Generating response', createdAt: timestamp, status: 'pending' },
      ];

      const result = mergeActivityArraysLocal(existingSteps, incomingSteps);

      assert.ok(result, 'should return merged array');
      assert.strictEqual(result!.length, 4, 'should have all 4 steps');

      // The critical fix: verify correct temporal order
      assert.strictEqual(result![0].callID, 'tool-1', 'oldest step should be first');
      assert.strictEqual(result![1].callID, 'user-msg-1', 'user message step should be in correct chronological position');
      assert.strictEqual(result![2].callID, 'tool-3', 'should be in middle');
      assert.strictEqual(result![3].callID, 'tool-4', 'newest step should be last');

      // Verify timestamps are in ascending order
      for (let i = 1; i < result!.length; i++) {
        const prevTime = result![i - 1].createdAt;
        const currTime = result![i].createdAt;
        assert.ok(currTime >= prevTime, `Item ${i} should have timestamp >= previous item`);
      }
    });

    it('should preserve activity steps during rehydration (fixes missing steps)', () => {
      // Test scenario where activity steps were missing after rehydration

      const baseTime = Date.now();

      // Existing: Cached steps with some detail
      const existing = [
        { id: '1', title: 'Step 1', createdAt: baseTime, status: 'completed', detail: 'full detail' },
        { id: '3', title: 'Step 3', createdAt: baseTime + 200, status: 'pending' },
      ];

      // Incoming: Rehydrated steps with additional information
      const incoming = [
        { id: '2', title: 'Step 2', createdAt: baseTime + 100, status: 'completed' },
        { id: '3', title: 'Step 3', createdAt: baseTime + 200, status: 'in_progress', detail: 'new detail' },
      ];

      const result = mergeActivityArraysLocal(existing, incoming);

      assert.ok(result, 'should return merged array');
      assert.strictEqual(result!.length, 3, 'should have 3 steps after deduplication');

      // Step 3 should be merged with both details
      assert.strictEqual(result![2].id, '3');
      assert.strictEqual(result![2].detail, 'new detail', 'should preserve incoming details for same ID');
    });

    it('should ignore sparse-array holes and undefined entries without crashing', () => {
      const existing = new Array(2) as Array<{ id: string; createdAt: number } | undefined>;
      existing[1] = { id: 'step-2', createdAt: 2000 };

      const incoming = [
        undefined,
        { id: 'step-1', createdAt: 1000 },
      ] as Array<{ id: string; createdAt: number } | undefined>;

      const result = mergeActivityArraysLocal(existing, incoming);

      assert.ok(result, 'should still return defined merged activity items');
      assert.deepStrictEqual(
        result?.map((entry) => entry.id),
        ['step-1', 'step-2'],
        'undefined activity entries should be skipped while valid items remain chronologically ordered',
      );
    });
  });
});

describe('getTimestampForItem', () => {
  it('should extract timestamp from common timestamp fields', () => {
    const item1 = { createdAt: 12345, title: 'Test' };
    assert.strictEqual(getTimestampForItem(item1), 12345, 'should extract createdAt');

    const item2 = { timestamp: 67890, title: 'Test' };
    assert.strictEqual(getTimestampForItem(item2), 67890, 'should extract timestamp');

    const item3 = { time: 11111, title: 'Test' };
    assert.strictEqual(getTimestampForItem(item3), 11111, 'should extract time');

    const item4 = { date: 22222, title: 'Test' };
    assert.strictEqual(getTimestampForItem(item4), 22222, 'should extract date');
  });

  it('should return undefined for items without timestamps', () => {
    const item = { title: 'No timestamp' };
    assert.strictEqual(getTimestampForItem(item), undefined, 'should return undefined for no timestamp');

    assert.strictEqual(getTimestampForItem(null), undefined, 'should handle null');
    assert.strictEqual(getTimestampForItem(undefined), undefined, 'should handle undefined');
  });

  it('should ignore invalid timestamp values', () => {
    const item1 = { createdAt: NaN, title: 'Test' };
    assert.strictEqual(getTimestampForItem(item1), undefined, 'should ignore NaN');

    const item2 = { createdAt: Infinity, title: 'Test' };
    assert.strictEqual(getTimestampForItem(item2), undefined, 'should ignore Infinity');

    const item3 = { createdAt: 'not a number', title: 'Test' };
    assert.strictEqual(getTimestampForItem(item3), undefined, 'should ignore non-numeric values');
  });
});
