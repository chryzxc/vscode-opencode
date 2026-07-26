import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AppState, Message } from './types';
import {
  createMessageHandler,
  extractEventMessageId,
  normalizeMessage,
  dedupeSystemMessages,
  shouldPreferCachedSwitchMessages,
  resolveStreamingContentUpdate,
  coalesceAdjacentAssistantHistoryMessages,
  getCentralizedAssistantContentChunksFromRawSdkEventPayloads,
  getCentralizedAssistantTurnCompletionIndex,
  isAiResponseEvent,
  permissionRequestFromSdkPayload,
  structuredOutputFromRawSdkEventPayloads,
  terminalEventMatchesAssistantTurn,
} from './messageHandler';
import {
  getFinalAssistantResponseText,
  getFinalAssistantResponseTextFromRawSdkEventPayloads,
} from './rawResponse';
import { appReducer, initialState } from './store';

describe('extractEventMessageId', () => {
  it('uses a tool part messageID instead of its evt transport-frame ID', () => {
    assert.equal(
      extractEventMessageId({
        id: 'evt_transport_frame',
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'prt_tool_1',
            messageID: 'msg_assistant_1',
            type: 'tool',
          },
        },
      }),
      'msg_assistant_1',
    );
  });

  it('does not treat an evt transport-frame ID as an assistant message ID', () => {
    assert.equal(
      extractEventMessageId({ id: 'evt_transport_frame', type: 'message.part.updated' }),
      null,
    );
  });

  it('does not treat a session envelope ID as an assistant message ID', () => {
    assert.equal(
      extractEventMessageId({ id: 'ses_stream_session', type: 'session.updated' }),
      null,
    );
  });
});

describe('normalizeMessage - responseType handling', () => {
  it('ignores undefined interactive events from an untrusted payload', () => {
    const result = normalizeMessage({
      role: 'assistant',
      content: 'Choose an option',
      structuredOutput: {
        responseType: 'question',
        interactiveEvents: [undefined, {
          type: 'question',
          id: 'question-1',
          question: 'Which option?',
          options: [{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }],
        }],
      },
    } as unknown as Message, null);

    assert.deepEqual(result?.interactiveEvents?.map((event) => event.type), ['question']);
  });

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

describe('terminalEventMatchesAssistantTurn', () => {
  it('matches a terminal step event by its direct messageID', () => {
    assert.equal(
      terminalEventMatchesAssistantTurn(
        {
          type: 'message.part.updated',
          properties: {
            part: { type: 'step-finish', messageID: 'msg-parent' },
          },
        },
        ['msg-parent'],
      ),
      true,
    );
  });

  it('matches a deeply nested background-agent terminal event by parentMessageId', () => {
    assert.equal(
      terminalEventMatchesAssistantTurn(
        {
          payload: {
            syncEvent: {
              data: {
                part: {
                  type: 'step-finish',
                  messageID: 'msg-background-agent',
                  parentMessageId: 'msg-parent',
                },
              },
            },
          },
        },
        ['msg-parent'],
      ),
      true,
    );
  });

  it('does not let another assistant turn clear the active loading state', () => {
    assert.equal(
      terminalEventMatchesAssistantTurn(
        {
          properties: {
            part: { type: 'step-finish', messageID: 'msg-other' },
          },
        },
        ['msg-parent'],
      ),
      false,
    );
  });
});

describe('permissionRequestFromSdkPayload', () => {
  const request = {
    id: 'per-example',
    sessionID: 'ses-example',
    permission: 'read',
    patterns: ['apps/backend/.env'],
    always: ['*'],
  };

  it('normalizes the live permission.asked event envelope', () => {
    assert.deepEqual(
      permissionRequestFromSdkPayload({ type: 'permission.asked', properties: request }),
      request,
    );
  });

  it('normalizes the rehydrated permission-list record', () => {
    assert.deepEqual(permissionRequestFromSdkPayload(request), request);
  });
});

describe('createMessageHandler - terminal turn identity', () => {
  it('ends loading when a matching step-finish arrives for the active assistant turn', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses-terminal',
      isProcessing: true,
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg-parent',
      streaming: {
        messageId: 'msg-parent',
        content: 'Completed response',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-terminal',
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'step-finish',
              messageID: 'msg-parent',
              reason: 'stop',
            },
          },
        },
      },
    } as MessageEvent);

    assert.equal(state.isProcessing, false);
    assert.equal(state.assistantTurnPending, false);
    assert.equal(state.streaming?.isActive, false);
  });

  it('keeps loading locked off for the same message after finish stop and heartbeat events', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses-terminal-lock',
      isProcessing: true,
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg-terminal-lock',
      streaming: {
        messageId: 'msg-terminal-lock',
        content: 'Completed response',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        processing: true,
        sessionId: 'ses-terminal-lock',
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'step-finish',
              messageID: 'msg-terminal-lock',
              reason: 'stop',
            },
          },
        },
      },
    } as MessageEvent);

    handler({
      data: {
        type: 'streamEvent',
        processing: true,
        sessionId: 'ses-terminal-lock',
        event: { type: 'server.heartbeat' },
      },
    } as MessageEvent);

    handler({
      data: {
        type: 'streamEvent',
        processing: true,
        sessionId: 'ses-terminal-lock',
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-terminal-lock',
              role: 'assistant',
            },
          },
        },
      },
    } as MessageEvent);

    assert.equal(state.isProcessing, false);
    assert.equal(state.assistantTurnPending, false);
    assert.equal(state.streaming?.isActive, false);
  });

  it('preserves a visible assistant phase when the stream changes message id', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses-multi-phase',
      isProcessing: true,
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg-phase-1',
      messages: [
        { id: 'msg-user', role: 'user', content: 'Inspect the project' },
      ],
      streaming: {
        messageId: 'msg-phase-1',
        content: 'The first visible response block must remain.',
        hasRenderableContent: true,
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-multi-phase',
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg-phase-2',
              role: 'assistant',
            },
          },
        },
      },
    } as MessageEvent);

    assert.equal(state.streaming?.messageId, 'msg-phase-2');
    assert.ok(
      state.messages.some(
        (message) =>
          (message.id === 'msg-phase-1' || message.info?.id === 'msg-phase-1') &&
          message.content === 'The first visible response block must remain.',
      ),
      'the populated response phase must be materialized before the live stream is re-keyed',
    );
  });

  it('re-keys a roleless assistant phase instead of leaving later parts on the prior turn', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses-roleless-phase',
      isProcessing: true,
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg-phase-1',
      streaming: {
        messageId: 'msg-phase-1',
        content: '',
        hasRenderableContent: true,
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: false,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-roleless-phase',
        event: {
          type: 'message.updated',
          properties: { info: { id: 'msg-phase-2' } },
        },
      },
    } as MessageEvent);

    assert.equal(state.streaming?.messageId, 'msg-phase-2');
    assert.equal(state.streaming?.isActive, true);
  });

  it('recovers an activity part that arrives before the assistant-phase rekey commits', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses-phase-part-rekey',
      isProcessing: true,
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg-phase-2',
      streaming: {
        messageId: 'msg-phase-1',
        content: '',
        hasRenderableContent: false,
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: false,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-phase-part-rekey',
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'prt-phase-2-step',
              messageID: 'msg-phase-2',
              sessionID: 'ses-phase-part-rekey',
              type: 'step-start',
              title: 'Reading files',
            },
          },
        },
      },
    } as MessageEvent);

    assert.equal(state.streaming?.messageId, 'msg-phase-2');
    assert.equal(state.streaming?.isActive, true);
    assert.equal(state.streaming?.steps.length, 1);
  });
});

