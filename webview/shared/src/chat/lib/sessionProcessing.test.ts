import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasActiveAssistantTurnContext,
  hasActiveAssistantReplyInCentralizedTape,
  hasBusySessionStatusInCentralizedTape,
  hasCompletedAssistantReplyInCentralizedTape,
  isAssistantRespondingInCurrentSession,
  computeQueuedUserMessageIndexes,
} from './sessionProcessing';

describe('isAssistantRespondingInCurrentSession', () => {
  it('does not treat a blank new session as actively responding just because processing is true', () => {
    const result = isAssistantRespondingInCurrentSession(
      true,
      'session-1',
      ['session-1'],
      false,
      false,
      false,
    );

    assert.strictEqual(result, false);
  });

  it('still reports active assistant work when the session has conversation context', () => {
    const result = isAssistantRespondingInCurrentSession(
      true,
      'session-1',
      ['session-1'],
      false,
      false,
      true,
    );

    assert.strictEqual(result, true);
  });

  it('does not treat assistantTurnPending alone as conversation context', () => {
    const result = isAssistantRespondingInCurrentSession(
      true,
      'session-1',
      ['session-1'],
      false,
      true,
      false,
    );

    assert.strictEqual(result, false);
  });

  it('keeps the session loading while the centralized tape shows an unfinished assistant reply', () => {
    const freshTimestamp = Date.now();
    const result = isAssistantRespondingInCurrentSession(
      false,
      'ses_1',
      [],
      false,
      false,
      false,
      [
        {
          id: 'evt_1',
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_1',
              role: 'assistant',
              time: { created: freshTimestamp },
            },
          },
        },
        {
          id: 'evt_2',
          type: 'message.part.updated',
          properties: {
            time: freshTimestamp,
            part: {
              type: 'text',
              messageID: 'msg_1',
              text: 'Hey! What can I help you with?',
            },
          },
        },
        {
          id: 'evt_3',
          type: 'session.status',
          properties: {
            status: { type: 'busy' },
          },
        },
      ],
    );

    assert.strictEqual(result, true);
  });

  it('does not keep the session loading after the centralized tape shows a completed assistant reply', () => {
    const result = hasActiveAssistantReplyInCentralizedTape([
      {
        id: 'evt_1',
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_1',
            role: 'assistant',
            finish: 'stop',
          },
        },
      },
      {
        id: 'evt_2',
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'step-finish',
            messageID: 'msg_1',
          },
        },
      },
    ]);

    assert.strictEqual(result, false);
  });

  it('does not re-arm loading when trailing events arrive after the assistant finish signal', () => {
    // Regression: trailing events (session.diff, replayed parent-user
    // message.updated) after `finish:"stop"` used to re-arm isProcessing in
    // messageHandler because they don't carry the assistant messageId. The
    // fix latches loading OFF once the active assistant turn is closed; this
    // pins the centralized-tape half of that contract.
    const finishedTape = [
      {
        id: 'evt_1',
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_assistant_1',
            role: 'assistant',
            finish: 'stop',
          },
        },
      },
      {
        id: 'evt_2',
        type: 'session.diff',
        properties: {},
      },
      {
        id: 'evt_3',
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_user_1',
            role: 'user',
          },
        },
      },
    ];

    assert.strictEqual(
      hasActiveAssistantReplyInCentralizedTape(finishedTape),
      false,
    );
    assert.strictEqual(
      isAssistantRespondingInCurrentSession(
        false,
        'ses_1',
        [],
        false,
        false,
        false,
        finishedTape,
      ),
      false,
    );
  });

  it('treats a message-scoped abort marker as a completed assistant reply', () => {
    const result = hasCompletedAssistantReplyInCentralizedTape([
      {
        id: 'evt_1',
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_1',
            role: 'assistant',
          },
        },
      },
      {
        id: 'evt_2',
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_1',
            role: 'assistant',
            aborted: true,
          },
        },
      },
    ]);

    assert.strictEqual(result, true);
  });

  it('does not keep the session loading after a session-level abort lands for the latest assistant turn', () => {
    const freshTimestamp = Date.now();
    const result = isAssistantRespondingInCurrentSession(
      false,
      'ses_1',
      [],
      false,
      false,
      true,
      [
        {
          id: 'evt_1',
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_1',
              role: 'assistant',
              time: { created: freshTimestamp },
            },
          },
        },
        {
          id: 'evt_2',
          type: 'session.error',
          properties: {
            error: {
              name: 'MessageAbortedError',
              message: 'MessageAbortedError: Aborted',
            },
            time: freshTimestamp + 1,
          },
        },
        {
          id: 'evt_3',
          type: 'session.status',
          properties: {
            status: { type: 'busy' },
            time: freshTimestamp + 2,
          },
        },
      ],
    );

    assert.strictEqual(result, false);
  });

  it('keeps the session loading while the centralized tape reports a busy session status', () => {
    const freshTimestamp = Date.now();
    const result = isAssistantRespondingInCurrentSession(
      false,
      'ses_1',
      [],
      false,
      false,
      false,
      [
        {
          id: 'evt_1',
          type: 'session.status',
          properties: {
            time: freshTimestamp,
            status: { type: 'busy' },
          },
        },
      ],
    );

    assert.strictEqual(result, true);
  });

  it('does not keep the session loading after the centralized tape returns idle', () => {
    const result = hasBusySessionStatusInCentralizedTape([
      {
        id: 'evt_1',
        type: 'session.status',
        properties: {
          status: { type: 'busy' },
        },
      },
      {
        id: 'evt_2',
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      },
    ]);

    assert.strictEqual(result, false);
  });

  it('does not treat a completed assistant reply as busy even if the session status lags', () => {
    const result = isAssistantRespondingInCurrentSession(
      false,
      'ses_1',
      [],
      false,
      false,
      false,
      [
        {
          id: 'evt_1',
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_1',
              role: 'assistant',
              finish: 'stop',
            },
          },
        },
        {
          id: 'evt_2',
          type: 'session.status',
          properties: {
            status: { type: 'busy' },
          },
        },
      ],
    );

    assert.strictEqual(result, false);
  });

  it('lets completed centralized assistant data override stale processing flags', () => {
    const result = isAssistantRespondingInCurrentSession(
      true,
      'ses_1',
      ['ses_1'],
      true,
      true,
      true,
      [
        {
          id: 'evt_user',
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'text',
              messageID: 'msg_user',
              text: 'hey there',
            },
          },
        },
        {
          id: 'evt_assistant_start',
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_assistant',
              role: 'assistant',
              parentID: 'msg_user',
            },
          },
        },
        {
          id: 'evt_answer',
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'text',
              messageID: 'msg_assistant',
              text: 'Hey! How can I help you today?',
            },
          },
        },
        {
          id: 'evt_step_finish',
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'step-finish',
              messageID: 'msg_assistant',
            },
          },
        },
        {
          id: 'evt_assistant_done',
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_assistant',
              role: 'assistant',
              parentID: 'msg_user',
              finish: 'tool-calls',
            },
          },
        },
      ],
    );

    assert.strictEqual(result, false);
  });

  it('keeps responding true when a newer user message arrives after a completed assistant', () => {
    const result = isAssistantRespondingInCurrentSession(
      true,
      'ses_1',
      ['ses_1'],
      false,
      false,
      true,
      [
        {
          id: 'evt_assistant_done',
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_assistant',
              role: 'assistant',
              finish: 'tool-calls',
            },
          },
        },
        {
          id: 'evt_user_next',
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'text',
              messageID: 'msg_user_next',
              text: 'next question',
            },
          },
        },
      ],
    );

    assert.strictEqual(result, true);
  });

  it('does not treat stale rehydrated raw events as an active assistant response on startup', () => {
    const staleTimestamp = Date.now() - 120_000;
    const result = isAssistantRespondingInCurrentSession(
      false,
      'ses_1',
      [],
      false,
      false,
      true,
      [
        {
          id: 'evt_1',
          type: 'session.status',
          properties: {
            time: staleTimestamp,
            status: { type: 'busy' },
          },
        },
        {
          id: 'evt_2',
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_1',
              role: 'assistant',
              time: { created: staleTimestamp },
            },
          },
        },
      ],
    );

    assert.strictEqual(result, false);
  });

  it('still uses fresh centralized events to bridge live loading-state races', () => {
    const freshTimestamp = Date.now();
    const result = isAssistantRespondingInCurrentSession(
      false,
      'ses_1',
      [],
      false,
      false,
      true,
      [
        {
          id: 'evt_1',
          type: 'session.status',
          properties: {
            time: freshTimestamp,
            status: { type: 'busy' },
          },
        },
        {
          id: 'evt_2',
          type: 'message.updated',
          properties: {
            info: {
              id: 'msg_1',
              role: 'assistant',
              time: { created: freshTimestamp },
            },
          },
        },
      ],
    );

    assert.strictEqual(result, true);
  });
});

