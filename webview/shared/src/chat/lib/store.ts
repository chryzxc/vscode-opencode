import React, { createContext, useContext, useMemo, useReducer } from 'react';

import type {
  Agent,
  AppState,
  AttachmentItem,
  InteractiveEvent,
  LspServerInfo,
  McpServerInfo,
  ThinkingLevel,
  TodoItem,
  ContextItem,
  FileResult,
  BudgetInfo,
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
  ConfigFile,
  ConfigFilesState,
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
  processingSessionIds: [],
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
  contextUsagePct: undefined,
  opencodeConfig: undefined,
  opencodeConfigSaveStatus: undefined,
  configFiles: undefined,
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
  | { type: "SET_PROCESSING_SESSIONS"; payload: string[] }
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
  | { type: "SET_SERVER_VERSION"; payload: string | undefined }
  | { type: "SET_CONTEXT_USAGE_PCT"; payload: number | undefined }
  | { type: "SET_OPENCODE_CONFIG"; payload: AppState["opencodeConfig"] }
  | {
    type: "SET_OPENCODE_CONFIG_SAVE_STATUS";
    payload: AppState["opencodeConfigSaveStatus"];
  }
  | {
    type: "SET_CONFIG_FILES_LIST";
    payload: { files: ConfigFile[]; error?: string };
  }
  | {
    type: "SET_CONFIG_FILE_SAVED";
    payload: { filePath: string; success: boolean; error?: string };
  };

function mergeStats(current: SessionStats, next: SessionStats): SessionStats {
  return {
    input: current.input + next.input,
    output: current.output + next.output,
    read: current.read + next.read,
    write: current.write + next.write,
    duration: current.duration + next.duration
  };
}

function asRecordLocal(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringLocal(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return "";
}

function normalizeComparableTextLocal(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function getMessageRoleForCanonical(message: Message): string {
  const info = asRecordLocal(message.info);
  return asStringLocal(message.role, info?.role).toLowerCase();
}

function getMessageIdForCanonical(message: Message): string {
  const info = asRecordLocal(message.info);
  return asStringLocal(info?.id, message.id);
}

function getMessageCreatedAtForCanonical(message: Message): number | undefined {
  const rec = asRecordLocal(message);
  const info = asRecordLocal(message.info);
  const infoTime = asRecordLocal(info?.time);
  const messageTime = asRecordLocal(rec?.time);
  const candidates = [
    messageTime?.created,
    infoTime?.created,
    rec?.createdAt,
    info?.createdAt,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function extractMessageTextForCanonical(message: Message): string {
  const rec = asRecordLocal(message);
  if (!rec) {
    return "";
  }
  const direct = asStringLocal(rec.content, rec.text);
  if (direct) {
    return direct;
  }
  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const textParts: string[] = [];
  for (const part of parts) {
    const partRec = asRecordLocal(part);
    if (!partRec) {
      continue;
    }
    const partType = asStringLocal(partRec.type).toLowerCase();
    const partText = asStringLocal(
      partRec.text,
      partRec.content,
      partRec.delta,
      partRec.reasoning,
      partRec.thought,
      partRec.thinking,
    );
    if (!partText) {
      continue;
    }
    if (partType === "text" || partType === "reasoning" || !partType) {
      textParts.push(partText);
    }
  }
  return textParts.join("\n").trim();
}

function isInternalTransportReminderMessage(message: Message): boolean {
  const role = getMessageRoleForCanonical(message);
  if (role !== "user" && role !== "system") {
    return false;
  }
  const normalizedText = normalizeComparableTextLocal(
    extractMessageTextForCanonical(message),
  );
  if (!normalizedText) {
    return false;
  }
  return (
    normalizedText.includes("<system-reminder>") ||
    normalizedText.includes("<!-- omo_internal_initiator -->") ||
    normalizedText.includes("[background task completed]") ||
    normalizedText.includes("[all background tasks complete]") ||
    normalizedText.includes("background_output(task_id=")
  );
}

function hasAssistantPayloadForCanonical(message: Message): boolean {
  const rec = asRecordLocal(message);
  if (!rec) {
    return false;
  }
  if (
    asRecordLocal(rec.plan) ||
    asRecordLocal(rec.structuredOutput) ||
    asRecordLocal((rec.info as Record<string, unknown> | undefined)?.structuredOutput)
  ) {
    return true;
  }
  if (asStringLocal(rec.error)) {
    return true;
  }
  const listFields = [
    rec.parts,
    rec.reasoningEvents,
    rec.progressEvents,
    rec.steps,
    rec.edits,
    rec.interactiveEvents,
    rec.subagents,
  ];
  return listFields.some((value) => Array.isArray(value) && value.length > 0);
}

function isAssistantMessageForCanonical(message: Message): boolean {
  const role = getMessageRoleForCanonical(message);
  if (role === "assistant") {
    return true;
  }
  if (role === "user") {
    return false;
  }
  return hasAssistantPayloadForCanonical(message);
}

function messageRichnessScoreForCanonical(message: Message): number {
  const rec = asRecordLocal(message);
  if (!rec) {
    return 0;
  }
  let score = Math.min(extractMessageTextForCanonical(message).length, 400);
  const listWeights: Array<[unknown, number]> = [
    [rec.parts, 4],
    [rec.steps, 6],
    [rec.progressEvents, 8],
    [rec.reasoningEvents, 6],
    [rec.interactiveEvents, 20],
    [rec.subagents, 20],
    [rec.edits, 6],
  ];
  for (const [value, weight] of listWeights) {
    if (Array.isArray(value)) {
      score += value.length * weight;
    }
  }
  if (asRecordLocal(rec.plan)) {
    score += 40;
  }
  if (asRecordLocal(rec.structuredOutput)) {
    score += 30;
  }
  if (asStringLocal(rec.error)) {
    score += 5;
  }
  if (getMessageIdForCanonical(message)) {
    score += 20;
  }
  return score;
}

function dedupeMirrorMessagesForCanonical(messages: Message[]): Message[] {
  const deduped: Message[] = [];
  for (const message of messages) {
    const id = getMessageIdForCanonical(message);
    if (id) {
      const existingById = deduped.findIndex(
        (entry) => getMessageIdForCanonical(entry) === id,
      );
      if (existingById >= 0) {
        const existing = deduped[existingById];
        deduped[existingById] =
          messageRichnessScoreForCanonical(message) >=
            messageRichnessScoreForCanonical(existing)
            ? message
            : existing;
        continue;
      }
    }

    const role = getMessageRoleForCanonical(message);
    const normalizedText = normalizeComparableTextLocal(
      extractMessageTextForCanonical(message),
    );
    if (normalizedText && (role === "user" || role === "assistant")) {
      const existingByText = deduped.findIndex((entry) => {
        if (getMessageRoleForCanonical(entry) !== role) {
          return false;
        }
        const entryText = normalizeComparableTextLocal(
          extractMessageTextForCanonical(entry),
        );
        if (entryText !== normalizedText) {
          return false;
        }
        const createdA = getMessageCreatedAtForCanonical(entry);
        const createdB = getMessageCreatedAtForCanonical(message);
        if (
          typeof createdA === "number" &&
          typeof createdB === "number" &&
          Math.abs(createdA - createdB) > 4_000
        ) {
          return false;
        }
        return true;
      });
      if (existingByText >= 0) {
        const existing = deduped[existingByText];
        deduped[existingByText] =
          messageRichnessScoreForCanonical(message) >=
            messageRichnessScoreForCanonical(existing)
            ? message
            : existing;
        continue;
      }
    }

    deduped.push(message);
  }
  return deduped;
}

function isTextLikePartForCanonical(part: unknown): boolean {
  const rec = asRecordLocal(part);
  if (!rec) {
    return false;
  }
  const type = asStringLocal(rec.type).toLowerCase();
  if (type === "text") {
    return true;
  }
  return (
    typeof rec.text === "string" ||
    typeof rec.content === "string" ||
    typeof rec.delta === "string"
  );
}

function partFingerprintForCanonical(part: unknown): string {
  const rec = asRecordLocal(part);
  if (!rec) {
    return "unknown";
  }
  const state = asRecordLocal(rec.state);
  return [
    asStringLocal(rec.type).toLowerCase() || "unknown",
    asStringLocal(rec.callID, rec.callId),
    asStringLocal(rec.tool),
    asStringLocal(state?.status, rec.status),
    asStringLocal(state?.title, rec.title),
    asStringLocal(
      rec.filePath,
      asRecordLocal(state?.input)?.file,
      asRecordLocal(state?.input)?.path,
    ),
    asStringLocal(rec.text, rec.content, rec.delta, rec.reasoning).slice(0, 160),
  ].join("|");
}

function stepFingerprintForCanonical(step: unknown, fallbackIndex: number): string {
  const rec = asRecordLocal(step);
  if (!rec) {
    return `idx:${fallbackIndex}`;
  }
  return [
    asStringLocal(rec.id),
    asStringLocal(rec.callID, rec.callId),
    asStringLocal(rec.title),
    asStringLocal(rec.status),
    asStringLocal(rec.filePath),
    asStringLocal(rec.meta),
    typeof rec.streamSeq === "number" ? String(rec.streamSeq) : "",
    typeof rec.createdAt === "number" ? String(rec.createdAt) : "",
  ].join("|");
}

function reasoningFingerprintForCanonical(
  event: unknown,
  fallbackIndex: number,
): string {
  const rec = asRecordLocal(event);
  if (!rec) {
    return `idx:${fallbackIndex}`;
  }
  return [
    typeof rec.createdAt === "number" ? String(rec.createdAt) : "",
    asStringLocal(rec.text).slice(0, 240),
  ].join("|");
}

function editFingerprintForCanonical(edit: unknown, fallbackIndex: number): string {
  const rec = asRecordLocal(edit);
  if (!rec) {
    return `idx:${fallbackIndex}`;
  }
  return [
    asStringLocal(rec.file),
    typeof rec.added === "number" ? String(rec.added) : "",
    typeof rec.deleted === "number" ? String(rec.deleted) : "",
  ].join("|");
}

function appendUniqueEntries<T>(
  target: T[],
  incoming: T[],
  seen: Set<string>,
  keyBuilder: (entry: T, fallbackIndex: number) => string,
): void {
  incoming.forEach((entry, index) => {
    const key = keyBuilder(entry, target.length + index);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    target.push(entry);
  });
}

function coalesceAssistantRunForCanonical(run: Message[]): Message {
  const base = { ...(run[run.length - 1] || run[0]) } as Message;
  const mergedParts: unknown[] = [];
  const seenPartKeys = new Set<string>();
  const mergedSteps = Array.isArray(base.steps) ? [...base.steps] : [];
  const mergedProgressEvents = Array.isArray(base.progressEvents)
    ? [...base.progressEvents]
    : [];
  const mergedReasoningEvents = Array.isArray(base.reasoningEvents)
    ? [...base.reasoningEvents]
    : [];
  const mergedEdits = Array.isArray(base.edits) ? [...base.edits] : [];
  const seenStepKeys = new Set<string>();
  const seenProgressKeys = new Set<string>();
  const seenReasoningKeys = new Set<string>();
  const seenEditKeys = new Set<string>();
  let latestText = "";
  let latestTextPart: unknown;
  let latestInteractiveEvents = base.interactiveEvents;
  let latestPlan = base.plan;
  let latestSubagents = base.subagents;
  let latestError = asStringLocal((base as unknown as Record<string, unknown>).error);
  let latestRawResponse = (base as unknown as Record<string, unknown>).rawResponse;
  let latestStructuredOutput = asRecordLocal(
    (base as unknown as Record<string, unknown>).structuredOutput,
  );
  let canonicalId = getMessageIdForCanonical(base);

  mergedSteps.forEach((entry, entryIndex) => {
    seenStepKeys.add(stepFingerprintForCanonical(entry, entryIndex));
  });
  mergedProgressEvents.forEach((entry, entryIndex) => {
    seenProgressKeys.add(stepFingerprintForCanonical(entry, entryIndex));
  });
  mergedReasoningEvents.forEach((entry, entryIndex) => {
    seenReasoningKeys.add(reasoningFingerprintForCanonical(entry, entryIndex));
  });
  mergedEdits.forEach((entry, entryIndex) => {
    seenEditKeys.add(editFingerprintForCanonical(entry, entryIndex));
  });

  for (const message of run) {
    const messageId = getMessageIdForCanonical(message);
    if (messageId) {
      canonicalId = messageId;
    }
    const text = extractMessageTextForCanonical(message);
    if (text) {
      latestText = text;
      latestTextPart = Array.isArray(message.parts)
        ? message.parts.find((part) => isTextLikePartForCanonical(part))
        : undefined;
    }
    if (Array.isArray(message.interactiveEvents) && message.interactiveEvents.length > 0) {
      latestInteractiveEvents = message.interactiveEvents;
    }
    if (message.plan && typeof message.plan === "object") {
      latestPlan = message.plan;
    }
    if (Array.isArray(message.subagents) && message.subagents.length > 0) {
      latestSubagents = message.subagents;
    }
    if (typeof message.rawResponse === "string") {
      if (message.rawResponse.trim().length > 0) {
        latestRawResponse = message.rawResponse;
      }
    } else if (typeof message.rawResponse !== "undefined") {
      latestRawResponse = message.rawResponse;
    }
    const errorText = asStringLocal(
      (message as unknown as Record<string, unknown>).error,
    );
    if (errorText) {
      latestError = errorText;
    }
    const structured = asRecordLocal(
      (message as unknown as Record<string, unknown>).structuredOutput,
    );
    if (structured) {
      latestStructuredOutput = structured;
    }

    if (Array.isArray(message.parts)) {
      for (const part of message.parts) {
        if (isTextLikePartForCanonical(part)) {
          continue;
        }
        const key = partFingerprintForCanonical(part);
        if (seenPartKeys.has(key)) {
          continue;
        }
        seenPartKeys.add(key);
        mergedParts.push(part);
      }
    }
    if (Array.isArray(message.steps)) {
      appendUniqueEntries(
        mergedSteps,
        message.steps,
        seenStepKeys,
        stepFingerprintForCanonical,
      );
    }
    if (Array.isArray(message.progressEvents)) {
      appendUniqueEntries(
        mergedProgressEvents,
        message.progressEvents,
        seenProgressKeys,
        stepFingerprintForCanonical,
      );
    }
    if (Array.isArray(message.reasoningEvents)) {
      appendUniqueEntries(
        mergedReasoningEvents,
        message.reasoningEvents,
        seenReasoningKeys,
        reasoningFingerprintForCanonical,
      );
    }
    if (Array.isArray(message.edits)) {
      appendUniqueEntries(
        mergedEdits,
        message.edits,
        seenEditKeys,
        editFingerprintForCanonical,
      );
    }
  }

  if (latestText) {
    const sourcePart = asRecordLocal(latestTextPart) ?? {};
    mergedParts.push({
      ...sourcePart,
      type: "text",
      text: latestText,
    });
    base.content = latestText;
    (base as unknown as Record<string, unknown>).text = latestText;
  }
  if (mergedParts.length > 0) {
    base.parts = mergedParts as Message["parts"];
  }
  if (mergedSteps.length > 0) {
    base.steps = mergedSteps as Message["steps"];
  } else {
    delete (base as Record<string, unknown>).steps;
  }
  if (mergedProgressEvents.length > 0) {
    base.progressEvents = mergedProgressEvents as Message["progressEvents"];
  } else {
    delete (base as Record<string, unknown>).progressEvents;
  }
  if (mergedReasoningEvents.length > 0) {
    base.reasoningEvents = mergedReasoningEvents as Message["reasoningEvents"];
  } else {
    delete (base as Record<string, unknown>).reasoningEvents;
  }
  if (mergedEdits.length > 0) {
    base.edits = mergedEdits as Message["edits"];
  } else {
    delete (base as Record<string, unknown>).edits;
  }
  if (latestInteractiveEvents) {
    base.interactiveEvents = latestInteractiveEvents;
  }
  if (latestPlan) {
    base.plan = latestPlan;
  }
  if (latestSubagents) {
    base.subagents = latestSubagents;
  }
  if (latestError) {
    (base as unknown as Record<string, unknown>).error = latestError;
  }
  if (latestStructuredOutput) {
    (base as unknown as Record<string, unknown>).structuredOutput = latestStructuredOutput;
  }
  if (typeof latestRawResponse !== "undefined") {
    // Keep the latest available rawResponse when collapsing assistant bursts.
    // Canonicalization also runs for hydrated history, so removing this causes
    // "Raw Response (Debug)" to disappear after refresh/session reload.
    base.rawResponse = latestRawResponse;
  }
  if (canonicalId) {
    base.id = canonicalId;
    const info = asRecordLocal(base.info);
    base.info = info
      ? { ...info, id: canonicalId }
      : ({ id: canonicalId } as Record<string, unknown>);
  }
  return base;
}

function canonicalizeMessagesForRender(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const withoutInternalTransport = messages.filter(
    (message) => !isInternalTransportReminderMessage(message),
  );
  const deduped = dedupeMirrorMessagesForCanonical(withoutInternalTransport);
  const canonical: Message[] = [];
  let index = 0;

  while (index < deduped.length) {
    const current = deduped[index];
    if (!isAssistantMessageForCanonical(current)) {
      canonical.push(current);
      index += 1;
      continue;
    }
    const burst: Message[] = [current];
    let cursor = index + 1;
    while (cursor < deduped.length && isAssistantMessageForCanonical(deduped[cursor])) {
      burst.push(deduped[cursor]);
      cursor += 1;
    }
    canonical.push(
      burst.length === 1 ? current : coalesceAssistantRunForCanonical(burst),
    );
    index = cursor;
  }

  return canonical;
}

const MAX_STREAMING_REASONING_EVENTS = 300;
const MAX_STREAMING_STEPS = 400;
const MAX_STREAMING_PROGRESS_EVENTS = 1000;
const MAX_STREAMING_EDITS = 300;

const LIFECYCLE_RANK: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  failed: 2,
  cancelled: 2,
};

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function hasTodoPatchChanges(current: TodoItem, patch: Partial<TodoItem>): boolean {
  const keys = Object.keys(patch) as Array<keyof TodoItem>;
  for (const key of keys) {
    const nextValue = patch[key];
    if (typeof nextValue === 'undefined') {
      continue;
    }
    if (current[key] !== nextValue) {
      return true;
    }
  }
  return false;
}

function upsertTodoItemArray(items: TodoItem[] | undefined, incoming: TodoItem): TodoItem[] {
  const list = Array.isArray(items) ? [...items] : [];
  const idx = list.findIndex((it) => it.id === incoming.id);

  if (idx < 0) {
    // Insert new incoming item at end
    return [...list, incoming];
  }

  const current = list[idx];
  const currentRank = LIFECYCLE_RANK[current.status] ?? 0;
  const incomingRank = LIFECYCLE_RANK[incoming.status] ?? 0;

  // Terminal states are immutable
  if (isTerminalStatus(current.status)) {
    return list;
  }

  if (incomingRank > currentRank) {
    // Promote: merge fields from incoming (incoming wins)
    const merged: TodoItem = { ...current, ...incoming };
    const next = [...list];
    next[idx] = merged;
    return next;
  }

  if (incomingRank === currentRank) {
    // Same rank: if identical status -> idempotent no-op
    if (incoming.status === current.status) {
      return list;
    }
    // Same numeric rank but different status (e.g., completed vs failed) prefer existing
    return list;
  }

  // incomingRank < currentRank -> stale/out-of-order event -> ignore
  return list;
}

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
  if (/[([{$]/.test(prevChar)) {
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

function normalizeReasoningText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function reasoningFingerprint(value: string): string {
  return normalizeReasoningText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isDuplicateReasoningChunk(candidate: string, existing: string): boolean {
  const candidateNorm = normalizeReasoningText(candidate);
  const existingNorm = normalizeReasoningText(existing);
  if (!candidateNorm || !existingNorm) {
    return false;
  }
  if (candidateNorm === existingNorm) {
    return true;
  }

  const candidateFingerprint = reasoningFingerprint(candidateNorm);
  const existingFingerprint = reasoningFingerprint(existingNorm);
  if (!candidateFingerprint || !existingFingerprint) {
    return false;
  }
  if (candidateFingerprint === existingFingerprint) {
    return true;
  }

  if (candidateFingerprint.length < 32 || existingFingerprint.length < 32) {
    return false;
  }
  return (
    candidateFingerprint.includes(existingFingerprint) ||
    existingFingerprint.includes(candidateFingerprint)
  );
}

type ReasoningMergeResult = {
  reasoning: string;
  eventChunk?: string;
  replaceLastEvent?: boolean;
};

function mergeStreamingReasoning(
  current: string,
  incoming: string,
  append?: boolean,
): ReasoningMergeResult {
  const incomingChunk = incoming.trim();
  if (!append) {
    return {
      reasoning: incoming,
      eventChunk: incomingChunk || undefined,
      replaceLastEvent: false,
    };
  }
  if (!incomingChunk) {
    return { reasoning: current };
  }
  if (!current) {
    return { reasoning: incoming, eventChunk: incomingChunk };
  }

  const currentNorm = normalizeReasoningText(current);
  const incomingNorm = normalizeReasoningText(incoming);
  if (!currentNorm) {
    return { reasoning: incoming, eventChunk: incomingChunk };
  }
  if (!incomingNorm) {
    return { reasoning: current };
  }

  if (isDuplicateReasoningChunk(incomingNorm, currentNorm)) {
    if (incomingNorm.length > currentNorm.length) {
      return {
        reasoning: incoming,
        eventChunk: incomingChunk,
        replaceLastEvent: true,
      };
    }
    return { reasoning: current };
  }

  if (
    incomingNorm.length >= currentNorm.length + 16 &&
    incomingNorm.includes(currentNorm)
  ) {
    return {
      reasoning: incoming,
      eventChunk: incomingChunk,
      replaceLastEvent: true,
    };
  }

  return {
    reasoning: appendStreamingReasoning(current, incoming),
    eventChunk: incomingChunk,
    replaceLastEvent: false,
  };
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
        isExecutingQueue: false,
        isQueueOpen: false,
        // Reset all transient per-session processing/streaming UI so states from
        // the previous session do not bleed into the newly active one.
        isProcessing: false,
        isSteering: false,
        streaming: null,
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
    case "SET_PROCESSING_SESSIONS":
      return { ...state, processingSessionIds: action.payload };
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
      const canonicalMessages = canonicalizeMessagesForRender(action.payload);
      const resolvedDividerIndex = resolveCompactionDividerIndex(canonicalMessages, {
        compactionDividerIndex: state.compactionDividerIndex,
        compactionDividerBeforeMessageId: state.compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId: state.compactionDividerAfterMessageId,
        lastCompactedAt: state.lastCompactedAt,
      });
      const resolvedAnchors =
        typeof resolvedDividerIndex === "number"
          ? resolveCompactionDividerAnchors(canonicalMessages, resolvedDividerIndex)
          : {
            compactionDividerBeforeMessageId:
              state.compactionDividerBeforeMessageId,
            compactionDividerAfterMessageId: state.compactionDividerAfterMessageId,
          };
      return {
        ...state,
        messages: canonicalMessages,
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
      const merged = mergeStreamingReasoning(
        state.streaming.reasoning,
        action.payload.reasoning,
        action.payload.append,
      );
      const reasoning = merged.reasoning;
      const chunk = merged.eventChunk?.trim() ?? "";
      let reasoningEvents = state.streaming.reasoningEvents;
      if (chunk.length > 0) {
        const lastEvent =
          reasoningEvents.length > 0
            ? reasoningEvents[reasoningEvents.length - 1]
            : undefined;
        if (
          lastEvent &&
          (merged.replaceLastEvent ||
            isDuplicateReasoningChunk(chunk, lastEvent.text))
        ) {
          reasoningEvents = [
            ...reasoningEvents.slice(0, -1),
            { ...lastEvent, text: chunk },
          ];
        } else {
          reasoningEvents = appendWithCap(
            reasoningEvents,
            { text: chunk, createdAt: Date.now() },
            MAX_STREAMING_REASONING_EVENTS,
          );
        }
      }
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
          // Use the explicit baseline supplied by the backend.  Do NOT fall
          // back to state.sessionStats: after compaction the server replaces
          // old messages with a summary, so subtracting pre-compact stats
          // from the (now much smaller) sessionStats would give 0.
          compactionBaselineStats:
            action.payload.baselineStats ?? undefined,
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
      // Map-based patch path: preserve existing behaviour for non-status patches
      // while enforcing lifecycle rank rules for status changes.
      let changed = false;
      const items = (state.todoItems || []).map((it) => {
        if (it.id !== action.payload.id) {
          return it;
        }

        const patch = action.payload.patch;
        const incomingStatus = patch.status ?? it.status;
        const currentRank = LIFECYCLE_RANK[it.status] ?? 0;
        const incomingRank = LIFECYCLE_RANK[incomingStatus] ?? 0;

        // If existing is terminal, ignore any status change and keep existing
        if (isTerminalStatus(it.status) && incomingStatus !== it.status) {
          return it;
        }

        if (typeof patch.status === 'string') {
          if (incomingRank > currentRank) {
            const promoted = { ...it, ...patch };
            if (hasTodoPatchChanges(it, promoted)) {
              changed = true;
            }
            return promoted;
          }
          if (incomingRank === currentRank) {
            if (incomingStatus === it.status) {
              const { status: _ignoredStatus, ...rest } = patch;
              if (!hasTodoPatchChanges(it, rest)) {
                return it;
              }
              changed = true;
              return { ...it, ...rest };
            }
            // same numeric rank but different status -> prefer existing
            return it;
          }
          // incomingRank < currentRank -> stale
          return it;
        }

        // No status in patch: apply patch to non-status fields
        if (!hasTodoPatchChanges(it, patch)) {
          return it;
        }
        changed = true;
        return { ...it, ...patch };
      });
      return changed ? { ...state, todoItems: items } : state;
    }
    case "ADD_TODO_ITEM": {
      // Preserve legacy append pattern while also handling idempotent upsert
      const current = state.todoItems || [];
      const idx = current.findIndex((it) => it.id === action.payload.id);
      if (idx >= 0) {
        // Existing item found -> apply lifecycle rank rules
        const existing = current[idx];
        const currentRank = LIFECYCLE_RANK[existing.status] ?? 0;
        const incomingRank = LIFECYCLE_RANK[action.payload.status] ?? 0;

        if (isTerminalStatus(existing.status)) {
          return state;
        }

        if (incomingRank > currentRank) {
          const next = [...current];
          next[idx] = { ...existing, ...action.payload };
          return { ...state, todoItems: next };
        }

        if (incomingRank === currentRank) {
          if (action.payload.status === existing.status) {
            // idempotent
            return state;
          }
          return state; // prefer existing on same-rank but different status
        }

        // incomingRank < currentRank -> stale
        return state;
      }

      // Append new item (legacy append pattern)
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
    case "SET_CONTEXT_USAGE_PCT":
      return { ...state, contextUsagePct: action.payload };
    case "SET_OPENCODE_CONFIG":
      return {
        ...state,
        opencodeConfig: {
          ...action.payload,
          files: action.payload.files || [],
        },
      };
    case "SET_OPENCODE_CONFIG_SAVE_STATUS":
      return { ...state, opencodeConfigSaveStatus: action.payload };
    case "SET_CONFIG_FILES_LIST": {
      const configFilesState: ConfigFilesState = {
        files: action.payload.files,
        activeFileName: null,
        isSaving: false,
        globalError: action.payload.error || "",
      };
      return { ...state, configFiles: configFilesState };
    }
    case "SET_CONFIG_FILE_SAVED": {
      if (!state.configFiles) return state;

      if (action.payload.success) {
        return {
          ...state,
          configFiles: {
            ...state.configFiles,
            isSaving: false,
            globalError: "",
          },
        };
      } else {
        return {
          ...state,
          configFiles: {
            ...state.configFiles,
            isSaving: false,
            globalError: action.payload.error || "Failed to save config file",
          },
        };
      }
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