describe('createMessageHandler - chatHistory hydration guards', () => {
  it('surfaces a missing selected session instead of treating it as an empty chat', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses-previous',
      messages: [{ id: 'msg-previous', role: 'user', content: 'Previous chat' }],
      isProcessing: true,
      processingSessionIds: ['ses-missing'],
      isLoadingSession: true,
      loadingSessionId: 'ses-missing',
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'chatHistory',
        sessionId: 'ses-missing',
        available: false,
        unavailableReason: 'not_found',
        unavailableMessage: 'This session is not available on the current OpenCode server.',
        unavailableStatus: 404,
        messages: [],
        sdkMessages: [],
      },
    } as MessageEvent);

    assert.equal(state.currentSessionId, 'ses-missing');
    assert.deepEqual(state.messages, []);
    assert.deepEqual(state.sessionLoadError, {
      sessionId: 'ses-missing',
      reason: 'not_found',
      message: 'This session is not available on the current OpenCode server.',
      status: 404,
    });
    assert.equal(state.isLoadingSession, false);
    assert.equal(state.isProcessing, false);
    assert.deepEqual(state.processingSessionIds, []);
  });

  it('clears the unavailable state when SDK history becomes available', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses-restored',
      sessionLoadError: {
        sessionId: 'ses-restored',
        reason: 'not_found' as const,
        message: 'Missing',
        status: 404,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'chatHistory',
        sessionId: 'ses-restored',
        available: true,
        messages: [{ id: 'msg-restored', role: 'assistant', content: 'Restored' }],
        sdkMessages: [],
      },
    } as MessageEvent);

    assert.equal(state.sessionLoadError, null);
    assert.equal(state.messages[0]?.content, 'Restored');
  });

  it('preserves an already visible transcript when rehydration fails for the active session', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses-active',
      messages: [{ id: 'msg-visible', role: 'assistant', content: 'Keep this visible' }],
      isLoadingSession: true,
      loadingSessionId: 'ses-active',
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'chatHistory',
        sessionId: 'ses-active',
        available: false,
        unavailableReason: 'unavailable',
        unavailableMessage: 'OpenCode could not decode structured-output metadata.',
        unavailableStatus: 400,
        messages: [],
        sdkMessages: [],
      },
    } as MessageEvent);

    assert.equal(state.messages[0]?.content, 'Keep this visible');
    assert.equal(state.sessionLoadError?.status, 400);
    assert.equal(state.isLoadingSession, false);
  });

  it('atomically clears stale loading and Stop state when SDK history ends in finish stop', () => {
    let state = {
      ...initialState,
      currentSessionId: 'ses_082a1eab5ffelEiB03kCEV4H3m',
      isProcessing: true,
      processingSessionIds: ['ses_082a1eab5ffelEiB03kCEV4H3m'],
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg_f7d7187fa001xFMswmdQqMS7Hn',
      streaming: {
        messageId: 'msg_f7d7187fa001xFMswmdQqMS7Hn',
        content: 'All work is complete.',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'chatHistory',
        sessionId: 'ses_082a1eab5ffelEiB03kCEV4H3m',
        processingSessionIds: ['ses_082a1eab5ffelEiB03kCEV4H3m'],
        messages: [
          { id: 'msg_user', role: 'user', content: 'Finish the work' },
          {
            id: 'msg_f7d7187fa001xFMswmdQqMS7Hn',
            role: 'assistant',
            content: 'All work is complete.',
            finish: 'stop',
          },
        ],
        sdkMessages: [
          { info: { id: 'msg_user', role: 'user', time: { created: 1784515977887 } } },
          {
            info: {
              id: 'msg_f7d7187fa001xFMswmdQqMS7Hn',
              role: 'assistant',
              time: { created: 1784516020218, completed: 1784516026862 },
              finish: 'stop',
            },
          },
        ],
      },
    } as MessageEvent);

    assert.equal(state.isProcessing, false);
    assert.equal(state.assistantTurnPending, false);
    assert.equal(state.streaming, null);
    assert.deepEqual(state.processingSessionIds, []);
  });

  it('should tolerate missing availableModels while recalculating context usage from chatHistory', () => {
    let state = {
      ...initialState,
      availableModels: undefined,
    } as unknown as AppState;
    const actions: Array<{ type: string; payload?: unknown }> = [];

    const dispatch = (action: { type: string; payload?: unknown }) => {
      actions.push(action);
      state = appReducer(state, action as never);
    };

    const handler = createMessageHandler(
      dispatch as never,
      () => state,
    );

    handler({
      data: {
        type: 'chatHistory',
        sessionId: 'ses-context-hydration',
        messages: [
          {
            id: 'msg-assistant-1',
            role: 'assistant',
            content: 'Hydrated assistant reply',
            tokens: {
              input: 1024,
            },
          },
        ],
      },
    } as MessageEvent);

    assert.ok(
      actions.some((action) => action.type === 'SET_MESSAGES'),
      'chatHistory should still hydrate messages',
    );
    assert.ok(
      actions.some((action) => action.type === 'SET_CONTEXT_USAGE_PCT'),
      'chatHistory should still recalculate context usage without throwing',
    );
    assert.ok(
      actions.some((action) => action.type === 'CLEAR_SUBAGENTS_FOR_SESSION'),
      'chatHistory should continue through the rest of hydration',
    );
  });
});

describe('createMessageHandler - SDK context usage', () => {
  it('uses tokens.input from a streaming SDK message.updated event', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-sdk-context',
      isProcessing: true,
      selectedModel: { providerID: 'openai', modelID: 'gpt-test' },
      availableModels: [
        {
          providerID: 'openai',
          modelID: 'gpt-test',
          name: 'GPT test',
          contextLimit: 1_000_000,
        },
      ],
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-sdk-context',
        event: {
          type: 'message.updated',
          info: {
            id: 'msg-sdk-context',
            role: 'assistant',
            providerID: 'openai',
            modelID: 'gpt-test',
            tokens: { input: 12_345 },
          },
        },
      },
    } as MessageEvent);

    assert.equal(state.contextInputTokens, 12_345);
    assert.equal(state.contextUsagePct, 1);
  });
});

describe('createMessageHandler - live tool activity identity', () => {
  it('renders a completed assistant text part from the global stream before hydration', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-live-text',
      isProcessing: true,
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg-live-text',
      streaming: {
        messageId: 'msg-live-text',
        content: '',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-live-text',
        event: {
          id: 'evt-live-completed-text',
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-live-text',
            part: {
              id: 'prt-live-text',
              messageID: 'msg-live-text',
              sessionID: 'ses-live-text',
              type: 'text',
              text: 'Good question. Let me investigate the current data fetching architecture.',
              time: { start: 1, end: 2 },
            },
          },
        },
      },
    } as MessageEvent);

    assert.equal(
      state.streaming?.content,
      'Good question. Let me investigate the current data fetching architecture.',
    );
    assert.equal(state.streaming?.hasRenderableContent, true);
  });

  it('keeps the live response while OpenCode advances to another assistant envelope in the same turn', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-phase-text',
      isProcessing: true,
      assistantTurnPending: true,
      assistantTurnMessageId: 'msg-phase-one',
      streaming: {
        messageId: 'msg-phase-one',
        content: 'First visible response. ',
        hasRenderableContent: true,
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true,
      },
    } as AppState;
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-phase-text',
        event: {
          type: 'message.updated',
          properties: {
            info: { id: 'msg-phase-two', role: 'assistant', parentID: 'msg-user-turn' },
          },
        },
      },
    } as MessageEvent);
    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-phase-text',
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'prt-phase-two-text',
              messageID: 'msg-phase-two',
              type: 'text',
              text: 'Second visible response.',
            },
          },
        },
      },
    } as MessageEvent);

    assert.equal(state.streaming?.messageId, 'msg-phase-two');
    assert.equal(
      state.streaming?.content,
      'First visible response. Second visible response.',
    );
    assert.equal(state.streaming?.hasRenderableContent, true);
  });

  it('keeps tool snapshots with distinct wrapper event ids on their assistant message', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-live-tool',
      isProcessing: true,
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    const toolEvent = (eventId: string, status: string) => ({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-live-tool',
        event: {
          id: eventId,
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-live-tool',
            part: {
              id: 'prt-live-tool',
              type: 'tool',
              tool: 'read',
              callID: 'call-live-tool',
              messageID: 'msg-live-tool',
              state: {
                status,
                input: { filePath: '/workspace/package.json' },
              },
            },
          },
        },
      },
    });

    handler(toolEvent('evt-tool-pending', 'pending') as never);
    handler(toolEvent('evt-tool-running', 'running') as never);

    assert.strictEqual(state.streaming?.messageId, 'msg-live-tool');
    assert.strictEqual(state.streaming?.steps.length, 1);
    assert.strictEqual(state.streaming?.steps[0]?.callID, 'call-live-tool');
    assert.strictEqual(state.streaming?.steps[0]?.status, 'running');
  });

  it('renders a sync-wrapped centralized tool event without waiting for hydration', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-sync-tool',
      isProcessing: true,
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-sync-tool',
        event: {
          id: 'evt-sync-tool',
          type: 'sync',
          syncEvent: {
            type: 'message.part.updated',
            data: {
              part: {
                id: 'prt-sync-tool',
                type: 'tool',
                tool: 'bash',
                callID: 'call-sync-tool',
                messageID: 'msg-sync-tool',
                state: { status: 'running', input: { command: 'pwd' } },
              },
            },
          },
        },
      },
    } as never);

    assert.strictEqual(state.streaming?.messageId, 'msg-sync-tool');
    assert.strictEqual(state.streaming?.steps.length, 1);
    assert.strictEqual(state.streaming?.steps[0]?.callID, 'call-sync-tool');
  });

  it('renders the first sync-wrapped tool event before processing state is committed', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-sync-first-event',
      isProcessing: false,
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-sync-first-event',
        event: {
          id: 'evt-sync-first-tool',
          type: 'sync',
          syncEvent: {
            type: 'message.part.updated',
            data: {
              part: {
                id: 'prt-sync-first-tool',
                type: 'tool',
                tool: 'bash',
                callID: 'call-sync-first-tool',
                messageID: 'msg-sync-first-tool',
                state: { status: 'running', input: { command: 'pwd' } },
              },
            },
          },
        },
      },
    } as never);

    assert.strictEqual(state.streaming?.messageId, 'msg-sync-first-tool');
    assert.strictEqual(state.streaming?.steps.length, 1);
    assert.strictEqual(state.streaming?.steps[0]?.callID, 'call-sync-first-tool');
    assert.strictEqual(state.isProcessing, true);
  });

  it('retains Bash command and metadata output across live tool snapshots', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-live-bash-output',
      isProcessing: true,
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);
    const event = (id: string, statePatch: Record<string, unknown>) => ({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-live-bash-output',
        event: {
          id,
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-live-bash-output',
            part: {
              id: 'prt-live-bash-output',
              type: 'tool',
              tool: 'bash',
              callID: 'call-live-bash-output',
              messageID: 'msg-live-bash-output',
              state: statePatch,
            },
          },
        },
      },
    });

    handler(event('evt-bash-pending', { status: 'pending', input: {} }) as never);
    handler(event('evt-bash-running', {
      status: 'running',
      input: { command: 'docker ps' },
      metadata: { output: 'daemon unavailable' },
    }) as never);

    const step = state.streaming?.steps.find(
      (candidate) => candidate.callID === 'call-live-bash-output',
    );
    assert.strictEqual(step?.activityDetail?.command, 'docker ps');
    assert.strictEqual(step?.activityDetail?.output, 'daemon unavailable');
  });
});

