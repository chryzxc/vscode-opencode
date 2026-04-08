import { reducer, initialState } from '../store';

describe('Session Loading State Reducer', () => {
  it('should handle START_SESSION_LOADING', () => {
    const action = {
      type: 'START_SESSION_LOADING' as const,
      payload: { sessionId: 'session-123', title: 'My Conversation' }
    };

    const state = reducer(initialState, action);

    expect(state.isLoadingSession).toBe(true);
    expect(state.loadingSessionId).toBe('session-123');
    expect(state.loadingSessionTitle).toBe('My Conversation');
  });

  it('should handle END_SESSION_LOADING', () => {
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
});
