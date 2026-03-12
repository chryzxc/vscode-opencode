import React, { createContext, useContext, useMemo, useReducer } from 'react';

import type {
  Agent,
  AppState,
  AttachmentItem,
  BudgetInfo,
  InteractiveEvent,
  LspServerInfo,
  McpServerInfo,
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
  StreamingStep,
} from "./types";

export const initialState: AppState = {
  selectedFiles: [],
  selectedContexts: [],
  availableModels: [],
  selectedModel: null,
  modelSearchQuery: "",
  availableAgents: [],
  selectedAgent: "",
  agentSearchQuery: "",
  isProcessing: false,
  isSteering: false,
  currentSessionId: null,
  messages: [],
  promptQueue: [],
  queueBySessionId: {},
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
    duration: 0,
  },
  sessionsStatsById: {},
  streaming: null,
  inputValue: "",
  fileSuggestions: [],
  showFileSuggestions: false,
  selectedSuggestionIndex: 0,
  availableCommands: [],
  commandsLoaded: false,
  receivedInitState: false,
  serverStatus: "connecting",
  modelDropdownOpen: false,
  agentDropdownOpen: false,
  thinkingDropdownOpen: false,
  isCompacting: false,
  lastCompactedAt: undefined,
  compactionError: undefined,
  compactionBaselineStats: undefined,
  compactionDividerIndex: undefined,
  compactionDividerBeforeMessageId: undefined,
  compactionDividerAfterMessageId: undefined,
  compactedMessagesCollapsed: false,
  errorMessages: [],
  quotaData: undefined,
  quotaIsRefreshing: false,
  attachments: [],
  thinkingLevel: "medium",
  todoItems: [],
  subagentsByParentMessageId: {},
  subagentDetailsById: {},
  selectedSubagentId: null,
  subagentsPanelOpen: true,
  interactiveEvents: [],
  budgetInfo: undefined,
  mcpServers: [],
  lspServers: [],
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
  | { type: "SET_RECEIVED_INIT_STATE"; payload: boolean }
  | { type: "SET_SESSION_ID"; payload: string | null }
  | { type: "SET_SERVER_STATUS"; payload: string }
  | {
      type: "SET_SELECTED_MODEL";
      payload: { providerID: string; modelID: string } | null;
    }
  | { type: "SET_MODELS_LIST"; payload: Model[] }
  | { type: "SET_SELECTED_AGENT"; payload: string }
  | { type: "SET_AGENTS_LIST"; payload: Agent[] }
  | { type: "SET_MESSAGES"; payload: Message[] }
  | { type: "CLEAR_MESSAGES" }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_STEERING"; payload: boolean }
  | { type: "SET_SESSIONS_LIST"; payload: Session[] }
  | { type: "ADD_SESSION_EDIT"; payload: string }
  | { type: "CLEAR_SESSION_EDITS" }
  | { type: "UPDATE_SESSION_STATS"; payload: Partial<SessionStats> }
  | { type: "RESET_SESSION_STATS"; payload?: SessionStats }
  | { type: "ACCUMULATE_SESSION_STATS"; payload: SessionStats }
  | { type: "SET_STREAMING"; payload: StreamingState | null }
  | { type: "UPDATE_STREAMING_CONTENT"; payload: StreamingContentPayload }
  | { type: "UPDATE_STREAMING_REASONING"; payload: StreamingReasoningPayload }
  | { type: "ADD_STREAMING_STEP"; payload: StreamingStep }
  | { type: "UPDATE_STREAMING_STEP"; payload: StreamingStepUpdatePayload }
  | { type: "ADD_STREAMING_EDIT"; payload: string }
  | {
      type: "FINISH_STREAMING";
      payload?: { usage?: { total: number; duration?: number } };
    }
  | { type: "SET_INPUT_VALUE"; payload: string }
  | { type: "SET_FILE_SUGGESTIONS"; payload: FileResult[] }
  | { type: "SET_SHOW_FILE_SUGGESTIONS"; payload: boolean }
  | { type: "SET_SUGGESTION_INDEX"; payload: number }
  | {
      type: "SET_COMMANDS_LIST";
      payload: AppState["availableCommands"];
    }
  | { type: "SET_SELECTED_FILES"; payload: string[] }
  | { type: "SET_SELECTED_CONTEXTS"; payload: ContextItem[] }
  | {
      type: "SET_QUEUE";
      payload: { sessionId: string | null; queue: QueueItem[] };
    }
  | { type: "SET_EXECUTING_QUEUE"; payload: boolean }
  | { type: "SET_QUEUE_OPEN"; payload: boolean }
  | { type: "SET_SIDEBAR_OPEN"; payload: boolean }
  | { type: "SET_MODEL_DROPDOWN_OPEN"; payload: boolean }
  | { type: "SET_AGENT_DROPDOWN_OPEN"; payload: boolean }
  | { type: "SET_THINKING_DROPDOWN_OPEN"; payload: boolean }
  | {
      type: "SET_COMPACTION_STATUS";
      payload: {
        status: "running" | "done" | "error";
        at?: number;
        error?: string;
        baselineStats?: SessionStats;
        compactionDividerIndex?: number;
        compactionDividerBeforeMessageId?: string;
        compactionDividerAfterMessageId?: string;
        collapsed?: boolean;
      };
    }
  | {
      type: "SET_COMPACTION_VIEW_STATE";
      payload: {
        lastCompactedAt?: number;
        baselineStats?: SessionStats;
        compactionDividerIndex?: number;
        compactionDividerBeforeMessageId?: string;
        compactionDividerAfterMessageId?: string;
        collapsed?: boolean;
      };
    }
  | { type: "SET_COMPACTED_MESSAGES_COLLAPSED"; payload: boolean }
  | { type: "SET_MODEL_SEARCH"; payload: string }
  | { type: "SET_AGENT_SEARCH"; payload: string }
  | { type: "ADD_ERROR_MESSAGE"; payload: string }
  | { type: "CLEAR_ERROR_MESSAGES" }
  | { type: "SET_QUOTA_DATA"; payload: QuotaData | null }
  | { type: "SET_QUOTA_REFRESHING"; payload: boolean }
  | { type: "ADD_ATTACHMENT"; payload: AttachmentItem }
  | { type: "REMOVE_ATTACHMENT"; payload: string }
  | { type: "CLEAR_ATTACHMENTS" }
  | { type: "SET_THINKING_LEVEL"; payload: ThinkingLevel }
  | { type: "SET_TODO_ITEMS"; payload: TodoItem[] }
  | {
      type: "UPDATE_TODO_ITEM";
      payload: { id: string; patch: Partial<TodoItem> };
    }
  | { type: "ADD_TODO_ITEM"; payload: TodoItem }
  | {
      type: "UPSERT_SUBAGENT_SUMMARIES";
      payload: Record<string, SubagentSummary[]>;
    }
  | { type: "UPSERT_SUBAGENT_DETAIL"; payload: Record<string, SubagentDetail> }
  | { type: "SELECT_SUBAGENT"; payload: string | null }
  | { type: "SET_SUBAGENTS_PANEL_OPEN"; payload: boolean }
  | { type: "CLEAR_SUBAGENTS_FOR_SESSION" }
  | { type: "SET_INTERACTIVE_EVENTS"; payload: InteractiveEvent[] }
  | { type: "DISMISS_INTERACTIVE_EVENT"; payload: string }
  | { type: "SET_BUDGET_INFO"; payload: import("./types").BudgetInfo | null }
  | { type: "SET_MCP_SERVERS"; payload: McpServerInfo[] }
  | { type: "SET_LSP_SERVERS"; payload: LspServerInfo[] }
  | { type: "SET_SERVER_VERSION"; payload: string | undefined };