describe('createMessageHandler - live permissions', () => {
  it('mounts a permission.asked event even when the agent is paused', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-permission',
      isProcessing: false,
      streaming: {
        messageId: 'msg-permission-owner',
        content: '',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        interactiveEvents: [],
        isActive: true,
      },
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-permission',
        event: {
          id: 'evt-permission',
          type: 'permission.asked',
          properties: {
            id: 'per-permission',
            sessionID: 'ses-permission',
            permission: 'read',
            patterns: ['apps/backend/.env'],
            always: ['*'],
          },
        },
      },
    } as never);

    assert.equal(state.messages.some((message) => message.id === 'permission-per-permission'), false);
    assert.deepEqual(state.interactiveEvents, [{
      type: 'quick_actions',
      id: 'permission-request-per-permission',
      title: 'Allow read?',
      uiCategory: 'quick_input',
      contextMessage: 'OpenCode requests **read** access to:\n\n`apps/backend/.env`',
      permissionID: 'per-permission',
      sessionID: 'ses-permission',
      permissionPatterns: ['apps/backend/.env'],
      permissionName: 'read',
      actions: [
        { id: 'once', label: 'Allow', value: 'once', recommended: true },
        { id: 'always', label: 'Always allow', value: 'always' },
        { id: 'reject', label: 'Reject', value: 'reject' },
      ],
    }]);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-permission',
        event: {
          type: 'permission.replied',
          properties: { sessionID: 'ses-permission', requestID: 'per-permission', reply: 'reject' },
        },
      },
    } as never);
    assert.deepEqual(state.interactiveEvents, []);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-permission',
        event: {
          type: 'permission.asked',
          properties: {
            id: 'per-permission-next',
            sessionID: 'ses-permission',
            permission: 'read',
            patterns: ['apps/backend/.env'],
            always: ['*'],
          },
        },
      },
    } as never);
    assert.equal(state.interactiveEvents[0]?.id, 'permission-request-per-permission-next');
  });
});

