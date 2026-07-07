import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasActiveAssistantTurnContext,
  hasActiveAssistantReplyInCentralizedTape,
  hasBusySessionStatusInCentralizedTape,
  hasCompletedAssistantReplyInCentralizedTape,
  isAssistantRespondingInCurrentSession,
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