function mergeStats(current: SessionStats, next: SessionStats): SessionStats {
  return {
    input: current.input + next.input,
    output: current.output + next.output,
    read: current.read + next.read,
    write: current.write + next.write,
    duration: current.duration + next.duration
  };
}

const MAX_STREAMING_REASONING_EVENTS = 300;
const MAX_STREAMING_STEPS = 400;
const MAX_STREAMING_PROGRESS_EVENTS = 1000;
const MAX_STREAMING_EDITS = 300;

function appendWithCap<T>(items: T[], next: T, maxItems: number): T[] {
  if (items.length >= maxItems) {
    return [...items.slice(items.length - maxItems + 1), next];
  }
  return [...items, next];
}

function needsReasoningBoundary(previous: string, next: string): boolean {
  if (!previous || !next) {
    return false;
  }

  const prevChar = previous[previous.length - 1];
  const nextChar = next[0];
  if (/\s/.test(prevChar) || /\s/.test(nextChar)) {
    return false;
  }
  if (/^[,.;:!?)}\]]/.test(next)) {
    return false;
  }
  if (/[(\[{]$/.test(prevChar)) {
    return false;
  }

  return /[A-Za-z0-9]/.test(prevChar) && /[A-Za-z0-9]/.test(nextChar);
}

function appendStreamingReasoning(current: string, incoming: string): string {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }
  return needsReasoningBoundary(current, incoming)
    ? `${current} ${incoming}`
    : `${current}${incoming}`;
}

function getQueueForSession(queue: QueueItem[] | undefined, sessionId: string): QueueItem[] {
  if (!Array.isArray(queue) || !sessionId) {
    return [];
  }
  return queue.filter((item) => item.sessionId === sessionId);
}

function getMessageId(message: Message | undefined): string | undefined {
  if (!message) {
    return undefined;
  }
  const infoId =
    typeof message.info?.id === "string" && message.info.id.trim().length > 0
      ? message.info.id
      : undefined;
  if (infoId) {
    return infoId;
  }
  return typeof message.id === "string" && message.id.trim().length > 0
    ? message.id
    : undefined;
}

function getMessageCreatedAt(message: Message | undefined): number | undefined {
  if (!message) {
    return undefined;
  }
  if (typeof message.created === "number" && Number.isFinite(message.created)) {
    return message.created;
  }
  const infoRecord = message.info as Record<string, unknown> | undefined;
  const infoCreated = infoRecord?.created;
  return typeof infoCreated === "number" && Number.isFinite(infoCreated)
    ? infoCreated
    : undefined;
}

function clampDividerIndex(index: number, messageCount: number): number {
  if (index < 0) return 0;
  if (index > messageCount) return messageCount;
  return index;
}

function resolveCompactionDividerAnchors(
  messages: Message[],
  dividerIndex: number,
): {
  compactionDividerBeforeMessageId?: string;
  compactionDividerAfterMessageId?: string;
} {
  const clamped = clampDividerIndex(dividerIndex, messages.length);
  return {
    compactionDividerBeforeMessageId:
      clamped > 0 ? getMessageId(messages[clamped - 1]) : undefined,
    compactionDividerAfterMessageId:
      clamped < messages.length ? getMessageId(messages[clamped]) : undefined,
  };
}

function resolveCompactionDividerIndex(
  messages: Message[],
  input: {
    compactionDividerIndex?: number;
    compactionDividerBeforeMessageId?: string;
    compactionDividerAfterMessageId?: string;
    lastCompactedAt?: number;
  },
): number | undefined {
  const { compactionDividerAfterMessageId, compactionDividerBeforeMessageId } =
    input;

  if (compactionDividerAfterMessageId) {
    const afterIndex = messages.findIndex(
      (message) => getMessageId(message) === compactionDividerAfterMessageId,
    );
    if (afterIndex >= 0) {
      return afterIndex;
    }
  }

  if (compactionDividerBeforeMessageId) {
    const beforeIndex = messages.findIndex(
      (message) => getMessageId(message) === compactionDividerBeforeMessageId,
    );
    if (beforeIndex >= 0) {
      return beforeIndex + 1;
    }
  }

  const compactedAt = input.lastCompactedAt;
  if (
    typeof compactedAt === "number" &&
    Number.isFinite(compactedAt) &&
    compactedAt > 0
  ) {
    const firstPostCompactionIndex = messages.findIndex((message) => {
      const createdAt = getMessageCreatedAt(message);
      return typeof createdAt === "number" && createdAt >= compactedAt;
    });
    if (firstPostCompactionIndex >= 0) {
      return firstPostCompactionIndex;
    }
    if (messages.length > 0) {
      return messages.length;
    }
  }

  if (
    typeof input.compactionDividerIndex === "number" &&
    Number.isFinite(input.compactionDividerIndex)
  ) {
    return clampDividerIndex(
      Math.floor(input.compactionDividerIndex),
      messages.length,
    );
  }

  return undefined;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_RECEIVED_INIT_STATE":
      return { ...state, receivedInitState: action.payload };
    case "SET_SESSION_ID": {
      const newId = action.payload;
      if (newId === state.currentSessionId) {
        return state;
      }
      const zeroStats = { input: 0, output: 0, read: 0, write: 0, duration: 0 };
      const statsForNew = newId
        ? (state.sessionsStatsById?.[newId] ?? zeroStats)
        : zeroStats;
      const queueForNew = newId
        ? getQueueForSession(state.queueBySessionId[newId], newId)
        : [];
      return {
        ...state,
        currentSessionId: action.payload,
        sessionStats: statsForNew,
        promptQueue: queueForNew,
        isCompacting: false,
        compactionError: undefined,
        lastCompactedAt: undefined,
        compactionBaselineStats: undefined,
        compactionDividerIndex: undefined,
        compactionDividerBeforeMessageId: undefined,
        compactionDividerAfterMessageId: undefined,
        compactedMessagesCollapsed: false,
      };
    }
    case "SET_SERVER_STATUS":
      return { ...state, serverStatus: action.payload };
    case "SET_SERVER_VERSION":
      return { ...state, serverVersion: action.payload };
    case "SET_SELECTED_MODEL":
      return { ...state, selectedModel: action.payload };
    case "SET_MODELS_LIST":
      return { ...state, availableModels: action.payload };
    case "SET_SELECTED_AGENT":
      return { ...state, selectedAgent: action.payload };
    case "SET_AGENTS_LIST":
      return { ...state, availableAgents: action.payload };
    case "SET_MESSAGES": {
      const resolvedDividerIndex = resolveCompactionDividerIndex(action.payload, {
        compactionDividerIndex: state.compactionDividerIndex,
        compactionDividerBeforeMessageId: state.compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId: state.compactionDividerAfterMessageId,
        lastCompactedAt: state.lastCompactedAt,
      });
      const resolvedAnchors =
        typeof resolvedDividerIndex === "number"
          ? resolveCompactionDividerAnchors(action.payload, resolvedDividerIndex)
          : {
              compactionDividerBeforeMessageId:
                state.compactionDividerBeforeMessageId,
              compactionDividerAfterMessageId: state.compactionDividerAfterMessageId,
            };
      return {
        ...state,
        messages: action.payload,
        compactionDividerIndex: resolvedDividerIndex,
        compactionDividerBeforeMessageId:
          resolvedAnchors.compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId:
          resolvedAnchors.compactionDividerAfterMessageId,
      };
    }
    case "CLEAR_MESSAGES":
      return { ...state, messages: [] };
    case "SET_PROCESSING":
      // When processing starts, create an empty streaming state so the StreamingCard is visible immediately
      // instead of showing the "Thinking..." bubble
      if (action.payload && (!state.streaming || !state.streaming.isActive)) {
        try {
          // Only create streaming state if we have valid model selection
          // Otherwise just set isProcessing and let stream events create the state
          const hasValidModel =
            state.selectedModel?.modelID && state.selectedModel?.providerID;

          if (!hasValidModel) {
            // No valid model yet, just set processing flag
            return { ...state, isProcessing: true };
          }

          const streamingState: StreamingState = {
            messageId: null,
            content: "",
            reasoning: "",
            reasoningEvents: [],
            steps: [],
            progressEvents: [],
            edits: [],
            isActive: true,
            agent: state.selectedAgent || undefined,
            model: {
              modelID: state.selectedModel!.modelID,
              providerID: state.selectedModel!.providerID,
            },
            modelID: state.selectedModel!.modelID,
            providerID: state.selectedModel!.providerID,
          };
          return {
            ...state,
            isProcessing: true,
            streaming: streamingState,
          };
        } catch (error) {
          // If creating streaming state fails, just set processing without it
          console.error("Error creating streaming state:", error);
          return { ...state, isProcessing: true };
        }
      }
      // When processing ends, keep the latest streaming snapshot visible until
      // messageResponse/chatHistory explicitly clears it. This prevents the
      // streamed assistant content from disappearing between finish and finalize.
      if (!action.payload) {
        return { ...state, isProcessing: false, isSteering: false };
      }
      return { ...state, isProcessing: action.payload };
    case "SET_STEERING":
      return { ...state, isSteering: action.payload };
    case "SET_SESSIONS_LIST":
      return { ...state, sessionsList: action.payload };
    case "ADD_SESSION_EDIT": {
      const edits = new Set(state.sessionEdits);
      edits.add(action.payload);
      return { ...state, sessionEdits: edits };
    }
    case "CLEAR_SESSION_EDITS":
      return { ...state, sessionEdits: new Set<string>() };
    case "UPDATE_SESSION_STATS":
      return {
        ...state,
        sessionStats: { ...state.sessionStats, ...action.payload },
      };
    case "RESET_SESSION_STATS": {
      const next = action.payload ?? {
        input: 0,
        output: 0,
        read: 0,
        write: 0,
        duration: 0,
      };
      const sessionsStatsById = { ...state.sessionsStatsById };
      if (state.currentSessionId) {
        sessionsStatsById[state.currentSessionId] = next;
      }
      return {
        ...state,
        sessionStats: next,
        sessionsStatsById,
      };
    }
    case "ACCUMULATE_SESSION_STATS": {
      const merged = mergeStats(state.sessionStats, action.payload);
      const sessionsStatsById = { ...state.sessionsStatsById };
      if (state.currentSessionId) {
        sessionsStatsById[state.currentSessionId] = merged;
      }
      return { ...state, sessionStats: merged, sessionsStatsById };
    }
    case "SET_STREAMING":
      return action.payload
        ? {
            ...state,
            streaming: {
              ...action.payload,
              reasoningEvents: action.payload.reasoningEvents ?? [],
              progressEvents: action.payload.progressEvents ?? [],
            },
          }
        : { ...state, streaming: null };
    case "UPDATE_STREAMING_CONTENT": {
      if (!state.streaming) {
        return state;
      }
      const content = action.payload.append
        ? `${state.streaming.content}${action.payload.content}`
        : action.payload.content;
      // Record the first moment non-empty content arrives so the timeline can order it correctly
      const contentStartSeq =
        state.streaming.contentStartSeq !== undefined
          ? state.streaming.contentStartSeq
          : content.trim().length > 0
            ? Date.now()
            : undefined;
      return {
        ...state,
        streaming: { ...state.streaming, content, contentStartSeq },
      };
    }
    case "UPDATE_STREAMING_REASONING": {
      if (!state.streaming) {
        return state;
      }
      const reasoning = action.payload.append
        ? appendStreamingReasoning(
            state.streaming.reasoning,
            action.payload.reasoning,
          )
        : action.payload.reasoning;
      const chunk = action.payload.reasoning.trim();
      const reasoningEvents =
        chunk.length > 0
          ? appendWithCap(
              state.streaming.reasoningEvents,
              { text: chunk, createdAt: Date.now() },
              MAX_STREAMING_REASONING_EVENTS,
            )
          : state.streaming.reasoningEvents;
      return {
        ...state,
        streaming: { ...state.streaming, reasoning, reasoningEvents },
      };
    }
    case "ADD_STREAMING_STEP": {
      if (!state.streaming) {
        return state;
      }
      const stampedStep = { ...action.payload, streamSeq: Date.now() };
      return {
        ...state,
        streaming: {
          ...state.streaming,
          steps: appendWithCap(
            state.streaming.steps,
            stampedStep,
            MAX_STREAMING_STEPS,
          ),
          progressEvents: appendWithCap(
            state.streaming.progressEvents,
            { ...stampedStep },
            MAX_STREAMING_PROGRESS_EVENTS,
          ),
        },
      };
    }
    case "UPDATE_STREAMING_STEP": {
      if (!state.streaming) {
        return state;
      }
      const idx =
        typeof action.payload.index === "number"
          ? action.payload.index
          : state.streaming.steps.findIndex(
              (step) =>
                (action.payload.id && step.id === action.payload.id) ||
                (action.payload.callID &&
                  step.callID === action.payload.callID),
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
          progressEvents: appendWithCap(
            state.streaming.progressEvents,
            { ...steps[idx] },
            MAX_STREAMING_PROGRESS_EVENTS,
          ),
        },
      };
    }
    case "ADD_STREAMING_EDIT": {
      if (!state.streaming) {
        return state;
      }
      if (state.streaming.edits.includes(action.payload)) {
        return state;
      }
      return {
        ...state,
        streaming: {
          ...state.streaming,
          edits: appendWithCap(
            state.streaming.edits,
            action.payload,
            MAX_STREAMING_EDITS,
          ),
        },
      };
    }
    case "FINISH_STREAMING": {
      if (!state.streaming) {
        return state;
      }
      return {
        ...state,
        streaming: {
          ...state.streaming,
          isActive: false,
          usage: action.payload?.usage ?? state.streaming.usage,
        },
      };
    }
    case "SET_INPUT_VALUE":
      return { ...state, inputValue: action.payload };
    case "SET_FILE_SUGGESTIONS":
      return { ...state, fileSuggestions: action.payload };
    case "SET_SHOW_FILE_SUGGESTIONS":
      return { ...state, showFileSuggestions: action.payload };
    case "SET_SUGGESTION_INDEX":
      return { ...state, selectedSuggestionIndex: action.payload };
    case "SET_COMMANDS_LIST":
      return {
        ...state,
        availableCommands: action.payload,
        commandsLoaded: true,
      };
    case "SET_SELECTED_FILES":
      return { ...state, selectedFiles: action.payload };
    case "SET_SELECTED_CONTEXTS":
      return { ...state, selectedContexts: action.payload };
    case "SET_QUEUE": {
      const targetSessionId = action.payload.sessionId;
      if (!targetSessionId) {
        return state;
      }
      const sessionQueue = getQueueForSession(action.payload.queue, targetSessionId);

      const nextBySession = { ...state.queueBySessionId };
      if (sessionQueue.length > 0) {
        nextBySession[targetSessionId] = sessionQueue;
      } else {
        delete nextBySession[targetSessionId];
      }

      return {
        ...state,
        queueBySessionId: nextBySession,
        promptQueue:
          state.currentSessionId === targetSessionId
            ? sessionQueue
            : state.promptQueue,
      };
    }
    case "SET_EXECUTING_QUEUE":
      return { ...state, isExecutingQueue: action.payload };
    case "SET_QUEUE_OPEN":
      return { ...state, isQueueOpen: action.payload };
    case "SET_SIDEBAR_OPEN":
      return { ...state, isSidebarOpen: action.payload };
    case "SET_MODEL_DROPDOWN_OPEN":
      return { ...state, modelDropdownOpen: action.payload };
    case "SET_AGENT_DROPDOWN_OPEN":
      return { ...state, agentDropdownOpen: action.payload };
    case "SET_THINKING_DROPDOWN_OPEN":
      return { ...state, thinkingDropdownOpen: action.payload };
    case "SET_COMPACTION_STATUS":
      if (action.payload.status !== "done") {
        return {
          ...state,
          isCompacting: action.payload.status === "running",
          compactionError:
            action.payload.status === "error"
              ? action.payload.error ?? "Session compaction failed."
              : undefined,
        };
      }
      {
        const nextLastCompactedAt = action.payload.at ?? Date.now();
        const resolvedDividerIndex = resolveCompactionDividerIndex(state.messages, {
          compactionDividerIndex: action.payload.compactionDividerIndex,
          compactionDividerBeforeMessageId:
            action.payload.compactionDividerBeforeMessageId,
          compactionDividerAfterMessageId:
            action.payload.compactionDividerAfterMessageId,
          lastCompactedAt: nextLastCompactedAt,
        });
        const derivedAnchors =
          typeof resolvedDividerIndex === "number"
            ? resolveCompactionDividerAnchors(state.messages, resolvedDividerIndex)
            : {
                compactionDividerBeforeMessageId:
                  action.payload.compactionDividerBeforeMessageId,
                compactionDividerAfterMessageId:
                  action.payload.compactionDividerAfterMessageId,
              };
        return {
          ...state,
          isCompacting: false,
          lastCompactedAt: nextLastCompactedAt,
          compactionError: undefined,
          compactionBaselineStats:
            action.payload.baselineStats ?? state.sessionStats,
          compactionDividerIndex: resolvedDividerIndex,
          compactionDividerBeforeMessageId:
            action.payload.compactionDividerBeforeMessageId ??
            derivedAnchors.compactionDividerBeforeMessageId,
          compactionDividerAfterMessageId:
            action.payload.compactionDividerAfterMessageId ??
            derivedAnchors.compactionDividerAfterMessageId,
          compactedMessagesCollapsed: action.payload.collapsed ?? true,
        };
      }
    case "SET_COMPACTION_VIEW_STATE": {
      const nextLastCompactedAt =
        typeof action.payload.lastCompactedAt === "number"
          ? action.payload.lastCompactedAt
          : state.lastCompactedAt;
      const nextBeforeId =
        action.payload.compactionDividerBeforeMessageId ??
        state.compactionDividerBeforeMessageId;
      const nextAfterId =
        action.payload.compactionDividerAfterMessageId ??
        state.compactionDividerAfterMessageId;
      const resolvedDividerIndex = resolveCompactionDividerIndex(state.messages, {
        compactionDividerIndex:
          typeof action.payload.compactionDividerIndex === "number"
            ? action.payload.compactionDividerIndex
            : state.compactionDividerIndex,
        compactionDividerBeforeMessageId: nextBeforeId,
        compactionDividerAfterMessageId: nextAfterId,
        lastCompactedAt: nextLastCompactedAt,
      });
      const derivedAnchors =
        typeof resolvedDividerIndex === "number"
          ? resolveCompactionDividerAnchors(state.messages, resolvedDividerIndex)
          : {
              compactionDividerBeforeMessageId: nextBeforeId,
              compactionDividerAfterMessageId: nextAfterId,
            };
      return {
        ...state,
        lastCompactedAt: nextLastCompactedAt,
        compactionBaselineStats:
          action.payload.baselineStats ?? state.compactionBaselineStats,
        compactionDividerIndex: resolvedDividerIndex,
        compactionDividerBeforeMessageId:
          action.payload.compactionDividerBeforeMessageId ??
          derivedAnchors.compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId:
          action.payload.compactionDividerAfterMessageId ??
          derivedAnchors.compactionDividerAfterMessageId,
        compactedMessagesCollapsed:
          typeof action.payload.collapsed === "boolean"
            ? action.payload.collapsed
            : state.compactedMessagesCollapsed,
      };
    }
    case "SET_COMPACTED_MESSAGES_COLLAPSED":
      return { ...state, compactedMessagesCollapsed: action.payload };
    case "SET_MODEL_SEARCH":
      return { ...state, modelSearchQuery: action.payload };
    case "SET_AGENT_SEARCH":
      return { ...state, agentSearchQuery: action.payload };
    case "ADD_ERROR_MESSAGE":
      return {
        ...state,
        errorMessages: [...state.errorMessages, action.payload],
      };
    case "CLEAR_ERROR_MESSAGES":
      return { ...state, errorMessages: [] };
    case "SET_QUOTA_DATA":
      return { ...state, quotaData: action.payload, quotaIsRefreshing: false };
    case "SET_QUOTA_REFRESHING":
      return { ...state, quotaIsRefreshing: action.payload };
    case "ADD_ATTACHMENT": {
      return {
        ...state,
        attachments: [...(state.attachments || []), action.payload],
      };
    }
    case "REMOVE_ATTACHMENT": {
      return {
        ...state,
        attachments: (state.attachments || []).filter(
          (a) => a.id !== action.payload,
        ),
      };
    }
    case "CLEAR_ATTACHMENTS": {
      return { ...state, attachments: [] };
    }
    case "SET_THINKING_LEVEL": {
      return { ...state, thinkingLevel: action.payload };
    }
    case "SET_TODO_ITEMS": {
      return { ...state, todoItems: action.payload };
    }
    case "UPDATE_TODO_ITEM": {
      const items = (state.todoItems || []).map((it) =>
        it.id === action.payload.id ? { ...it, ...action.payload.patch } : it,
      );
      return { ...state, todoItems: items };
    }
    case "ADD_TODO_ITEM": {
      return {
        ...state,
        todoItems: [...(state.todoItems || []), action.payload],
      };
    }
    case "UPSERT_SUBAGENT_SUMMARIES": {
      return {
        ...state,
        subagentsByParentMessageId: {
          ...state.subagentsByParentMessageId,
          ...action.payload,
        },
      };
    }
    case "UPSERT_SUBAGENT_DETAIL": {
      return {
        ...state,
        subagentDetailsById: {
          ...state.subagentDetailsById,
          ...action.payload,
        },
      };
    }
    case "SELECT_SUBAGENT": {
      return { ...state, selectedSubagentId: action.payload };
    }
    case "SET_SUBAGENTS_PANEL_OPEN": {
      return { ...state, subagentsPanelOpen: action.payload };
    }
    case "CLEAR_SUBAGENTS_FOR_SESSION": {
      return {
        ...state,
        subagentsByParentMessageId: {},
        subagentDetailsById: {},
        selectedSubagentId: null,
      };
    }
    case "SET_INTERACTIVE_EVENTS": {
      return { ...state, interactiveEvents: action.payload };
    }
    case "DISMISS_INTERACTIVE_EVENT": {
      return {
        ...state,
        interactiveEvents: state.interactiveEvents.filter(
          (event) => event.id !== action.payload,
        ),
      };
    }
    case "SET_BUDGET_INFO":
      return { ...state, budgetInfo: action.payload };
    case "SET_MCP_SERVERS":
      return { ...state, mcpServers: action.payload };
    case "SET_LSP_SERVERS":
      return { ...state, lspServers: action.payload };
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
