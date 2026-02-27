import React, { createContext, useContext, useMemo, useReducer } from 'react';

import type {
  Agent,
  AppState,
  AttachmentItem,
  ThinkingLevel,
  TodoItem,
  ContextItem,
  FileResult,
  Message,
  Model,
  QueueItem,
  QuotaData,
  Session,
  SessionStats,
  SubagentDetail,
  SubagentSummary,
  StreamingState,
  StreamingStep
} from './types';

export const initialState: AppState = {
  selectedFiles: [],
  selectedContexts: [],
  availableModels: [],
  selectedModel: null,
  modelSearchQuery: '',
  availableAgents: [],
  selectedAgent: '',
  agentSearchQuery: '',
  isProcessing: false,
  currentSessionId: null,
  messages: [],
  promptQueue: [],
  isExecutingQueue: false,
  isQueueOpen: false,
  isSidebarOpen: false,
  sessionsList: [],
  sessionEdits: new Set<string>(),
  sessionStats: {
    input: 0,
    output: 0,
    read: 0,
    write: 0,
    duration: 0
  },
  streaming: null,
  inputValue: '',
  fileSuggestions: [],
  showFileSuggestions: false,
  selectedSuggestionIndex: 0,
  receivedInitState: false,
  serverStatus: 'connecting',
  modelDropdownOpen: false,
  agentDropdownOpen: false,
  thinkingDropdownOpen: false,
  errorMessages: [],
  quotaData: null,
  quotaIsRefreshing: false,
  attachments: [],
  thinkingLevel: 'medium',
  todoItems: [],
  subagentsByParentMessageId: {},
  subagentDetailsById: {},
  selectedSubagentId: null,
  subagentsPanelOpen: true
};

type StreamingContentPayload = { content: string; append?: boolean };
type StreamingReasoningPayload = { reasoning: string; append?: boolean };
type StreamingStepUpdatePayload = {
  id?: string;
  callID?: string;
  index?: number;
  patch: Partial<StreamingStep>;
};

export type AppAction =
  | { type: 'SET_RECEIVED_INIT_STATE'; payload: boolean }
  | { type: 'SET_SESSION_ID'; payload: string | null }
  | { type: 'SET_SERVER_STATUS'; payload: string }
  | { type: 'SET_SELECTED_MODEL'; payload: { providerID: string; modelID: string } | null }
  | { type: 'SET_MODELS_LIST'; payload: Model[] }
  | { type: 'SET_SELECTED_AGENT'; payload: string }
  | { type: 'SET_AGENTS_LIST'; payload: Agent[] }
  | { type: 'SET_MESSAGES'; payload: Message[] }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_PROCESSING'; payload: boolean }
  | { type: 'SET_SESSIONS_LIST'; payload: Session[] }
  | { type: 'ADD_SESSION_EDIT'; payload: string }
  | { type: 'CLEAR_SESSION_EDITS' }
  | { type: 'UPDATE_SESSION_STATS'; payload: Partial<SessionStats> }
  | { type: 'RESET_SESSION_STATS'; payload?: SessionStats }
  | { type: 'ACCUMULATE_SESSION_STATS'; payload: SessionStats }
  | { type: 'SET_STREAMING'; payload: StreamingState | null }
  | { type: 'UPDATE_STREAMING_CONTENT'; payload: StreamingContentPayload }
  | { type: 'UPDATE_STREAMING_REASONING'; payload: StreamingReasoningPayload }
  | { type: 'ADD_STREAMING_STEP'; payload: StreamingStep }
  | { type: 'UPDATE_STREAMING_STEP'; payload: StreamingStepUpdatePayload }
  | { type: 'ADD_STREAMING_EDIT'; payload: string }
  | { type: 'FINISH_STREAMING'; payload?: { usage?: { total: number; duration?: number } } }
  | { type: 'SET_INPUT_VALUE'; payload: string }
  | { type: 'SET_FILE_SUGGESTIONS'; payload: FileResult[] }
  | { type: 'SET_SHOW_FILE_SUGGESTIONS'; payload: boolean }
  | { type: 'SET_SUGGESTION_INDEX'; payload: number }
  | { type: 'SET_SELECTED_FILES'; payload: string[] }
  | { type: 'SET_SELECTED_CONTEXTS'; payload: ContextItem[] }
  | { type: 'SET_QUEUE'; payload: QueueItem[] }
  | { type: 'SET_EXECUTING_QUEUE'; payload: boolean }
  | { type: 'SET_QUEUE_OPEN'; payload: boolean }
  | { type: 'SET_SIDEBAR_OPEN'; payload: boolean }
  | { type: 'SET_MODEL_DROPDOWN_OPEN'; payload: boolean }
  | { type: 'SET_AGENT_DROPDOWN_OPEN'; payload: boolean }
  | { type: 'SET_THINKING_DROPDOWN_OPEN'; payload: boolean }
  | { type: 'SET_MODEL_SEARCH'; payload: string }
  | { type: 'SET_AGENT_SEARCH'; payload: string }
  | { type: 'ADD_ERROR_MESSAGE'; payload: string }
  | { type: 'SET_QUOTA_DATA'; payload: QuotaData | null }
  | { type: 'SET_QUOTA_REFRESHING'; payload: boolean }

  | { type: 'ADD_ATTACHMENT'; payload: AttachmentItem }
  | { type: 'REMOVE_ATTACHMENT'; payload: string }
  | { type: 'CLEAR_ATTACHMENTS' }
  | { type: 'SET_THINKING_LEVEL'; payload: ThinkingLevel }
  | { type: 'SET_TODO_ITEMS'; payload: TodoItem[] }
  | { type: 'UPDATE_TODO_ITEM'; payload: { id: string; patch: Partial<TodoItem> } }
  | { type: 'ADD_TODO_ITEM'; payload: TodoItem }
  | { type: 'UPSERT_SUBAGENT_SUMMARIES'; payload: Record<string, SubagentSummary[]> }
  | { type: 'UPSERT_SUBAGENT_DETAIL'; payload: Record<string, SubagentDetail> }
  | { type: 'SELECT_SUBAGENT'; payload: string | null }
  | { type: 'SET_SUBAGENTS_PANEL_OPEN'; payload: boolean }
  | { type: 'CLEAR_SUBAGENTS_FOR_SESSION' };

