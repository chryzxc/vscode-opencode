import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasActiveAssistantTurnContext,
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