describe('createMessageHandler - adapted live text deltas', () => {
  it('renders SDK-adapter text deltas as assistant content before hydration', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-live-text',
      isProcessing: true,
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);

    handler({
      data: {
        type: 'streamEventBatch',
        events: [
          {
            sessionId: 'ses-live-text',
            event: {
              // MessageStreamService normalizes message.part.delta to this
              // compatible part-update shape while preserving field + delta.
              type: 'message.part.updated',
              properties: {
                sessionID: 'ses-live-text',
                messageID: 'msg-live-text',
                partID: 'prt-live-text',
                field: 'text',
                delta: 'Hello',
                part: {
                  id: 'prt-live-text',
                  type: 'text',
                  messageID: 'msg-live-text',
                },
              },
            },
          },
        ],
      },
    } as never);

    assert.strictEqual(state.streaming?.messageId, 'msg-live-text');
    assert.strictEqual(state.streaming?.content, 'Hello');
    assert.strictEqual(state.streaming?.reasoning, '');
    assert.strictEqual(state.streaming?.hasRenderableContent, true);
  });

  it('preserves every text delta from the initial React-style batched dispatch', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-batched-text',
      isProcessing: true,
    };
    const queuedActions: Parameters<typeof appReducer>[1][] = [];
    // Model React's event callback semantics: dispatch queues reducer work,
    // while getState keeps returning the last committed snapshot until the
    // callback has finished.
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      queuedActions.push(action);
    };
    const handler = createMessageHandler(dispatch, () => state);
    const deltaEvent = (delta: string) => ({
      sessionId: 'ses-batched-text',
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-batched-text',
          messageID: 'msg-batched-text',
          partID: 'prt-batched-text',
          field: 'text',
          delta,
          part: {
            id: 'prt-batched-text',
            type: 'text',
            messageID: 'msg-batched-text',
            text: delta,
            delta,
          },
        },
      },
    });

    handler({
      data: {
        type: 'streamEventBatch',
        events: [deltaEvent('Hello'), deltaEvent(' world')],
      },
    } as never);
    for (const action of queuedActions) {
      state = appReducer(state, action);
    }

    assert.strictEqual(state.streaming?.content, 'Hello world');
    assert.strictEqual(state.streaming?.hasRenderableContent, true);
  });

  it('keeps normal assistant text visible when the same assistant turn starts a tool', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-tool-prelude',
      isProcessing: true,
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);
    const messageID = 'msg-tool-prelude';
    const preludePartID = 'prt-tool-prelude';

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-tool-prelude',
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-tool-prelude',
            messageID,
            partID: preludePartID,
            field: 'text',
            delta: 'Now',
            part: {
              id: preludePartID,
              type: 'text',
              messageID,
              text: 'Now',
              delta: 'Now',
            },
          },
        },
      },
    } as never);
    assert.strictEqual(state.streaming?.content, 'Now');

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-tool-prelude',
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-tool-prelude',
            messageID,
            part: {
              id: 'prt-tool-call',
              type: 'tool',
              tool: 'read',
              callID: 'call-tool-prelude',
              messageID,
              state: { status: 'pending', input: {} },
            },
          },
        },
      },
    } as never);
    assert.strictEqual(state.streaming?.content, 'Now');
    assert.strictEqual(state.streaming?.hasRenderableContent, true);

    handler({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-tool-prelude',
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-tool-prelude',
            messageID,
            part: {
              id: preludePartID,
              type: 'text',
              messageID,
              text: 'Now let me inspect the files.',
            },
          },
        },
      },
    } as never);
    assert.strictEqual(state.streaming?.content, 'Now let me inspect the files.');
  });

  it('does not suppress a direct-event text part merely because a tool follows it', () => {
    const state: AppState = {
      ...initialState,
      currentSessionId: 'ses-stale-tool-prelude',
      isProcessing: true,
    };
    const queuedActions: Parameters<typeof appReducer>[1][] = [];
    // Individual native messages can arrive in the same JS turn. Model
    // useReducer's deferred commit: the tool must still identify the prior
    // text part even though getState has not observed it yet.
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      queuedActions.push(action);
    };
    const handler = createMessageHandler(dispatch, () => state);
    const messageID = 'msg-stale-tool-prelude';
    const preludePartID = 'prt-stale-tool-prelude';
    const streamEvent = (part: Record<string, unknown>, extras: Record<string, unknown> = {}) => ({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-stale-tool-prelude',
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-stale-tool-prelude',
            messageID,
            partID: part.id,
            part,
            ...extras,
          },
        },
      },
    });

    handler(streamEvent({
      id: preludePartID,
      type: 'text',
      messageID,
      text: 'Same',
      delta: 'Same',
    }, { field: 'text', delta: 'Same' }) as never);
    handler(streamEvent({
      id: 'prt-stale-tool-call',
      type: 'tool',
      tool: 'bash',
      callID: 'call-stale-tool-prelude',
      messageID,
      state: { status: 'pending', input: {} },
    }) as never);

    assert.ok(!queuedActions.some((action) =>
      action.type === 'SUPPRESS_STREAMING_TEXT_PART' &&
      action.payload.partID === preludePartID,
    ));
  });

  it('keeps normal text renderable across a batched tool lifecycle', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-batched-tool-prelude',
      isProcessing: true,
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);
    const messageID = 'msg-batched-tool-prelude';
    const preludePartID = 'prt-batched-tool-prelude';
    const event = (part: Record<string, unknown>, extras: Record<string, unknown> = {}) => ({
      sessionId: 'ses-batched-tool-prelude',
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-batched-tool-prelude',
          messageID,
          partID: part.id,
          part,
          ...extras,
        },
      },
    });

    handler({
      data: {
        type: 'streamEventBatch',
        events: [
          event(
            {
              id: preludePartID,
              type: 'text',
              messageID,
              text: 'Now',
              delta: 'Now',
            },
            { field: 'text', delta: 'Now' },
          ),
          event({
            id: 'prt-batched-tool',
            type: 'tool',
            tool: 'read',
            callID: 'call-batched-tool-prelude',
            messageID,
            state: { status: 'pending', input: {} },
          }),
          // The server can repeat the same text part after tool activity.
          // It remains valid assistant text and must stay visible.
          event({
            id: preludePartID,
            type: 'text',
            messageID,
            text: 'Now let me inspect the files.',
          }),
          // A new part after tool activity is the actual response and must
          // remain renderable; suppression never applies across part IDs.
          event(
            {
              id: 'prt-batched-final-answer',
              type: 'text',
              messageID,
              text: 'The login flow is connected end to end.',
              delta: 'The login flow is connected end to end.',
            },
            {
              field: 'text',
              delta: 'The login flow is connected end to end.',
            },
          ),
        ],
      },
    } as never);

    assert.deepEqual(state.streaming?.suppressedTextPartIDs ?? [], []);
    assert.strictEqual(
      state.streaming?.content,
      'The login flow is connected end to end.',
    );
    assert.strictEqual(state.streaming?.hasRenderableContent, true);
    assert.strictEqual(
      state.streaming?.lastRenderableTextPartID,
      'prt-batched-final-answer',
    );
  });

  it('keeps adapted field=text deltas on their active reasoning part', () => {
    let state: AppState = {
      ...initialState,
      currentSessionId: 'ses-reasoning-text',
      isProcessing: true,
    };
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      state = appReducer(state, action);
    };
    const handler = createMessageHandler(dispatch, () => state);
    const streamEvent = (part: Record<string, unknown>, extra = {}) => ({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-reasoning-text',
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-reasoning-text',
            messageID: 'msg-reasoning-text',
            partID: part.id,
            part,
            ...extra,
          },
        },
      },
    });

    handler(streamEvent({
      id: 'prt-reasoning-text',
      type: 'reasoning',
      messageID: 'msg-reasoning-text',
      text: 'Inspecting',
    }) as never);
    handler(streamEvent({
      id: 'prt-reasoning-text',
      type: 'text',
      messageID: 'msg-reasoning-text',
      text: ' the code',
      delta: ' the code',
    }, {
      field: 'text',
      delta: ' the code',
    }) as never);

    assert.strictEqual(state.streaming?.content, '');
    assert.match(state.streaming?.reasoning ?? '', /Inspecting[\s\S]*the code/);
    assert.strictEqual(
      state.streaming?.activeReasoningPartID,
      'prt-reasoning-text',
    );

    handler(streamEvent({
      id: 'prt-response-text',
      type: 'text',
      messageID: 'msg-reasoning-text',
      text: 'Final answer',
      delta: 'Final answer',
    }, {
      field: 'text',
      delta: 'Final answer',
    }) as never);

    assert.strictEqual(state.streaming?.content, 'Final answer');
    assert.strictEqual(state.streaming?.inReasoningPart, false);
    assert.strictEqual(state.streaming?.activeReasoningPartID, undefined);
  });

  it('keeps reasoning text deltas out of the response before React commits the prior frame', () => {
    const state: AppState = {
      ...initialState,
      currentSessionId: 'ses-stale-reasoning',
      isProcessing: true,
    };
    const actions: Parameters<typeof appReducer>[1][] = [];
    // Native webview messages can arrive back-to-back before React has
    // committed the reducer state from the preceding reasoning-start frame.
    // Deliberately keep getState stale to cover that timing boundary.
    const dispatch = (action: Parameters<typeof appReducer>[1]) => {
      actions.push(action);
    };
    const handler = createMessageHandler(dispatch, () => state);
    const partEvent = (part: Record<string, unknown>, extra = {}) => ({
      data: {
        type: 'streamEvent',
        sessionId: 'ses-stale-reasoning',
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-stale-reasoning',
            messageID: 'msg-stale-reasoning',
            partID: part.id,
            part,
            ...extra,
          },
        },
      },
    });

    handler(partEvent({
      id: 'prt-stale-reasoning',
      type: 'reasoning',
      messageID: 'msg-stale-reasoning',
      text: '',
    }) as never);
    handler(partEvent({
      id: 'prt-stale-reasoning',
      type: 'text',
      messageID: 'msg-stale-reasoning',
      text: 'Interesting',
      delta: 'Interesting',
    }, {
      field: 'text',
      delta: 'Interesting',
    }) as never);

    assert.ok(actions.some((action) =>
      action.type === 'UPDATE_STREAMING_REASONING' &&
      action.payload.reasoning === 'Interesting',
    ));
    assert.ok(!actions.some((action) =>
      action.type === 'UPDATE_STREAMING_CONTENT' &&
      action.payload.content === 'Interesting',
    ));
  });
});