function mergeStats(current: SessionStats, next: SessionStats): SessionStats {
  return {
    input: current.input + next.input,
    output: current.output + next.output,
    read: current.read + next.read,
    write: current.write + next.write,
    duration: current.duration + next.duration
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_RECEIVED_INIT_STATE':
      return { ...state, receivedInitState: action.payload };
    case 'SET_SESSION_ID':
      return { ...state, currentSessionId: action.payload };
    case 'SET_SERVER_STATUS':
      return { ...state, serverStatus: action.payload };
    case 'SET_SELECTED_MODEL':
      return { ...state, selectedModel: action.payload };
    case 'SET_MODELS_LIST':
      return { ...state, availableModels: action.payload };
    case 'SET_SELECTED_AGENT':
      return { ...state, selectedAgent: action.payload };
    case 'SET_AGENTS_LIST':
      return { ...state, availableAgents: action.payload };
    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };
    case 'CLEAR_MESSAGES':
      return { ...state, messages: [] };
    case 'SET_PROCESSING':
      return { ...state, isProcessing: action.payload };
    case 'SET_SESSIONS_LIST':
      return { ...state, sessionsList: action.payload };
    case 'ADD_SESSION_EDIT': {
      const edits = new Set(state.sessionEdits);
      edits.add(action.payload);
      return { ...state, sessionEdits: edits };
    }
    case 'CLEAR_SESSION_EDITS':
      return { ...state, sessionEdits: new Set<string>() };
    case 'UPDATE_SESSION_STATS':
      return { ...state, sessionStats: { ...state.sessionStats, ...action.payload } };
    case 'RESET_SESSION_STATS':
      return {
        ...state,
        sessionStats: action.payload ?? { input: 0, output: 0, read: 0, write: 0, duration: 0 }
      };
    case 'ACCUMULATE_SESSION_STATS':
      return { ...state, sessionStats: mergeStats(state.sessionStats, action.payload) };
    case 'SET_STREAMING':
      return action.payload
        ? {
            ...state,
            streaming: {
              ...action.payload,
              reasoningEvents: action.payload.reasoningEvents ?? [],
              progressEvents: action.payload.progressEvents ?? []
            }
          }
        : { ...state, streaming: null };
    case 'UPDATE_STREAMING_CONTENT': {
      if (!state.streaming) {
        return state;
      }
      const content = action.payload.append
        ? `${state.streaming.content}${action.payload.content}`
        : action.payload.content;
      return { ...state, streaming: { ...state.streaming, content } };
    }
    case 'UPDATE_STREAMING_REASONING': {
      if (!state.streaming) {
        return state;
      }
      const reasoning = action.payload.append
        ? `${state.streaming.reasoning}${action.payload.reasoning}`
        : action.payload.reasoning;
      const chunk = action.payload.reasoning.trim();
      const reasoningEvents =
        chunk.length > 0
          ? [...state.streaming.reasoningEvents, { text: chunk, createdAt: Date.now() }]
          : state.streaming.reasoningEvents;
      return { ...state, streaming: { ...state.streaming, reasoning, reasoningEvents } };
    }
    case 'ADD_STREAMING_STEP': {
      if (!state.streaming) {
        return state;
      }
      return {
        ...state,
        streaming: {
          ...state.streaming,
          steps: [...state.streaming.steps, action.payload],
          progressEvents: [...state.streaming.progressEvents, { ...action.payload }]
        }
      };
    }
    case 'UPDATE_STREAMING_STEP': {
      if (!state.streaming) {
        return state;
      }
      const idx =
        typeof action.payload.index === 'number'
          ? action.payload.index
          : state.streaming.steps.findIndex(
              (step) =>
                (action.payload.id && step.id === action.payload.id) ||
                (action.payload.callID && step.callID === action.payload.callID)
            );
      if (idx < 0) {
        return state;
      }
      const steps = [...state.streaming.steps];
      steps[idx] = { ...steps[idx], ...action.payload.patch };
      return {
        ...state,
        streaming: {
          ...state.streaming,
          steps,
          progressEvents: [...state.streaming.progressEvents, { ...steps[idx] }]
        }
      };
    }
    case 'ADD_STREAMING_EDIT': {
      if (!state.streaming) {
        return state;
      }
      return {
        ...state,
        streaming: {
          ...state.streaming,
          edits: [...state.streaming.edits, action.payload]
        }
      };
    }
    case 'FINISH_STREAMING': {
      if (!state.streaming) {
        return state;
      }
      return {
        ...state,
        streaming: {
          ...state.streaming,
          isActive: false,
          usage: action.payload?.usage ?? state.streaming.usage
        }
      };
    }
    case 'SET_INPUT_VALUE':
      return { ...state, inputValue: action.payload };
    case 'SET_FILE_SUGGESTIONS':
      return { ...state, fileSuggestions: action.payload };
    case 'SET_SHOW_FILE_SUGGESTIONS':
      return { ...state, showFileSuggestions: action.payload };
    case 'SET_SUGGESTION_INDEX':
      return { ...state, selectedSuggestionIndex: action.payload };
    case 'SET_SELECTED_FILES':
      return { ...state, selectedFiles: action.payload };
    case 'SET_SELECTED_CONTEXTS':
      return { ...state, selectedContexts: action.payload };
    case 'SET_QUEUE':
      return { ...state, promptQueue: action.payload };
    case 'SET_EXECUTING_QUEUE':
      return { ...state, isExecutingQueue: action.payload };
    case 'SET_QUEUE_OPEN':
      return { ...state, isQueueOpen: action.payload };
    case 'SET_SIDEBAR_OPEN':
      return { ...state, isSidebarOpen: action.payload };
    case 'SET_MODEL_DROPDOWN_OPEN':
      return { ...state, modelDropdownOpen: action.payload };
    case 'SET_AGENT_DROPDOWN_OPEN':
      return { ...state, agentDropdownOpen: action.payload };
    case 'SET_THINKING_DROPDOWN_OPEN':
      return { ...state, thinkingDropdownOpen: action.payload };
    case 'SET_MODEL_SEARCH':
      return { ...state, modelSearchQuery: action.payload };
    case 'SET_AGENT_SEARCH':
      return { ...state, agentSearchQuery: action.payload };
    case 'ADD_ERROR_MESSAGE':
      return { ...state, errorMessages: [...state.errorMessages, action.payload] };
    case 'SET_QUOTA_DATA':
      return { ...state, quotaData: action.payload, quotaIsRefreshing: false };
    case 'SET_QUOTA_REFRESHING':
      return { ...state, quotaIsRefreshing: action.payload };
    case 'ADD_ATTACHMENT': {
      return { ...state, attachments: [...(state.attachments || []), action.payload] };
    }
    case 'REMOVE_ATTACHMENT': {
      return { ...state, attachments: (state.attachments || []).filter((a) => a.id !== action.payload) };
    }
    case 'CLEAR_ATTACHMENTS': {
      return { ...state, attachments: [] };
    }
    case 'SET_THINKING_LEVEL': {
      return { ...state, thinkingLevel: action.payload };
    }
    case 'SET_TODO_ITEMS': {
      return { ...state, todoItems: action.payload };
    }
    case 'UPDATE_TODO_ITEM': {
      const items = (state.todoItems || []).map((it) => (it.id === action.payload.id ? { ...it, ...action.payload.patch } : it));
      return { ...state, todoItems: items };
    }
    case 'ADD_TODO_ITEM': {
      return { ...state, todoItems: [...(state.todoItems || []), action.payload] };
    }
    case 'UPSERT_SUBAGENT_SUMMARIES': {
      return {
        ...state,
        subagentsByParentMessageId: {
          ...state.subagentsByParentMessageId,
          ...action.payload
        }
      };
    }
    case 'UPSERT_SUBAGENT_DETAIL': {
      return {
        ...state,
        subagentDetailsById: {
          ...state.subagentDetailsById,
          ...action.payload
        }
      };
    }
    case 'SELECT_SUBAGENT': {
      return { ...state, selectedSubagentId: action.payload };
    }
    case 'SET_SUBAGENTS_PANEL_OPEN': {
      return { ...state, subagentsPanelOpen: action.payload };
    }
    case 'CLEAR_SUBAGENTS_FOR_SESSION': {
      return {
        ...state,
        subagentsByParentMessageId: {},
        subagentDetailsById: {},
        selectedSubagentId: null
      };
    }
    default:
      return state;
  }
}

export const AppStateContext = createContext<AppState | undefined>(undefined);
export const AppDispatchContext = createContext<React.Dispatch<AppAction> | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const stateValue = useMemo(() => state, [state]);

  return React.createElement(
    AppStateContext.Provider,
    { value: stateValue },
    React.createElement(AppDispatchContext.Provider, { value: dispatch }, children)
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppProvider');
  }
  return context;
}

export function useAppDispatch() {
  const context = useContext(AppDispatchContext);
  if (!context) {
    throw new Error('useAppDispatch must be used within AppProvider');
  }
  return context;
}