describe('hasActiveAssistantTurnContext', () => {
  it('treats a user message after the last assistant message as an active turn', () => {
    const result = hasActiveAssistantTurnContext(
      [
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'new question' },
      ],
      false,
      false,
    );

    assert.strictEqual(result, true);
  });

  it('does not treat a completed assistant-only transcript as an active turn', () => {
    const result = hasActiveAssistantTurnContext(
      [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
      false,
      false,
    );

    assert.strictEqual(result, false);
  });
});

describe('computeQueuedUserMessageIndexes', () => {
  it('marks adjacent user turns after the active streamed response as queued', () => {
    const queuedIndexes = computeQueuedUserMessageIndexes([
      { id: 'assistant-old', role: 'assistant' },
      { id: 'user-current', role: 'user' },
      { id: 'user-queued', role: 'user' },
    ]);

    assert.deepStrictEqual([...queuedIndexes], [2]);
  });

  it('marks a user turn after the active assistant owned by the transcript', () => {
    const queuedIndexes = computeQueuedUserMessageIndexes([
      { id: 'user-current', role: 'user' },
      { id: 'assistant-active', role: 'assistant' },
      { id: 'user-queued', role: 'user' },
    ], 'assistant-active');

    assert.deepStrictEqual([...queuedIndexes], [2]);
  });

  it('does not mark the initial user turn that starts a separately rendered response', () => {
    const queuedIndexes = computeQueuedUserMessageIndexes([
      { id: 'assistant-old', role: 'assistant' },
      { id: 'user-current', role: 'user' },
    ]);

    assert.deepStrictEqual([...queuedIndexes], []);
  });
});
