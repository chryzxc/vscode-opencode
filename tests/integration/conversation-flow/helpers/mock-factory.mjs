/**
 * Mock Factory - Creates mock services for conversation flow testing
 *
 * Provides factory functions for creating mocked versions of external
 * services that ChatViewProvider depends on. All mocks support inspection
 * and verification of interactions.
 */

/**
 * Creates a mock OpencodeServerManager
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.sendMessageFn - Mock function for sendMessage calls
 * @param {boolean} options.shouldFail - Whether the mock should fail
 * @returns {Object} Mock server manager
 */
export function createMockServerManager(options = {}) {
  const {
    sendMessageFn = async () => ({
      data: { sessionId: 'test-session-123', responseId: 'test-response-123' }
    }),
    shouldFail = false,
  } = options;

  const mock = {
    ensureRunning: async () => ({
      sendMessage: shouldFail
        ? async () => { throw new Error('Mock server error'); }
        : sendMessageFn,
    }),
    _callCount: 0,
    _calls: [],
  };

  // Track calls
  const originalEnsureRunning = mock.ensureRunning;
  mock.ensureRunning = async (...args) => {
    mock._callCount++;
    mock._calls.push(args);
    return originalEnsureRunning(...args);
  };

  return mock;
}

/**
 * Creates a mock MessageStreamService with controllable event emission
 *
 * @param {Object} options - Configuration options
 * @param {Array} options.initialEvents - Events to emit immediately on subscribe
 * @returns {Object} Mock stream service with event emission control
 */
export function createMockStreamService(options = {}) {
  const { initialEvents = [] } = options;

  const mock = {
    _subscribers: [],
    _subscribeCallCount: 0,
    _unsubscribeCallCount: 0,

    subscribe: (callback) => {
      mock._subscribeCallCount++;
      mock._subscribers.push(callback);

      // Emit initial events if provided
      initialEvents.forEach(event => {
        callback(event);
      });

      // Return unsubscribe function
      return () => {
        mock._unsubscribeCallCount++;
        const index = mock._subscribers.indexOf(callback);
        if (index > -1) {
          mock._subscribers.splice(index, 1);
        }
      };
    },

    // Test helper: emit an event to all subscribers
    _emit: (event) => {
      mock._subscribers.forEach(callback => callback(event));
    },

    // Test helper: get current subscriber count
    _getSubscriberCount: () => mock._subscribers.length,

    // Test helper: clear all subscribers
    _clearSubscribers: () => {
      mock._subscribers = [];
    },
  };

  return mock;
}

/**
 * Creates a mock SessionService
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.initialSession - Starting session state
 * @param {Array} options.initialMessages - Starting messages
 * @returns {Object} Mock session service
 */
export function createMockSessionService(options = {}) {
  const {
    initialSession = { id: 'test-session-123', title: 'Test Session' },
    initialMessages = [],
  } = options;

  const mock = {
    _sessions: [initialSession],
    _messages: new Map([[initialSession.id, [...initialMessages]]]),
    _currentSessionId: initialSession.id,
    _callLog: [],

    getCurrentSession: async () => {
      mock._callLog.push({ method: 'getCurrentSession' });
      return mock._sessions.find(s => s.id === mock._currentSessionId) || mock._sessions[0];
    },

    switchSession: async (sessionId) => {
      mock._callLog.push({ method: 'switchSession', args: [sessionId] });
      mock._currentSessionId = sessionId;
      const session = mock._sessions.find(s => s.id === sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      return session;
    },

    createSession: async (title) => {
      mock._callLog.push({ method: 'createSession', args: [title] });
      const newSession = {
        id: `session-${Date.now()}`,
        title: title || 'New Session',
        time: { created: Date.now() },
      };
      mock._sessions.push(newSession);
      mock._messages.set(newSession.id, []);
      mock._currentSessionId = newSession.id;
      return newSession;
    },

    getMessages: async (sessionId) => {
      mock._callLog.push({ method: 'getMessages', args: [sessionId] });
      return mock._messages.get(sessionId) || [];
    },

    appendMessage: async (sessionId, message) => {
      mock._callLog.push({ method: 'appendMessage', args: [sessionId, message] });
      const messages = mock._messages.get(sessionId);
      if (messages) {
        messages.push(message);
      } else {
        mock._messages.set(sessionId, [message]);
      }
    },

    updateSession: async (sessionId, updates) => {
      mock._callLog.push({ method: 'updateSession', args: [sessionId, updates] });
      const session = mock._sessions.find(s => s.id === sessionId);
      if (session) {
        Object.assign(session, updates);
      }
      return session;
    },

    getAllSessions: async () => {
      mock._callLog.push({ method: 'getAllSessions' });
      return mock._sessions;
    },

    // Test helpers
    _getMessageCount: (sessionId) => mock._messages.get(sessionId)?.length || 0,
    _getLastMessage: (sessionId) => {
      const messages = mock._messages.get(sessionId);
      return messages?.[messages.length - 1];
    },
    _reset: () => {
      mock._sessions = [initialSession];
      mock._messages = new Map([[initialSession.id, [...initialMessages]]]);
      mock._currentSessionId = initialSession.id;
      mock._callLog = [];
    },
  };

  return mock;
}

/**
 * Creates a mock BudgetService
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.allowed - Whether requests are allowed
 * @param {string} options.reason - Reason if not allowed
 * @returns {Object} Mock budget service
 */
export function createMockBudgetService(options = {}) {
  let allowed = options?.allowed ?? true;
  let reason = options?.reason ?? '';

  const mock = {
    canMakeRequest: () => ({ allowed, reason }),
    _callCount: 0,

    // Test helper
    _setAllowed: (value, newReason = '') => {
      allowed = value;
      reason = newReason;
    },
  };

  return mock;
}

/**
 * Creates a mock webview for testing postMessage communication
 *
 * @returns {Object} Mock webview
 */
export function createMockWebview() {
  const mock = {
    _postedMessages: [],
    _messageHandlers: [],

    postMessage: (message) => {
      mock._postedMessages.push(message);
      return Promise.resolve(true);
    },

    // Test helpers
    _getLastMessage: () => mock._postedMessages[mock._postedMessages.length - 1],
    _getMessageCount: () => mock._postedMessages.length,
    _getMessagesByType: (type) => mock._postedMessages.filter(m => m.type === type),
    _reset: () => {
      mock._postedMessages = [];
    },
  };

  return mock;
}

/**
 * Creates a mock context (VSCode extension context)
 *
 * @returns {Object} Mock extension context
 */
export function createMockContext() {
  return {
    globalState: {
      get: (key, defaultValue) => defaultValue,
      update: async (key, value) => undefined,
      keys: [],
    },
    workspaceState: {
      get: (key, defaultValue) => defaultValue,
      update: async (key, value) => undefined,
      keys: [],
    },
    extensionPath: '/mock/extension/path',
    extensionUri: { fsPath: '/mock/extension/path' },
    subscriptions: [],
  };
}