describe('coalesceAdjacentAssistantHistoryMessages - rawSdkEventPayloads ordering', () => {
  it('preserves raw event order when assistant bursts are coalesced', () => {
    const result = coalesceAdjacentAssistantHistoryMessages([
      {
        role: 'assistant',
        id: 'msg-1',
        rawSdkEventPayloads: [
          { id: 'evt-1', type: 'message.part.updated', properties: { time: 1 } },
        ],
        parts: [{ type: 'text', text: 'first' }],
      } as Message,
      {
        role: 'assistant',
        id: 'msg-1',
        rawSdkEventPayloads: [
          { id: 'evt-2', type: 'message.part.updated', properties: { time: 2 } },
        ],
        parts: [{ type: 'text', text: 'first again' }],
      } as Message,
    ]);

    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(
      (result[0]?.rawSdkEventPayloads ?? []).map(
        (event) => (event as Record<string, unknown>).id,
      ),
      ['evt-1', 'evt-2'],
    );
  });

  it('does not coalesce assistant turns that belong to different user parents', () => {
    const result = coalesceAdjacentAssistantHistoryMessages([
      {
        role: 'assistant',
        id: 'assistant-1',
        info: { id: 'assistant-1', role: 'assistant', parentID: 'user-1' } as Message['info'],
        parts: [{ type: 'reasoning', reasoning: 'Reasoning for the first user.' }],
        content: 'First assistant response',
      } as Message,
      {
        role: 'assistant',
        id: 'assistant-2',
        info: { id: 'assistant-2', role: 'assistant', parentID: 'user-2' } as Message['info'],
        parts: [{ type: 'reasoning', reasoning: 'Reasoning for the second user.' }],
        content: 'Second assistant response',
      } as Message,
    ]);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]?.content, 'First assistant response');
    assert.strictEqual(result[1]?.content, 'Second assistant response');
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

  it('should preserve canonical final content while backfilling structuredOutput from streaming state', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Canonical final content',
    };

    const streaming = {
      messageId: 'test-msg-1',
      content: 'Streaming draft that should not replace the final assistant reply',
      reasoning: '',
      reasoningEvents: [],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: false,
      modelID: 'test-model',
      providerID: 'test-provider',
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

    const result = normalizeMessage(inputMessage, streaming);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'Canonical final content',
      'should keep the canonical finalized assistant content'
    );
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should still be preserved when backfilled from streaming'
    );
  });

  it('should render the final assistant message from the centralized StructuredOutput tool part', () => {
    const inputMessage: Message = {
      id: 'msg-final-centralized-response',
      role: 'assistant',
      rawSdkEventPayloads: [
        {
          id: 'evt-final-1',
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-test',
            part: {
              type: 'tool',
              tool: 'StructuredOutput',
              callID: 'call-test',
              state: {
                status: 'completed',
                input: {
                  responseType: 'message',
                  message: 'Hey! What can I help you with today?',
                },
                output: 'Structured output captured successfully.',
                metadata: {
                  valid: true,
                },
                title: 'Structured Output',
                time: {
                  start: 1781621629855,
                  end: 1781621629884,
                },
              },
              id: 'prt-final-1',
              sessionID: 'ses-test',
              messageID: 'msg-final-centralized-response',
            },
          },
          source: '/event',
          sessionId: 'ses-test',
        },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'Hey! What can I help you with today?',
      'the assistant body should come from the centralized StructuredOutput tool payload',
    );

    const normalizedRecord = result as Record<string, unknown>;
    const structuredOutput = normalizedRecord.structuredOutput as Record<string, unknown> | undefined;
    assert.ok(structuredOutput, 'structuredOutput should be reconstructed from centralized data');
    assert.strictEqual(
      structuredOutput?.responseType,
      'message',
      'structuredOutput.responseType should stay message-like',
    );
    assert.strictEqual(
      structuredOutput?.message,
      'Hey! What can I help you with today?',
      'structuredOutput.message should come from the centralized tool input',
    );
  });

  it('should rehydrate structured output from centralized properties.info payloads', () => {
    const rawSdkEventPayloads = [
      {
        payload: {
          type: 'message.updated',
          properties: {
            sessionID: 'ses-test',
            info: {
              id: 'msg-final-info-structured',
              role: 'assistant',
              structuredOutput: {
                responseType: 'message',
                message: 'Hey there from rehydrated structured output.',
              },
            },
          },
        },
      },
    ];

    const structuredOutput = structuredOutputFromRawSdkEventPayloads(rawSdkEventPayloads);
    assert.ok(structuredOutput, 'structured output should be recovered from payload.properties.info');
    assert.strictEqual(structuredOutput?.responseType, 'message');
    assert.strictEqual(structuredOutput?.message, 'Hey there from rehydrated structured output.');

    const result = normalizeMessage(
      {
        id: 'msg-final-info-structured',
        role: 'assistant',
        rawSdkEventPayloads,
      } as Message,
      null,
    );

    assert.ok(result, 'normalizeMessage should still produce an assistant message');
    assert.strictEqual(
      result?.content,
      'Hey there from rehydrated structured output.',
      'assistant content should be rebuilt from the persisted structured output payload',
    );
  });

  it('should rehydrate structured text from centralized properties.info payloads', () => {
    const rawSdkEventPayloads = [
      {
        payload: {
          type: 'message.updated',
          properties: {
            sessionID: 'ses-test',
            info: {
              id: 'msg-final-info-structured-text',
              role: 'assistant',
              structured: {
                type: 'message',
                text: '# Dayo (tuklasia) - Codebase Summary',
              },
            },
          },
        },
      },
    ];

    const structuredOutput = structuredOutputFromRawSdkEventPayloads(rawSdkEventPayloads);
    assert.ok(structuredOutput, 'structured output should be recovered from payload.properties.info.structured');
    assert.strictEqual(structuredOutput?.responseType, 'message');
    assert.strictEqual(structuredOutput?.text, '# Dayo (tuklasia) - Codebase Summary');

    const result = normalizeMessage(
      {
        id: 'msg-final-info-structured-text',
        role: 'assistant',
        rawSdkEventPayloads,
      } as Message,
      null,
    );

    assert.ok(result, 'normalizeMessage should still produce an assistant message');
    assert.strictEqual(
      result?.content,
      '# Dayo (tuklasia) - Codebase Summary',
      'assistant content should be rebuilt from info.structured.text when centralized data lacks a plain message field',
    );
    assert.deepStrictEqual(
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads(rawSdkEventPayloads),
      ['# Dayo (tuklasia) - Codebase Summary'],
      'assistant content chunks should fall back to info.structured.text for the latest assistant turn',
    );
    assert.strictEqual(
      getFinalAssistantResponseTextFromRawSdkEventPayloads(rawSdkEventPayloads),
      '# Dayo (tuklasia) - Codebase Summary',
      'raw centralized payload helpers should surface info.structured.text as the final assistant body',
    );
  });

  it('should read structured text from rawResponse info payloads', () => {
    const rawResponse = {
      info: {
        id: 'msg-raw-structured-text',
        role: 'assistant',
        structured: {
          type: 'message',
          text: 'Centralized structured text fallback',
        },
      },
    };

    assert.strictEqual(
      getFinalAssistantResponseText(rawResponse),
      'Centralized structured text fallback',
      'rawResponse fallback should read info.structured.text in addition to message/content',
    );
  });

  it('should extract the final assistant response text directly from centralized raw SDK payloads', () => {
    const rawSdkEventPayloads = [
      {
        id: 'evt-final-1',
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          part: {
            type: 'tool',
            tool: 'StructuredOutput',
            callID: 'call-test',
            state: {
              status: 'completed',
              input: {
                responseType: 'message',
                message: 'Hey! What can I help you with today?',
              },
              output: 'Structured output captured successfully.',
              metadata: {
                valid: true,
              },
              title: 'Structured Output',
              time: {
                start: 1781621629855,
                end: 1781621629884,
              },
            },
            id: 'prt-final-1',
            sessionID: 'ses-test',
            messageID: 'msg-final-centralized-response',
          },
        },
        source: '/event',
        sessionId: 'ses-test',
      },
    ];

    assert.strictEqual(
      getFinalAssistantResponseTextFromRawSdkEventPayloads(rawSdkEventPayloads),
      'Hey! What can I help you with today?',
      'the raw centralized payload helper should surface the final assistant body',
    );
  });

  it('should not fall back to reasoning-like text parts when no structured assistant message exists', () => {
    const rawSdkEventPayloads = [
      {
        id: 'evt-reasoning-1',
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          part: {
            type: 'reasoning',
            text: 'The user just said "hey" - a casual greeting. I should respond concisely and offer help.',
            messageID: 'msg-reasoning-only',
            sessionID: 'ses-test',
            id: 'prt-reasoning-1',
          },
        },
        source: '/event',
        sessionId: 'ses-test',
      },
      {
        id: 'evt-reasoning-2',
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          part: {
            type: 'step-finish',
            messageID: 'msg-reasoning-only',
            sessionID: 'ses-test',
            id: 'prt-reasoning-2',
          },
        },
        source: '/event',
        sessionId: 'ses-test',
      },
    ];

    assert.strictEqual(
      getFinalAssistantResponseTextFromRawSdkEventPayloads(rawSdkEventPayloads),
      '',
      'reasoning or step-finish text should not be promoted into the assistant response body',
    );
  });

  it('does not promote delta-bearing text parts into the assistant response body', () => {
    const rawSdkEventPayloads = [
      {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          messageID: 'msg-delta-only',
          partID: 'prt-delta-only',
          field: 'text',
          delta: 'investigate',
          part: {
            id: 'prt-delta-only',
            sessionID: 'ses-test',
            messageID: 'msg-delta-only',
            type: 'text',
            text: 'investigate',
            delta: 'investigate',
          },
        },
      },
      {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          messageID: 'msg-delta-only',
          partID: 'prt-delta-only',
          field: 'text',
          delta: 'setup',
          part: {
            id: 'prt-delta-only',
            sessionID: 'ses-test',
            messageID: 'msg-delta-only',
            type: 'text',
            text: 'setup',
            delta: 'setup',
          },
        },
      },
    ];

    assert.deepStrictEqual(
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads(rawSdkEventPayloads),
      [],
    );
  });

  it('routes a text-field delta through reasoning until its non-delta text snapshot arrives', () => {
    const source = readFileSync(
      new URL('./messageHandler.ts', import.meta.url),
      'utf8',
    );

    assert.match(
      source,
      /const isReasoning =[\s\S]*?isRawDeltaTextField/s,
      'text-field deltas must enter the reasoning lane',
    );
    assert.match(
      source,
      /const isDeltaForActiveReasoningPart = Boolean\([\s\S]*?rawUpdatedDelta\.trim\(\)\.length > 0/s,
      'a non-delta snapshot must be allowed to leave the active reasoning lane',
    );
    assert.match(
      source,
      /if \(isReasoning && reasoningPartID && !isRawDeltaTextField\)/,
      'a generic text delta must not suppress the later non-delta response snapshot for its part',
    );
  });

  it('should extract sync-backed AI response text and classify it as an AI response event', () => {
    const syncPayload = {
      type: 'sync',
      syncEvent: {
        type: 'message.part.updated.1',
        id: 'evt-sync-response',
        seq: 0,
        aggregateID: 'ses-test',
        data: {
          sessionID: 'ses-test',
          part: {
            id: 'prt-sync-response',
            messageID: 'msg-sync-response',
            sessionID: 'ses-test',
            type: 'text',
            text: 'I have a thorough picture. Let me collect the background agents\' findings to incorporate any additional detail.',
            time: {
              start: 1781707448968,
              end: 1781707448987,
            },
          },
          time: 1781707448987,
        },
      },
      id: 'evt-sync-response',
      source: '/global/event',
      sessionId: 'ses-test',
    };

    assert.strictEqual(isAiResponseEvent(syncPayload), true);
    assert.strictEqual(
      getFinalAssistantResponseTextFromRawSdkEventPayloads([syncPayload]),
      'I have a thorough picture. Let me collect the background agents\' findings to incorporate any additional detail.',
    );
  });

  it('should classify wrapped payload.syncEvent text parts as AI response events', () => {
    const payload = {
      directory: '/Users/christian/Projects/jobfinder-bot',
      project: '8591477d95f25cab098bd660b729730c1af8173f',
      payload: {
        type: 'sync',
        syncEvent: {
          type: 'message.part.updated.1',
          id: 'evt-ed609ab09001zagHGrjbLN3WzD',
          seq: 0,
          aggregateID: 'ses-129f784e0ffeFWPpZ4BLGo0te0',
          data: {
            sessionID: 'ses-129f784e0ffeFWPpZ4BLGo0te0',
            part: {
              id: 'prt-ed609aaec001y1J3pEatSpK0Mg',
              messageID: 'msg-ed60974ab001TQfBxGnPSZXjC7',
              sessionID: 'ses-129f784e0ffeFWPpZ4BLGo0te0',
              type: 'text',
              text: '3 background agents launched. Let me read the key files directly while they work.',
              time: {
                start: 1781707418348,
                end: 1781707418377,
              },
            },
            time: 1781707418377,
          },
        },
        id: 'evt-ed609ab09001zagHGrjbLN3WzD',
      },
      sessionId: 'ses-129f784e0ffeFWPpZ4BLGo0te0',
    };

    assert.strictEqual(isAiResponseEvent(payload), true);
    assert.strictEqual(
      getFinalAssistantResponseTextFromRawSdkEventPayloads([payload]),
      '3 background agents launched. Let me read the key files directly while they work.',
    );
  });

  it('should return the longest final assistant text snapshot for the latest message', () => {
    const shortPayload = {
      payload: {
        type: 'sync',
        syncEvent: {
          data: {
            part: {
              messageID: 'msg-long-response',
              type: 'text',
              text: 'I have a complete picture.',
            },
          },
        },
      },
    };
    const longPayload = {
      payload: {
        type: 'sync',
        syncEvent: {
          data: {
            part: {
              messageID: 'msg-long-response',
              type: 'text',
              text: 'I have a complete picture. Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
            },
          },
        },
      },
    };

    assert.strictEqual(
      getFinalAssistantResponseTextFromRawSdkEventPayloads([shortPayload, longPayload]),
      'I have a complete picture. Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
    );
  });

  it('should concatenate sequential text chunks for the latest assistant message', () => {
    const firstChunk = {
      payload: {
        type: 'sync',
        syncEvent: {
          data: {
            part: {
              messageID: 'msg-chunked-response',
              type: 'text',
              text: 'I have a complete picture. ',
            },
          },
        },
      },
    };
    const secondChunk = {
      payload: {
        type: 'sync',
        syncEvent: {
          data: {
            part: {
              messageID: 'msg-chunked-response',
              type: 'text',
              text: 'Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
            },
          },
        },
      },
    };

    assert.strictEqual(
      getFinalAssistantResponseTextFromRawSdkEventPayloads([firstChunk, secondChunk]),
      'I have a complete picture. Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
    );
  });

  it('should keep assistant content extraction open after the first completion marker for the same turn', () => {
    const rawSdkEventPayloads = [
      {
        id: 'evt-before-finish',
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          part: {
            id: 'prt-before-finish',
            messageID: 'msg-final-turn',
            sessionID: 'ses-test',
            type: 'text',
            text: 'I have a complete picture.',
          },
        },
      },
      {
        id: 'evt-step-finish',
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          part: {
            id: 'prt-step-finish',
            messageID: 'msg-final-turn',
            sessionID: 'ses-test',
            type: 'step-finish',
          },
        },
      },
      {
        id: 'evt-after-finish',
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          part: {
            id: 'prt-after-finish',
            messageID: 'msg-final-turn',
            sessionID: 'ses-test',
            type: 'text',
            text: 'Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
          },
        },
      },
    ];

    assert.strictEqual(
      getCentralizedAssistantTurnCompletionIndex(rawSdkEventPayloads),
      1,
      'the first terminal marker should define the response boundary',
    );
    assert.deepStrictEqual(
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads(rawSdkEventPayloads),
      [
        'I have a complete picture.',
        'Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
      ],
      'content extraction should keep the full assistant body even after the completion marker so later assistant text still renders',
    );
  });

  it('should still extract sync-backed assistant text when no explicit completion marker exists', () => {
    const syncPayload = {
      type: 'sync',
      syncEvent: {
        type: 'message.part.updated.1',
        id: 'evt-sync-response',
        seq: 0,
        aggregateID: 'ses-test',
        data: {
          sessionID: 'ses-test',
          part: {
            id: 'prt-sync-response',
            messageID: 'msg-sync-response',
            sessionID: 'ses-test',
            type: 'text',
            text: 'I have a thorough picture. Let me collect the background agents\' findings to incorporate any additional detail.',
            time: {
              start: 1781707448968,
              end: 1781707448987,
            },
          },
          time: 1781707448987,
        },
      },
      id: 'evt-sync-response',
      source: '/global/event',
      sessionId: 'ses-test',
    };

    assert.deepStrictEqual(
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads([syncPayload]),
      ['I have a thorough picture. Let me collect the background agents\' findings to incorporate any additional detail.'],
      'sync-only payloads should still produce the assistant body',
    );
  });

  it('should keep centralized assistant text as ordered chunks instead of merging them', () => {
    const rawSdkEventPayloads = [
      {
        payload: {
          type: 'sync',
          syncEvent: {
            data: {
              part: {
                type: 'text',
                text: 'I have a complete picture. ',
              },
            },
          },
        },
      },
      {
        payload: {
          type: 'sync',
          syncEvent: {
            data: {
              part: {
                type: 'text',
                text: 'Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
              },
            },
          },
        },
      },
    ];

    assert.deepStrictEqual(
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads(rawSdkEventPayloads),
      [
        'I have a complete picture.',
        'Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
      ],
    );
  });

  it('should prefer raw assistant text chunks over a shorter structured output message', () => {
    const textChunk = {
      payload: {
        type: 'sync',
        syncEvent: {
          data: {
            part: {
              messageID: 'msg-structured-preferred',
              type: 'text',
              text: 'I have a complete picture. Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
            },
          },
        },
      },
    };
    const structuredPayload = {
      payload: {
        type: 'sync',
        syncEvent: {
          data: {
            part: {
              type: 'tool',
              tool: 'StructuredOutput',
              state: {
                input: {
                  responseType: 'message',
                  message: '## JobFinder Bot — Codebase Summary\n\nA **Python job-scraping & auto-apply automation tool** with a desktop GUI.',
                },
              },
            },
          },
        },
      },
    };

    assert.strictEqual(
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads([textChunk, structuredPayload]),
      [
        'I have a complete picture. Let me cancel the still-running background agents since I\'ve gathered everything needed, then deliver the summary.',
      ],
    );
  });

  it('should prefer the completed structured output message over an overlapping raw text echo for the same assistant turn', () => {
    const rawSdkEventPayloads = [
      {
        id: 'evt-overlap-text',
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          part: {
            id: 'prt-overlap-text',
            messageID: 'msg-overlap-turn',
            sessionID: 'ses-test',
            type: 'text',
            text: 'Hey! What can I help you with?',
          },
        },
      },
      {
        id: 'evt-overlap-structured',
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses-test',
          part: {
            id: 'prt-overlap-structured',
            messageID: 'msg-overlap-turn',
            sessionID: 'ses-test',
            type: 'tool',
            tool: 'StructuredOutput',
            state: {
              status: 'completed',
              input: {
                responseType: 'message',
                message: 'Hey! What can I help you with today?',
              },
            },
          },
        },
      },
    ];

    assert.deepStrictEqual(
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads(rawSdkEventPayloads),
      ['Hey! What can I help you with today?'],
      'the final structured response should suppress the overlapping raw text echo',
    );
  });

  it('should prefer the canonical structured payload over conflicting structuredOutput reasoning payload', () => {
    const inputMessage = {
      id: 'msg-canonical-structured',
      role: 'assistant',
      content: '**Preparing for MCQ response**\n\nI see see that I that I need need to respond...',
      structured: {
        responseType: 'question',
        question: {
          type: 'question',
          question: 'Which kind of questions would you like?',
          displayPrompt: 'Which kind of questions would you like?',
          options: [
            { id: 'fun', label: 'Fun', value: 'Fun' },
            { id: 'trivia', label: 'Trivia', value: 'Trivia' },
          ],
        },
      },
      structuredOutput: {
        responseType: 'message',
        message: '**Preparing for MCQ response**\n\nI see see that I that I need need to respond...',
      },
    } as Message & {
      structured?: {
        responseType?: string;
        question?: {
          type?: string;
          question?: string;
          displayPrompt?: string;
          options?: Array<{ id?: string; label: string; value?: string }>;
        };
      };
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    const normalizedRecord = result as Record<string, unknown>;
    const normalizedStructured = normalizedRecord.structuredOutput as Record<string, unknown> | undefined;
    assert.ok(normalizedStructured, 'normalized structuredOutput should exist');
    assert.strictEqual(
      normalizedStructured?.responseType,
      'question',
      'canonical structured payload should win over conflicting structuredOutput',
    );
    assert.ok(
      normalizedStructured?.question && typeof normalizedStructured.question === 'object',
      'canonical question payload should be preserved',
    );
    assert.strictEqual(
      (normalizedStructured?.question as Record<string, unknown>).question,
      'Which kind of questions would you like?',
      'canonical question text should be preserved',
    );
  });

  it('should keep the canonical question turn when coalescing an adjacent reasoning follow-up', () => {
    const questionTurn: Message = normalizeMessage(
      {
        id: 'msg-question-turn',
        role: 'assistant',
        structuredOutput: {
          responseType: 'question',
          question: {
            question: 'If you could instantly master one skill, which would you choose?',
            displayPrompt: 'If you could instantly master one skill, which would you choose?',
            options: [
              { id: 'instrument', label: 'Play Any Instrument', value: 'Play Any Instrument' },
              { id: 'language', label: 'Speak Every Language', value: 'Speak Every Language' },
            ],
          },
        },
        parts: [
          {
            type: 'text',
            text: 'If you could instantly master one skill, which would you choose?',
          },
        ],
      } as Message,
      null,
    ) as Message;

    const reasoningFollowUp: Message = normalizeMessage(
      {
        id: 'evt-reasoning-follow-up',
        role: 'assistant',
        content:
          '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call.',
        structuredOutput: {
          responseType: 'message',
          message:
            '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call.',
        },
        reasoningEvents: [
          {
            text:
              '**Preparing for MCQ response**\n\nI see that I need to respond quickly with a tool call.',
            createdAt: 1780640073646,
          },
        ],
      } as Message,
      null,
    ) as Message;

    const result = coalesceAdjacentAssistantHistoryMessages([
      questionTurn,
      reasoningFollowUp,
    ]);

    assert.strictEqual(result.length, 1, 'adjacent assistant burst should collapse into one message');
    assert.strictEqual(
      result[0]?.content,
      'If you could instantly master one skill, which would you choose?',
      'the canonical question turn should win over the reasoning follow-up',
    );
    assert.strictEqual(
      result[0]?.responseType,
      'question',
      'the coalesced message should remain a question turn',
    );
  });

  it('should keep the exact MCQ question turn instead of the following reasoning-only assistant burst', () => {
    const questionTurn: Message = normalizeMessage(
      {
        id: 'msg_e9669f5b6001F5iwvqqDX5Xm7x',
        role: 'assistant',
        agent: 'build',
        modelID: 'gpt-5.4',
        providerID: 'openai',
        time: {
          created: 1780639987126,
          completed: 1780640002793,
        },
        finish: 'tool-calls',
        structuredOutput: {
          responseType: 'question',
          question: {
            question: "Pick a question category, and I’ll ask you multiple-choice questions in that style.",
            displayPrompt: "Pick a question category, and I’ll ask you multiple-choice questions in that style.",
            type: 'question',
            options: [
              { label: 'Fun', value: 'Ask me fun multiple-choice questions.' },
              { label: 'Personality', value: 'Ask me personality multiple-choice questions.' },
              { label: 'Would You Rather', value: 'Ask me would-you-rather questions with choices.' },
              { label: 'Trivia', value: 'Ask me trivia questions with choices.' },
            ],
          },
        },
        parts: [
          {
            snapshot: '7ab719279a4d68707a87366c6806e0286950572c',
            type: 'text',
            id: 'prt_e966a02950012RY7xjRWYugNb5',
            sessionID: 'ses_16996583dffed6VXEMFd7eaZh9',
            messageID: 'msg_e9669f5b6001F5iwvqqDX5Xm7x',
            text: "Pick a question category, and I’ll ask you multiple-choice questions in that style.",
          },
        ],
      } as Message,
      null,
    ) as Message;

    const reasoningFollowUp: Message = normalizeMessage(
      {
        id: 'evt_e966b3956001Zh5RZ6n47GoiBd',
        role: 'assistant',
        content:
          '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call. Since with a tool call. Since the the user has user has responded to responded to my previous my previous question question,it, it seems likely seems likely they\'ll they\'ll continue continue with with fun fun multiple multiple-choice-choice questions questions..I I think think I I’ll’ll employ employ Structured Structured Output Output once once again again to to format format the question properly the question properly..This This way way,,I I can can make make sure my sure my answer answer is is clear clear and and engaging engaging for for the the user user!Let\'s! Let\'s get get going going with with that that!!',
        parts: [
          {
            type: 'text',
            text:
              '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call. Since with a tool call. Since the the user has user has responded to responded to my previous my previous question question,it, it seems likely seems likely they\'ll they\'ll continue continue with with fun fun multiple multiple-choice-choice questions questions..I I think think I I’ll’ll employ employ Structured Structured Output Output once once again again to to format format the question properly the question properly..This This way way,,I I can can make make sure my sure my answer answer is is clear clear and and engaging engaging for for the the user user!Let\'s! Let\'s get get going going with with that that!!',
          },
        ],
        reasoningEvents: [
          {
            text:
              '**Preparing for MCQ response**\n\nI see that I need to respond quickly with a tool call. Since the user has responded to my previous question, it seems likely they\'ll continue with fun multiple-choice questions. I think I’ll employ StructuredOutput once again to format the question properly. This way, I can make sure my answer is clear and engaging for the user! Let\'s get going with that!',
            createdAt: 1780640073646,
          },
        ],
        structuredOutput: {
          responseType: 'message',
          message:
            '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call. Since with a tool call. Since the the user has user has responded to responded to my previous my previous question question,it, it seems likely seems likely they\'ll they\'ll continue continue with with fun fun multiple multiple-choice-choice questions questions..I I think think I I’ll’ll employ employ Structured Structured Output Output once once again again to to format format the question properly the question properly..This This way way,,I I can can make make sure my sure my answer answer is is clear clear and and engaging engaging for for the the user user!Let\'s! Let\'s get get going going with with that that!!',
        },
      } as Message,
      null,
    ) as Message;

    const result = coalesceAdjacentAssistantHistoryMessages([
      questionTurn,
      reasoningFollowUp,
    ]);

    assert.strictEqual(result.length, 1, 'the assistant burst should collapse into one rendered turn');
    assert.strictEqual(
      result[0]?.content,
      "Pick a question category, and I’ll ask you multiple-choice questions in that style.",
      'the visible assistant body should stay on the question prompt',
    );
    assert.strictEqual(
      result[0]?.responseType,
      'question',
      'the collapsed turn should remain a question turn',
    );
    assert.ok(
      !String(result[0]?.content ?? '').includes('Preparing for MCQ response'),
      'reasoning text should not become the visible assistant response',
    );
  });

  it('should prefer structured question text over leaked reasoning text for question turns', () => {
    const inputMessage: Message = {
      id: 'msg-question-reasoning-leak',
      role: 'assistant',
      content: 'The user is repeating themselves. They seem to want me to ask another one.',
      structuredOutput: {
        responseType: 'question',
        question: {
          question: 'Which option should I ask the user to choose?',
          displayPrompt: 'Running question',
          options: [
            { id: 'opt-a', label: 'Option A', value: 'Option A' },
            { id: 'opt-b', label: 'Option B', value: 'Option B' },
          ],
        },
        interactiveEvents: [{
          type: 'question',
          id: 'q-leak',
          title: 'Question',
          question: 'Which option should I ask the user to choose?',
          options: [
            { id: 'opt-a', label: 'Option A', value: 'Option A' },
            { id: 'opt-b', label: 'Option B', value: 'Option B' },
          ],
          multiSelect: false,
          allowCustomInput: false,
        }],
      },
      parts: [
        {
          type: 'text',
          text: 'The user is repeating themselves. They seem to want me to ask another one.',
        },
      ],
    };

    const streaming = {
      messageId: 'msg-question-reasoning-leak',
      content: 'The user is repeating themselves. They seem to want me to ask another one.',
      reasoning: 'The user is repeating themselves. They seem to want me to ask another one.',
      reasoningEvents: [
        {
          text: 'The user is repeating themselves. They seem to want me to ask another one.',
          createdAt: Date.now(),
        },
      ],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: false,
      modelID: 'test-model',
      providerID: 'test-provider',
    };

    const result = normalizeMessage(inputMessage, streaming);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'Which option should I ask the user to choose?',
      'question turns should render the structured question instead of leaked reasoning text',
    );
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should still be preserved for question turns',
    );
  });

  it('should prefer explicit assistant text parts over top-level content when parts are present', () => {
    const inputMessage: Message = {
      id: 'msg-part-precedence',
      role: 'assistant',
      content: 'Top-level flattened content that should not win',
      parts: [
        {
          type: 'text',
          text: 'Canonical assistant answer from a text part.',
        },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'Canonical assistant answer from a text part.',
      'assistant text parts should win over flattened top-level content',
    );
  });

  it('should replace long leaked draft content with the canonical structured question prompt', () => {
    const inputMessage: Message = {
      id: 'msg-question-long-leak',
      role: 'assistant',
      content: 'The user wants me to ask them questions with choices using the question tool. Let me come up with some interesting and relevant questions to ask them about their project or about software engineering in general. Since they are in a project called climateRX-2, I could ask about that. But since they did not give me a specific topic, I will ask some general software engineering questions.',
      structuredOutput: {
        responseType: 'question',
        question: {
          question: 'What kind of project is climateRX-2?',
          displayPrompt: 'Running question',
          options: [
            { id: 'opt-a', label: 'Web app', value: 'Web app' },
            { id: 'opt-b', label: 'CLI tool', value: 'CLI tool' },
          ],
        },
        interactiveEvents: [{
          type: 'question',
          id: 'q-long-leak',
          title: 'Question',
          question: 'What kind of project is climateRX-2?',
          options: [
            { id: 'opt-a', label: 'Web app', value: 'Web app' },
            { id: 'opt-b', label: 'CLI tool', value: 'CLI tool' },
          ],
          multiSelect: false,
          allowCustomInput: false,
        }],
      },
      parts: [
        {
          type: 'text',
          text: 'The user wants me to ask them questions with choices using the question tool.',
        },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'What kind of project is climateRX-2?',
      'question turns should prefer the structured prompt even when the draft content is long',
    );
  });

  it('preserves recommended question options from centralized question-tool payloads', () => {
    const inputMessage: Message = {
      id: 'msg-question-recommended-option',
      role: 'assistant',
      rawSdkEventPayloads: [
        {
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-question-recommended',
            part: {
              type: 'tool',
              tool: 'question',
              callID: 'call-question-recommended',
              state: {
                status: 'completed',
                input: {
                  questions: [
                    {
                      header: 'Todo feature scope',
                      question: 'What kind of todo feature do you want?',
                      options: [
                        {
                          label: 'Trip prep checklist',
                          description: 'Per-trip task lists attached to a trip/plan.',
                          recommended: true,
                        },
                        {
                          label: 'General task list',
                          description: 'Standalone personal travel todos.',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
          source: '/event',
          sessionId: 'ses-question-recommended',
        },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.equal(result?.interactiveEvents?.[0]?.type, 'question');
    assert.equal(
      result?.interactiveEvents?.[0]?.options?.[0]?.recommended,
      true,
      'recommended options should survive centralized question normalization',
    );
    assert.equal(
      result?.interactiveEvents?.[0]?.options?.[1]?.recommended,
      undefined,
      'non-recommended options should remain unflagged',
    );
  });

  it('should replace progress reasoning with the interactive question prompt during live streaming', () => {
    const inputMessage: Message = {
      id: 'msg-progress-interactive-question',
      role: 'assistant',
      content:
        'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
      structuredOutput: {
        responseType: 'progress',
        message:
          'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
        interactiveEvents: [
          {
            type: 'question',
            id: 'q-progress',
            title: 'Running question',
            question: "What's the most fun way to spend a surprise free day?",
            options: [
              { id: 'theme-park', label: 'Theme Park', value: 'Theme Park' },
              { id: 'beach-day', label: 'Beach Day', value: 'Beach Day' },
              { id: 'road-trip', label: 'Road Trip', value: 'Road Trip' },
              { id: 'video-games', label: 'Video Games', value: 'Video Games' },
            ],
            multiSelect: false,
            allowCustomInput: false,
          },
        ],
      },
      parts: [
        {
          type: 'text',
          text:
            'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
        },
      ],
    };

    const streaming = {
      messageId: 'msg-progress-interactive-question',
      content:
        'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
      reasoning:
        'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
      reasoningEvents: [
        {
          text:
            'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
          createdAt: Date.now(),
        },
      ],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: true,
      hasRenderableContent: true,
      modelID: 'test-model',
      providerID: 'test-provider',
      structuredOutput: {
        responseType: 'progress',
        message:
          'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
        interactiveEvents: [
          {
            type: 'question',
            id: 'q-progress',
            title: 'Running question',
            question: "What's the most fun way to spend a surprise free day?",
            options: [
              { id: 'theme-park', label: 'Theme Park', value: 'Theme Park' },
              { id: 'beach-day', label: 'Beach Day', value: 'Beach Day' },
              { id: 'road-trip', label: 'Road Trip', value: 'Road Trip' },
              { id: 'video-games', label: 'Video Games', value: 'Video Games' },
            ],
            multiSelect: false,
            allowCustomInput: false,
          },
        ],
      },
    };

    const result = normalizeMessage(inputMessage, streaming);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      "What's the most fun way to spend a surprise free day?",
      'progress turns with blocking interactive questions should render the canonical question prompt',
    );
    assert.strictEqual(
      result?.responseType,
      'progress',
      'the underlying progress response type should be preserved',
    );
  });

  it('should collapse adjacent duplicate assistant text parts during normalization', () => {
    const inputMessage: Message = {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'No stashes from our session.' },
        { type: 'text', text: 'No stashes from our session.' },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'No stashes from our session.',
      'duplicate adjacent text parts should not be repeated in content',
    );
    assert.ok(
      Array.isArray(result?.parts) && result?.parts.length === 1,
      'duplicate adjacent text parts should be collapsed in parts',
    );
  });

  it('should trim overlapping cumulative streaming snapshots before appending', () => {
    const result = resolveStreamingContentUpdate(
      'The user wants a',
      'wants a "New feature" code question with choices.',
      true,
    );

    assert.deepStrictEqual(
      result,
      {
        content: '"New feature" code question with choices.',
        append: true,
      },
      'overlapping cumulative snapshots should only append the new suffix',
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

  it('should prefer cached switch history when it contains a newer user turn', () => {
    const cachedMessages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Draft the summary',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Working on it',
        progressEvents: [
          { type: 'step', title: 'build', status: 'pending' },
        ],
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Actually, include the timeline too',
      },
    ];

    const incomingMessages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Draft the summary',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Working on it',
        progressEvents: [
          { type: 'step', title: 'build', status: 'pending' },
          { type: 'step', title: 'search', status: 'done' },
        ],
      },
    ];

    assert.strictEqual(
      shouldPreferCachedSwitchMessages(cachedMessages, incomingMessages),
      true,
      'cached history should win when it has the newer user turn that incoming history is missing',
    );
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

  it('should preserve structuredOutput and backfill streamed edits when coalescing with streaming state', () => {
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
      edits: ['src/example.ts', 'src/example.ts', 'README.md'],
      isActive: false,
      modelID: 'test-model',
      providerID: 'test-provider'
    };

    const result = normalizeMessage(baseMessage, streaming);

    assert.ok(result, 'Result should exist');
    assert.strictEqual(result?.content, 'Base message', 'Should keep finalized assistant content');

    // Critical: structuredOutput must be preserved even when final content wins
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.structuredOutput, 'structuredOutput must be preserved with streaming');

    const structuredOutput = resultRecord.structuredOutput as Record<string, unknown>;
    assert.strictEqual(structuredOutput.responseType, 'question', 'responseType must be preserved');
    assert.strictEqual(
      (structuredOutput.interactiveEvents as Array<Record<string, unknown>>)[0].id,
      'q-base',
      'Original event ID must be preserved'
    );
    assert.deepStrictEqual(
      result?.edits,
      [{ file: 'src/example.ts' }, { file: 'README.md' }],
      'Should backfill deduplicated streamed edits when the final payload omitted them'
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
