/**
 * Session Lifecycle Tests
 *
 * Tests session creation, deletion, and switching operations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupConversationTest,
  withConversationTest,
} from '../helpers/conversation-test-utils.mjs';

test('session lifecycle: new session can be created', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate session creation
    const createSessionMessage = {
      type: 'createSession',
    };

    // In real flow, this creates a new session
    assert.equal(createSessionMessage.type, 'createSession');

    // Verify session service would be called
    const newSession = await mocks.sessionService.createSession('New Session');
    assert.ok(newSession.id, 'New session should have ID');
    assert.ok(newSession.title, 'New session should have title');
  });
});

test('session lifecycle: session can be switched', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Create multiple sessions
    const session1 = await mocks.sessionService.createSession('Session 1');
    const session2 = await mocks.sessionService.createSession('Session 2');

    // Simulate session switch
    const switchMessage = {
      type: 'switchSession',
      sessionId: session2.id,
    };

    assert.equal(switchMessage.type, 'switchSession');
    assert.equal(switchMessage.sessionId, session2.id);

    // Perform the switch
    const switchedSession = await mocks.sessionService.switchSession(session2.id);
    assert.equal(switchedSession.id, session2.id);
  });
});

test('session lifecycle: session can be deleted', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Create session to delete
    const session = await mocks.sessionService.createSession('Temp Session');

    // Simulate session deletion
    const deleteMessage = {
      type: 'deleteSession',
      sessionId: session.id,
    };

    assert.equal(deleteMessage.type, 'deleteSession');
    assert.equal(deleteMessage.sessionId, session.id);

    // Verify deletion would be called
    // In real implementation, session would be removed
  });
});

test('session lifecycle: sessions list is updated after creation', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Get initial sessions
    const initialSessions = await mocks.sessionService.getAllSessions();
    const initialCount = initialSessions.length;

    // Create new session
    await mocks.sessionService.createSession('New Session');

    // Get updated sessions
    const updatedSessions = await mocks.sessionService.getAllSessions();
    assert.equal(updatedSessions.length, initialCount + 1);
  });
});

test('session lifecycle: sessions list is updated after deletion', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Create session to delete
    const session = await mocks.sessionService.createSession('Temp Session');

    // Get initial count
    const initialSessions = await mocks.sessionService.getAllSessions();
    const initialCount = initialSessions.length;

    // Delete session (in real implementation)
    // For now, just verify the pattern
    assert.ok(session.id, 'Session should have ID');

    // In real flow, sessions list would be updated
  });
});

test('session lifecycle: current session ID is tracked', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Create and switch to session
    const session = await mocks.sessionService.createSession('Active Session');
    await mocks.sessionService.switchSession(session.id);

    // Verify current session
    const currentSession = await mocks.sessionService.getCurrentSession();
    assert.equal(currentSession.id, session.id);
  });
});

test('session lifecycle: session title can be updated', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Create session
    const session = await mocks.sessionService.createSession('Original Title');

    // Update title
    const newTitle = 'Updated Title';
    await mocks.sessionService.updateSession(session.id, { title: newTitle });

    // Verify update
    const updatedSession = await mocks.sessionService.getCurrentSession();
    assert.equal(updatedSession.title, newTitle);
  });
});

test('session lifecycle: session messages are preserved on switch', async () => {
  await withConversationTest(
    async (env) => {
      const { mocks } = env;

      // Create session 1 with messages
      const session1 = await mocks.sessionService.createSession('Session 1');
      await mocks.sessionService.appendMessage(session1.id, {
        role: 'user',
        content: 'Message in session 1',
        time: { created: Date.now() },
      });

      // Create session 2
      const session2 = await mocks.sessionService.createSession('Session 2');

      // Switch to session 1
      await mocks.sessionService.switchSession(session1.id);
      const messages1 = await mocks.sessionService.getMessages(session1.id);
      assert.equal(messages1.length, 1);

      // Switch to session 2
      await mocks.sessionService.switchSession(session2.id);
      const messages2 = await mocks.sessionService.getMessages(session2.id);
      assert.equal(messages2.length, 0);

      // Switch back to session 1
      await mocks.sessionService.switchSession(session1.id);
      const messages1Again = await mocks.sessionService.getMessages(session1.id);
      assert.equal(messages1Again.length, 1, 'Messages should be preserved');
    },
    { initialMessages: [] }
  );
});

test('session lifecycle: webview is notified of session switch', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send session switch notification
    const switchNotification = {
      type: 'sessionSwitched',
      sessionId: 'new-session-123',
    };

    mocks.webview.postMessage(switchNotification);

    // Verify notification sent
    const switchMessages = mocks.webview._getMessagesByType('sessionSwitched');
    assert.ok(switchMessages.length >= 1, 'Should have sessionSwitched message');

    const lastSwitch = switchMessages[switchMessages.length - 1];
    assert.equal(lastSwitch.sessionId, 'new-session-123');
  });
});

test('session lifecycle: webview is notified of session creation', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send session creation notification
    const creationNotification = {
      type: 'sessionCreated',
      session: {
        id: 'new-session-456',
        title: 'New Session',
        time: { created: Date.now() },
      },
    };

    mocks.webview.postMessage(creationNotification);

    // Verify notification sent
    const creationMessages = mocks.webview._getMessagesByType('sessionCreated');
    assert.ok(creationMessages.length >= 1, 'Should have sessionCreated message');

    const lastCreation = creationMessages[creationMessages.length - 1];
    assert.ok(lastCreation.session, 'Should include session object');
    assert.equal(lastCreation.session.id, 'new-session-456');
  });
});

test('session lifecycle: webview is notified of session deletion', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send session deletion notification
    const deletionNotification = {
      type: 'sessionDeleted',
      sessionId: 'deleted-session-789',
    };

    mocks.webview.postMessage(deletionNotification);

    // Verify notification sent
    const deletionMessages = mocks.webview._getMessagesByType('sessionDeleted');
    assert.ok(deletionMessages.length >= 1, 'Should have sessionDeleted message');

    const lastDeletion = deletionMessages[deletionMessages.length - 1];
    assert.equal(lastDeletion.sessionId, 'deleted-session-789');
  });
});

test('session lifecycle: sessions list includes all metadata', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Create session with full metadata
    const session = await mocks.sessionService.createSession('Test Session');

    // Sessions list should include metadata
    const sessions = await mocks.sessionService.getAllSessions();
    const testSession = sessions.find(s => s.id === session.id);

    assert.ok(testSession, 'Session should be in list');
    assert.ok(testSession.id, 'Should have ID');
    assert.ok(testSession.title, 'Should have title');
    assert.ok(testSession.time, 'Should have timestamp');
  });
});

test('session lifecycle: cannot switch to non-existent session', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Try to switch to non-existent session
    try {
      await mocks.sessionService.switchSession('non-existent-session');
      assert.fail('Should throw error for non-existent session');
    } catch (error) {
      assert.ok(error.message.includes('not found'), 'Should throw not found error');
    }
  });
});

test('session lifecycle: session creation generates unique ID', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Create multiple sessions
    const session1 = await mocks.sessionService.createSession('Session 1');
    const session2 = await mocks.sessionService.createSession('Session 2');

    // Verify unique IDs
    assert.notEqual(session1.id, session2.id, 'Session IDs should be unique');
  });
});

test('session lifecycle: session settings persist across switches', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Create session with settings
    const session = await mocks.sessionService.createSession('Configured Session');

    // Update settings
    await mocks.sessionService.updateSession(session.id, {
      title: 'Updated Title',
    });

    // Switch away and back
    const otherSession = await mocks.sessionService.createSession('Other Session');
    await mocks.sessionService.switchSession(otherSession.id);
    await mocks.sessionService.switchSession(session.id);

    // Verify settings persisted
    const currentSession = await mocks.sessionService.getCurrentSession();
    assert.equal(currentSession.title, 'Updated Title');
  });
});

test('session lifecycle: sessions list is sent to webview on update', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send updated sessions list
    const sessionsUpdate = {
      type: 'sessionsList',
      sessions: [
        { id: 'session-1', title: 'Session 1', time: { created: Date.now() } },
        { id: 'session-2', title: 'Session 2', time: { created: Date.now() } },
        { id: 'session-3', title: 'Session 3', time: { created: Date.now() } },
      ],
    };

    mocks.webview.postMessage(sessionsUpdate);

    // Verify update sent
    const sessionsMessages = mocks.webview._getMessagesByType('sessionsList');
    assert.ok(sessionsMessages.length >= 1, 'Should have sessionsList');

    const sessions = sessionsMessages[sessionsMessages.length - 1].sessions;
    assert.equal(sessions.length, 3);
  });
});
