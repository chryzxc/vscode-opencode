import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
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
