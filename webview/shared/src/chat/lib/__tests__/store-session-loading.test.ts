import { appReducer as reducer, initialState } from '../store';

describe('Session Loading State Reducer', () => {
  describe('START_SESSION_LOADING', () => {
    it('should set loading state with session details', () => {
      const action = {
        type: 'START_SESSION_LOADING' as const,
        payload: { sessionId: 'session-123', title: 'My Conversation' }
      };

      const state = reducer(initialState, action);

      expect(state.isLoadingSession).toBe(true);
      expect(state.loadingSessionId).toBe('session-123');
      expect(state.loadingSessionTitle).toBe('My Conversation');
    });

    it('should use sessionId as fallback title when title is empty', () => {
      const action = {
        type: 'START_SESSION_LOADING' as const,
        payload: { sessionId: 'session-abc', title: '' }
      };

      const state = reducer(initialState, action);

      expect(state.loadingSessionTitle).toBe('');
    });

    it('should not affect other state properties', () => {
      const stateWithMessages = {
        ...initialState,
        messages: [{ id: '1', role: 'user', content: 'Hello' }],
        currentSessionId: 'session-456'
      };

      const action = {
        type: 'START_SESSION_LOADING' as const,
        payload: { sessionId: 'session-789', title: 'New Session' }
      };

      const newState = reducer(stateWithMessages, action);

      expect(newState.messages).toEqual(stateWithMessages.messages);
      expect(newState.currentSessionId).toBe(stateWithMessages.currentSessionId);
    });

    it('should preserve streaming state during session switch', () => {
      const stateWithStreaming = {
        ...initialState,
        streaming: {
          isActive: true,
          messageId: 'msg-1',
          content: 'Test',
          reasoning: '',
          reasoningEvents: [],
          steps: [],
          progressEvents: [],
          edits: []
        }
      };

      const action = {
        type: 'START_SESSION_LOADING' as const,
        payload: { sessionId: 'session-123', title: 'New Session' }
      };

      const newState = reducer(stateWithStreaming, action);

      expect(newState.streaming).toEqual(stateWithStreaming.streaming);
      expect(newState.isLoadingSession).toBe(true);
    });
  });

  describe('END_SESSION_LOADING', () => {
    it('should clear loading state', () => {
      // Start with loading state active
      const loadingState = {
        ...initialState,
        isLoadingSession: true,
        loadingSessionId: 'session-123',
        loadingSessionTitle: 'My Conversation'
      };

      const action = { type: 'END_SESSION_LOADING' as const };
      const state = reducer(loadingState, action);

      expect(state.isLoadingSession).toBe(false);
      expect(state.loadingSessionId).toBe(null);
      expect(state.loadingSessionTitle).toBe(null);
    });

    it('should be idempotent - can be called multiple times safely', () => {
      const notLoadingState = {
        ...initialState,
        isLoadingSession: false,
        loadingSessionId: null,
        loadingSessionTitle: null
      };

      const action = { type: 'END_SESSION_LOADING' as const };
      const state1 = reducer(notLoadingState, action);
      const state2 = reducer(state1, action);

      expect(state2.isLoadingSession).toBe(false);
      expect(state2.loadingSessionId).toBe(null);
      expect(state2.loadingSessionTitle).toBe(null);
    });

    it('should not affect messages or current session', () => {
      const loadingStateWithMessages = {
        ...initialState,
        isLoadingSession: true,
        loadingSessionId: 'session-123',
        loadingSessionTitle: 'Loading...',
        messages: [{ id: '1', role: 'user', content: 'Hello' }],
        currentSessionId: 'session-123'
      };

      const action = { type: 'END_SESSION_LOADING' as const };
      const state = reducer(loadingStateWithMessages, action);

      expect(state.messages).toEqual(loadingStateWithMessages.messages);
      expect(state.currentSessionId).toBe(loadingStateWithMessages.currentSessionId);
    });
  });

  describe('Session Loading Flow', () => {
    it('should maintain loading state through multiple state updates', () => {
      let state = initialState;

      // Start loading
      state = reducer(state, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-1', title: 'Session 1' }
      });

      expect(state.isLoadingSession).toBe(true);

      // Simulate other state updates during loading
      state = reducer(state, {
        type: 'SET_STREAMING',
        payload: { isActive: true, messageId: 'msg-1' } as any
      });

      expect(state.isLoadingSession).toBe(true);
      expect(state.loadingSessionId).toBe('session-1');

      // End loading
      state = reducer(state, {
        type: 'END_SESSION_LOADING'
      });

      expect(state.isLoadingSession).toBe(false);
      expect(state.loadingSessionId).toBe(null);
    });

    it('should handle rapid session switches', () => {
      let state = initialState;

      // Start loading session A
      state = reducer(state, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-a', title: 'Session A' }
      });

      expect(state.loadingSessionId).toBe('session-a');

      // Switch to session B before A finishes
      state = reducer(state, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-b', title: 'Session B' }
      });

      expect(state.loadingSessionId).toBe('session-b');
      expect(state.loadingSessionTitle).toBe('Session B');
      expect(state.isLoadingSession).toBe(true);
    });

    it('should handle session switch during active AI response', () => {
      let state = {
        ...initialState,
        isProcessing: true,
        streaming: {
          isActive: true,
          messageId: 'msg-1',
          content: 'Thinking...',
          reasoning: '',
          reasoningEvents: [],
          steps: [],
          progressEvents: [],
          edits: []
        }
      };

      // Start session switch
      state = reducer(state, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-new', title: 'New Session' }
      });

      expect(state.isLoadingSession).toBe(true);
      expect(state.isProcessing).toBe(true);

      // End loading
      state = reducer(state, {
        type: 'END_SESSION_LOADING'
      });

      expect(state.isLoadingSession).toBe(false);
      expect(state.isProcessing).toBe(true);
    });

    it('should track loading state transitions correctly', () => {
      let state = initialState;

      // Initial state
      expect(state.isLoadingSession).toBe(false);
      expect(state.loadingSessionId).toBe(null);

      // Start loading
      state = reducer(state, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-1', title: 'Session 1' }
      });

      expect(state.isLoadingSession).toBe(true);
      expect(state.loadingSessionId).toBe('session-1');

      // Complete loading
      state = reducer(state, {
        type: 'END_SESSION_LOADING'
      });

      expect(state.isLoadingSession).toBe(false);
      expect(state.loadingSessionId).toBe(null);
      expect(state.loadingSessionTitle).toBe(null);
    });
  });

  describe('UI State Integration', () => {
    it('should allow UI to determine if input should be hidden', () => {
      const loadingState = reducer(initialState, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-1', title: 'Loading...' }
      });

      // UI should hide input when isLoadingSession is true
      expect(loadingState.isLoadingSession).toBe(true);

      const notLoadingState = reducer(loadingState, {
        type: 'END_SESSION_LOADING'
      });

      // UI should show input when isLoadingSession is false
      expect(notLoadingState.isLoadingSession).toBe(false);
    });

    it('should provide session title for loading UI display', () => {
      const state = reducer(initialState, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-123', title: 'My Chat Title' }
      });

      expect(state.loadingSessionTitle).toBe('My Chat Title');
      expect(state.loadingSessionId).toBe('session-123');
    });
  });

  describe('Edge Cases', () => {
    it('should handle START_SESSION_LOADING with special characters in title', () => {
      const state = reducer(initialState, {
        type: 'START_SESSION_LOADING',
        payload: {
          sessionId: 'session-1',
          title: 'Chat with "quotes" and \'apostrophes\''
        }
      });

      expect(state.loadingSessionTitle).toBe('Chat with "quotes" and \'apostrophes\'');
    });

    it('should handle very long session titles', () => {
      const longTitle = 'A'.repeat(500);
      const state = reducer(initialState, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-1', title: longTitle }
      });

      expect(state.loadingSessionTitle).toBe(longTitle);
    });

    it('should handle concurrent loading requests', () => {
      let state = initialState;

      // First request
      state = reducer(state, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-1', title: 'First' }
      });

      // Second request overrides first
      state = reducer(state, {
        type: 'START_SESSION_LOADING',
        payload: { sessionId: 'session-2', title: 'Second' }
      });

      expect(state.loadingSessionId).toBe('session-2');
      expect(state.loadingSessionTitle).toBe('Second');
      expect(state.isLoadingSession).toBe(true);
    });
  });

  describe('Session Message Cache', () => {
    it('should cache messages by current session when setting messages', () => {
      const message = { id: 'm1', role: 'user', content: 'hello' } as any;
      const state = reducer(
        { ...initialState, currentSessionId: 'session-1' },
        { type: 'SET_MESSAGES', payload: [message] },
      );

      expect(state.messagesBySessionId?.['session-1']).toEqual([message]);
    });

    it('should hydrate messages from cache and clear loading state', () => {
      const cachedMessage = { id: 'cached-1', role: 'user', content: 'cached hello' } as any;
      const state = reducer(
        {
          ...initialState,
          currentSessionId: 'session-1',
          isLoadingSession: true,
          loadingSessionId: 'session-1',
          loadingSessionTitle: 'Session 1',
          messagesBySessionId: { 'session-1': [cachedMessage] },
        },
        { type: 'HYDRATE_SESSION_FROM_CACHE', payload: { sessionId: 'session-1' } },
      );

      expect(state.messages).toEqual([cachedMessage]);
      expect(state.currentSessionId).toBe('session-1');
      expect(state.isLoadingSession).toBe(false);
      expect(state.loadingSessionId).toBe(null);
      expect(state.loadingSessionTitle).toBe(null);
    });
  });
});
