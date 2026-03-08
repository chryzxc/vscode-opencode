import type { Dispatch } from 'react';

import type { AppAction } from './store';
import type {
  AppState,
  BudgetInfo,
  ContextItem,
  FileResult,
  InteractiveChoice,
  InteractiveEvent,
  LspServerInfo,
  McpServerInfo,
  McpServerStatus,
  Message,
  QueueItem,
  QuotaData,
  Session,
  StreamingState,
  StreamingStep,
  SubagentDetail,
  SubagentSummary,
  SubagentReference,
  SubagentThinkingEvent,
  SubagentProgressEvent,
  SubagentTimelineEvent,
} from "./types";
import {
  sanitizeStructuredOutput,
  validateStructuredOutput,
} from "./structuredOutputValidator";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(guard);
}

function asRichString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => asRichString(item)).join('');
  }
  const rec = asRecord(value);
  if (!rec) {
    return '';
  }

  const candidates = [rec.value, rec.text, rec.content, rec.delta];
  for (const candidate of candidates) {
    const text = asRichString(candidate);
    if (text) {
      return text;
    }
  }

  return '';
}

function isOpaqueIdLike(value: string): boolean {
  const text = value.trim();
  if (text.length < 8) {
    return false;
  }
  return (
    /^[a-f0-9-]{8,}$/i.test(text) ||
    /^msg[_-][a-z0-9-]+$/i.test(text) ||
    /^call[_-][a-z0-9-]+$/i.test(text)
  );
}

function sanitizeReasoningChunk(value: string): string {
  const text = value.trim();
  if (!text || isOpaqueIdLike(text)) {
    return '';
  }
  return value;
}

type StructuredProgressUpdate = {
  title: string;
  status?: 'pending' | 'done' | 'error';
  meta?: string;
  filePath?: string;
};

function normalizeProgressStatus(
  value?: string | null,
): "pending" | "done" | "error" {
  const v = value?.toLowerCase();
  if (
    v === "done" ||
    v === "completed" ||
    v === "success" ||
    v === "finished" ||
    v === "complete"
  ) {
    return "done";
  }
  if (v === "error" || v === "failed") {
    return "error";
  }
  return "pending";
}

type StructuredInteractiveEvent = {
  type: 'question' | 'confirm' | 'quick_actions';
  id?: string;
  title?: string;
  question?: string;
  options?: InteractiveChoice[];
  actions?: InteractiveChoice[];
  confirmLabel?: string;
  cancelLabel?: string;
  multiSelect?: boolean;
  allowCustomInput?: boolean;
};

type StructuredSubagent = {
  id: string;
  name?: string;
  status?: string;
  progress?: number;
  description?: string;
  latestActivity?: string;
  childSessionId?: string;
  parentSessionId?: string;
  parentMessageId?: string;
  thinkingEvents?: SubagentThinkingEvent[];
  progressEvents?: SubagentProgressEvent[];
  timelineEvents?: SubagentTimelineEvent[];
};

type StructuredOutput = {
  responseType?: string;
  message?: string;
  reasoning?: string[];
  progressUpdates?: StructuredProgressUpdate[];
  interactiveEvents?: StructuredInteractiveEvent[];
  subagents?: StructuredSubagent[];
  subagentsDelta?: {
    parentMessageId?: string;
    items: StructuredSubagent[];
  };
};

function normalizeStructuredOutput(value: unknown): StructuredOutput | undefined {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
  const rec = asRecord(candidate);
  if (!rec) {
    return undefined;
  }
  const validation = validateStructuredOutput(rec);
  if (!validation.valid) {
    console.warn("Structured output validation failed", validation.errors);
  }
  const sanitizedRec = sanitizeStructuredOutput(rec);

  const responseType =
    asString(sanitizedRec.responseType) || asString(rec.type) || asString(rec.kind) || undefined;
  const message =
    asString(sanitizedRec.message) ||
    asString(rec.output) ||
    asString(rec.answer) ||
    asString(rec.content) ||
    asString(rec.text) ||
    undefined;

  const reasoningRaw =
    sanitizedRec.reasoning ?? rec.thinking ?? rec.thoughts;
  const reasoning = Array.isArray(reasoningRaw)
    ? reasoningRaw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : typeof reasoningRaw === 'string' && reasoningRaw.trim()
      ? [reasoningRaw.trim()]
      : [];

  const progressRaw =
    sanitizedRec.progressUpdates ?? (rec.progress_updates as unknown);
  const progressUpdates = Array.isArray(progressRaw)
    ? progressRaw
      .map((item) => {
        const step = asRecord(item);
        if (!step) {
          return undefined;
        }
        const title = asString(step.title) || asString(step.message);
        if (!title) {
          return undefined;
        }
        const statusValue = asString(step.status);
        const status = normalizeProgressStatus(statusValue);
        return {
          title,
          status,
          meta: asString(step.meta) || asString(step.detail) || undefined,
          filePath:
            asString(step.filePath) ||
            asString(step.file) ||
            asString(step.path) ||
            undefined
        } as StructuredProgressUpdate;
      })
      .filter((step): step is StructuredProgressUpdate => !!step)
    : [];

  const normalizeChoices = (raw: unknown): InteractiveChoice[] => {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        const option = asRecord(item);
        if (!option) {
          return null;
        }
        const label = asString(option.label) || asString(option.value);
        if (!label) {
          return null;
        }
        return {
          id: asString(option.id) || undefined,
          label,
          value: asString(option.value) || label,
          description: asString(option.description) || asString(option.detail) || undefined
        } as InteractiveChoice;
      })
      .filter((item): item is InteractiveChoice => !!item);
  };

  const normalizeInteractiveEvent = (
    raw: unknown,
    index: number
  ): StructuredInteractiveEvent | undefined => {
    const event = asRecord(raw);
    if (!event) {
      return undefined;
    }
    const typeRaw = (asString(event.type) || asString(event.kind)).toLowerCase();
    const id = asString(event.id) || `interactive-${Date.now()}-${index}`;

    if (typeRaw === 'confirm') {
      const question = asString(event.question) || asString(event.prompt) || asString(event.message);
      if (!question) {
        return undefined;
      }
      return {
        type: 'confirm',
        id,
        title: asString(event.title) || undefined,
        question,
        confirmLabel: asString(event.confirmLabel) || asString(event.confirm_text) || undefined,
        cancelLabel: asString(event.cancelLabel) || asString(event.cancel_text) || undefined
      };
    }

    if (typeRaw === 'quick_actions' || typeRaw === 'quick-actions') {
      const actions = normalizeChoices(event.actions ?? event.options);
      if (actions.length === 0) {
        return undefined;
      }
      return {
        type: 'quick_actions',
        id,
        title: asString(event.title) || asString(event.question) || undefined,
        actions
      };
    }

    if (typeRaw === 'question' || typeRaw === 'interactive') {
      const question = asString(event.question) || asString(event.prompt) || asString(event.title);
      const options = normalizeChoices(event.options ?? event.choices);
      if (!question || options.length === 0) {
        return undefined;
      }
      return {
        type: 'question',
        id,
        title: asString(event.title) || undefined,
        question,
        options,
        multiSelect: event.multiSelect === true,
        allowCustomInput: event.allowCustomInput === true
      };
    }

    return undefined;
  };

  const interactiveRaw =
    sanitizedRec.interactiveEvents ??
    rec.interactions ??
    rec.uiEvents ??
    rec.question ??
    rec.questions;
  const singleInteractive = normalizeInteractiveEvent(interactiveRaw, 0);
  let interactiveEvents = Array.isArray(interactiveRaw)
    ? interactiveRaw
      .map((event, index) => normalizeInteractiveEvent(event, index))
      .filter((event): event is StructuredInteractiveEvent => !!event)
    : singleInteractive
      ? [singleInteractive]
      : [];

  if (interactiveEvents.length === 0) {
    const rootQuestion = asString(rec.question) || asString(rec.prompt);
    const rootOptions = normalizeChoices(rec.options ?? rec.choices);
    if (rootQuestion && rootOptions.length > 0) {
      interactiveEvents = [
        {
          type: 'question',
          id: `interactive-${Date.now()}-0`,
          title: asString(rec.title) || undefined,
          question: rootQuestion,
          options: rootOptions,
          multiSelect: rec.multiSelect === true,
          allowCustomInput: rec.allowCustomInput === true
        }
      ];
    }
  }

  const subagentsRaw =
    sanitizedRec.subagents ?? (rec.spawnedSubagents as unknown);
  const subagents = Array.isArray(subagentsRaw)
      ? subagentsRaw
      .map((item): StructuredSubagent | null => {
        const subagent = asRecord(item);
        if (!subagent) {
          return null;
        }
        const id = asString(subagent.id);
        if (!id) {
          return null;
        }
        const normalizeStatus = (value: string): SubagentSummary['status'] => {
          const lowered = value.toLowerCase();
          if (lowered === 'running' || lowered === 'done' || lowered === 'error' || lowered === 'orphaned') {
            return lowered;
          }
          return 'pending';
        };
        return {
          id,
          name: asString(subagent.name) || asString(subagent.agentId) || undefined,
          status: asString(subagent.status) ? normalizeStatus(asString(subagent.status)) : undefined,
          progress: typeof subagent.progress === 'number' ? subagent.progress : undefined,
          description: asString(subagent.description) || undefined,
          latestActivity: asString(subagent.latestActivity) || asString(subagent.description) || undefined,
          childSessionId: asString(subagent.childSessionId) || undefined,
          parentSessionId: asString(subagent.parentSessionId) || undefined,
          parentMessageId: asString(subagent.parentMessageId) || undefined
        };
      })
      .filter(Boolean) as StructuredSubagent[]
    : [];

  const subagentsDeltaRaw = (rec.subagentsDelta ?? rec.subagents_delta) as
    | { parentMessageId?: unknown; items?: unknown }
    | undefined;
  const subagentsDelta =
    subagentsDeltaRaw &&
    Array.isArray(subagentsDeltaRaw.items)
      ? {
          parentMessageId: asString(subagentsDeltaRaw.parentMessageId) || undefined,
          items: subagentsDeltaRaw.items
            .map((item) => {
              const subagent = asRecord(item);
              if (!subagent) {
                return null;
              }
              const id = asString(subagent.id);
              if (!id) {
                return null;
              }
              return {
                id,
                name: asString(subagent.name) || asString(subagent.agentId) || undefined,
                status: asString(subagent.status) || undefined,
                progress: typeof subagent.progress === 'number' ? subagent.progress : undefined,
                description: asString(subagent.description) || undefined,
                latestActivity: asString(subagent.latestActivity) || asString(subagent.description) || undefined,
                childSessionId: asString(subagent.childSessionId) || undefined,
                parentSessionId: asString(subagent.parentSessionId) || undefined,
                parentMessageId: asString(subagent.parentMessageId) || undefined
              } as StructuredSubagent;
            })
            .filter(Boolean) as StructuredSubagent[]
        }
      : undefined;

  if (
    !responseType &&
    !message &&
    reasoning.length === 0 &&
    progressUpdates.length === 0 &&
    interactiveEvents.length === 0 &&
    subagents.length === 0
  ) {
    return undefined;
  }

  return {
    responseType,
    message,
    reasoning: reasoning.length > 0 ? reasoning : undefined,
    progressUpdates: progressUpdates.length > 0 ? progressUpdates : undefined,
    interactiveEvents: interactiveEvents.length > 0 ? interactiveEvents : undefined,
    subagents: subagents.length > 0 ? subagents : undefined,
    subagentsDelta
  };
}

function toInteractiveEvents(structured?: StructuredOutput): InteractiveEvent[] {
  const events = structured?.interactiveEvents ?? [];
  return events
    .map((event, index) => {
      const id = event.id || `interactive-${Date.now()}-${index}`;
      if (event.type === 'confirm') {
        if (!event.question) {
          return undefined;
        }
        return {
          type: 'confirm',
          id,
          title: event.title,
          question: event.question,
          confirmLabel: event.confirmLabel,
          cancelLabel: event.cancelLabel
        } as InteractiveEvent;
      }
      if (event.type === 'quick_actions') {
        const actions = Array.isArray(event.actions) ? event.actions : [];
        if (actions.length === 0) {
          return undefined;
        }
        return {
          type: 'quick_actions',
          id,
          title: event.title,
          actions
        } as InteractiveEvent;
      }
      if (event.type === 'question') {
        const options = Array.isArray(event.options) ? event.options : [];
        if (!event.question || options.length === 0) {
          return undefined;
        }
        return {
          type: 'question',
          id,
          title: event.title,
          question: event.question,
          options,
          multiSelect: event.multiSelect,
          allowCustomInput: event.allowCustomInput
        } as InteractiveEvent;
      }
      return undefined;
    })
    .filter((event): event is InteractiveEvent => !!event);
}

function inferredStepTitle(part: UnknownRecord): string {
  const title = asString(part.title).trim();
  if (title) {
    return title;
  }

  const snapshot = asString(part.snapshot).trim();
  if (
    snapshot &&
    snapshot.length < 80 &&
    !/^https?:\/\//i.test(snapshot) &&
    !isOpaqueIdLike(snapshot)
  ) {
    return snapshot;
  }

  const meta = asString(part.meta).trim();
  if (meta && !isOpaqueIdLike(meta)) {
    return meta;
  }

  return 'Thinking...';
}

function shouldBootstrapStreamingFromPart(part: UnknownRecord | null): boolean {
  if (!part) {
    return false;
  }

  const partType = asString(part.type).toLowerCase();
  // Include text parts to bootstrap streaming for regular content chunks
  if (
    partType === "reasoning" ||
    partType === "step-start" ||
    partType === "tool" ||
    partType === "patch" ||
    partType === "text"
  ) {
    return true;
  }

  const reasoningLike =
    asString(part.reasoning) ||
    asString(part.thought) ||
    asString(part.thinking);
  return Boolean(reasoningLike);
}

function isReasoningPart(part: UnknownRecord): boolean {
  const type = asString(part.type).toLowerCase();
  return (
    type === 'reasoning' ||
    typeof part.reasoning !== 'undefined' ||
    typeof part.thought !== 'undefined' ||
    typeof part.thinking !== 'undefined'
  );
}

function contentFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      const rec = asRecord(part);
      if (!rec || isReasoningPart(rec)) {
        return '';
      }
      return asRichString(rec.text) || asRichString(rec.content) || asRichString(rec.delta);
    })
    .join('')
    .trim();
}

function reasoningFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      const rec = asRecord(part);
      if (!rec) {
        return '';
      }

      const reasoning =
        asRichString(rec.reasoning) ||
        asRichString(rec.thought) ||
        asRichString(rec.thinking) ||
        (isReasoningPart(rec)
          ? asRichString(rec.text) || asRichString(rec.content) || asRichString(rec.delta)
          : '');
      return reasoning.trim();
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function summaryText(info: unknown): string {
  const summary = asRecord(asRecord(info)?.summary);
  if (!summary) {
    return '';
  }
  const title = asRichString(summary.title).trim();
  const body = asRichString(summary.body).trim();
  if (title && body) {
    return `${title}\n\n${body}`;
  }
  return title || body;
}

function latestUserMessageText(state: AppState): string {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const msg = state.messages[i];
    const role = msg.role ?? msg.info?.role;
    if (role === 'user') {
      return extractMessageText(msg).trim();
    }
  }
  return '';
}

function stripLeadingUserEcho(text: string, state: AppState): string {
  const prompt = latestUserMessageText(state);
  if (!prompt) {
    return text;
  }

  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalizedPrompt = prompt.replace(/\r\n/g, '\n').trim();
  const leadingWs = normalizedText.match(/^\s*/)?.[0] ?? '';
  const trimmed = normalizedText.trimStart();

  if (trimmed === normalizedPrompt) {
    return '';
  }

  if (trimmed.startsWith(normalizedPrompt)) {
    const remainder = trimmed.slice(normalizedPrompt.length);
    // Strip only clear prompt echo prefixes, keep normal model output intact.
    if (/^[\s:,\-.!?]*$/.test(remainder)) {
      return '';
    }
    if (/^\s+/.test(remainder)) {
      return `${leadingWs}${remainder.trimStart()}`;
    }
  }

  return text;
}

function sanitizeAssistantMessageEcho(message: Message, state: AppState): Message {
  const role = message.role ?? message.info?.role;
  if (role !== 'assistant') {
    return message;
  }

  const next = { ...message };
  if (typeof next.content === 'string' && next.content.trim()) {
    const stripped = stripLeadingUserEcho(next.content, state);
    if (stripped !== next.content) {
      next.content = stripped;
    }
  }

  if (Array.isArray(next.parts) && next.parts.length > 0) {
    const parts = [...next.parts];
    const firstTextLikeIndex = parts.findIndex((part) => {
      const type = (part.type ?? '').toLowerCase();
      return type === '' || type === 'text' || !!part.text || !!part.content;
    });
    if (firstTextLikeIndex >= 0) {
      const part = parts[firstTextLikeIndex];
      if (typeof part.text === 'string') {
        parts[firstTextLikeIndex] = { ...part, text: stripLeadingUserEcho(part.text, state) };
      } else if (typeof part.content === 'string') {
        parts[firstTextLikeIndex] = { ...part, content: stripLeadingUserEcho(part.content, state) };
      }
      next.parts = parts;
    }
  }

  return next;
}

function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined {
  const rec = asRecord(message);
  if (!rec) {
    return streaming ? buildStreamingMessage(streaming) : undefined;
  }

  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const mergedParts = [...parts];
  const currentReasoning = reasoningFromParts(mergedParts);
  if (streaming?.reasoning && !currentReasoning) {
    mergedParts.push({
      type: 'reasoning',
      reasoning: streaming.reasoning
    });
  }
  const role = asString(rec.role) || asString(asRecord(rec.info)?.role);
  const content =
    asRichString(rec.content) ||
    asRichString(rec.text) ||
    contentFromParts(mergedParts) ||
    summaryText(rec.info) ||
    reasoningFromParts(mergedParts);

  const normalized: Message = {
    ...(message as Message),
    role: role || (parts.length > 0 ? 'assistant' : message.role),
    content: content || message.content,
    parts: mergedParts.length > 0 ? (mergedParts as Message['parts']) : message.parts
  };

  const existingReasoningEvents = Array.isArray(message.reasoningEvents)
    ? message.reasoningEvents
    : [];
  const mergedReasoningEvents = [
    ...existingReasoningEvents,
    ...(streaming?.reasoningEvents ?? [])
  ];
  if (mergedReasoningEvents.length > 0) {
    normalized.reasoningEvents = mergedReasoningEvents;
  }

  const existingProgressEvents = Array.isArray(message.progressEvents)
    ? message.progressEvents
    : [];
  const mergedProgressEvents = [
    ...existingProgressEvents,
    ...(streaming?.progressEvents ?? []).map((step) => ({
      type: step.type,
      title: step.title,
      content: step.filePath,
      status: step.status,
      meta: step.meta
    }))
  ];
  if (mergedProgressEvents.length > 0) {
    normalized.progressEvents = mergedProgressEvents;
  } else if (!Array.isArray(normalized.steps) || normalized.steps.length === 0) {
    // When neither progressEvents nor steps are available (e.g. history loaded from server),
    // extract tool-call steps directly from message parts for persistent display.
    const seenCallIds = new Set<string>();
    const fromParts: Array<{ type: string; title: string; content?: string; status?: string; meta?: string }> = [];
    for (const part of mergedParts) {
      const rec = asRecord(part);
      if (!rec || asString(rec.type).toLowerCase() !== 'tool') continue;
      const callID = asString(rec.callID);
      if (callID) {
        if (seenCallIds.has(callID)) continue;
        seenCallIds.add(callID);
      }
      const tool = asString(rec.tool);
      const stateRec = asRecord(rec.state);
      const inputRec = asRecord(stateRec?.['input']);
      const filePath =
        asString(inputRec?.["file"]) ||
        asString(inputRec?.["path"]) ||
        asString(inputRec?.["filename"]) ||
        asString(inputRec?.["TargetFile"]) ||
        asString(inputRec?.["AbsolutePath"]) ||
        asString(inputRec?.["uri"]) ||
        asString(inputRec?.["DirectoryPath"]) ||
        asString(inputRec?.["SearchPath"]) ||
        asString(inputRec?.["SearchDirectory"]) ||
        asString(rec.filePath) ||
        undefined;
      const metaValues = [
        asString(inputRec?.["CommandId"]),
        asString(inputRec?.["CommandLine"]),
        asString(inputRec?.["Query"]),
        asString(inputRec?.["Pattern"]),
        asString(inputRec?.["pattern"]),
        asString(inputRec?.["command"]),
        asString(inputRec?.["query"]),
        asString(inputRec?.["url"]),
        asString(inputRec?.["Url"]),
      ].filter(Boolean);
      const title = asString(rec.title) || (tool ? `${tool}` : 'Tool call');
      const statusStr = asString(stateRec?.['status'] ?? rec.status);

      let diffStats: { added: number; deleted: number } | undefined = undefined;
      const resultRec = asRecord(stateRec?.["result"]);
      if (resultRec?.diffStats) {
        const ds = asRecord(resultRec.diffStats);
        if (ds) {
          diffStats = {
            added: asNumber(ds.added) || 0,
            deleted: asNumber(ds.deleted) || 0,
          };
        }
      } else if (rec.diffStats) {
        const ds = asRecord(rec.diffStats);
        if (ds) {
          diffStats = {
            added: asNumber(ds.added) || 0,
            deleted: asNumber(ds.deleted) || 0,
          };
        }
      }

      fromParts.push({
        type: "tool",
        title,
        content: filePath || undefined,
        status: statusStr || "done",
        meta: asString(rec.meta) || metaValues[0] || undefined,
        diffStats,
      } as any);
    }
    if (fromParts.length > 0) {
      normalized.progressEvents = fromParts;
    }
  }

  // Extract file edits from patch-type parts when edits are not already populated.
  if (!Array.isArray(normalized.edits) || normalized.edits.length === 0) {
    const fromParts: Array<{ file: string }> = [];
    for (const part of mergedParts) {
      const rec = asRecord(part);
      if (!rec || asString(rec.type).toLowerCase() !== 'patch') continue;
      const files = Array.isArray(rec.files) ? rec.files : [];
      for (const f of files) {
        if (typeof f === 'string' && f) {
          fromParts.push({ file: f });
        }
      }
    }
    if (fromParts.length > 0) {
      normalized.edits = fromParts;
    }
  }

  return normalized;
}

function isFileResult(value: unknown): value is FileResult {
  const rec = asRecord(value);
  return !!rec && typeof rec.path === 'string' && typeof rec.name === 'string';
}

function isQueueItem(value: unknown): value is QueueItem {
  const rec = asRecord(value);
  return !!rec && typeof rec.text === 'string';
}

function isSession(value: unknown): value is Session {
  const rec = asRecord(value);
  return !!rec && typeof rec.id === 'string';
}

function isMessage(value: unknown): value is Message {
  const rec = asRecord(value);
  return (
    !!rec &&
    (typeof rec.role === 'string' ||
      typeof rec.content === 'string' ||
      typeof rec.text === 'string' ||
      Array.isArray(rec.parts))
  );
}

function isSubagentStatus(value: unknown): value is SubagentSummary['status'] {
  return value === 'pending' || value === 'running' || value === 'done' || value === 'error' || value === 'orphaned';
}

function normalizeSubagentSummary(value: unknown): SubagentSummary | null {
  const rec = asRecord(value);
  if (!rec) {
    return null;
  }

  const id = asString(rec.id);
  const parentSessionId = asString(rec.parentSessionId);
  const parentMessageId = asString(rec.parentMessageId);
  if (!id || !parentSessionId || !parentMessageId) {
    return null;
  }

  const references = Array.isArray(rec.references)
    ? rec.references
      .map((entry) => {
        const ref = asRecord(entry);
        if (!ref) {
          return null;
        }
        const res: SubagentReference = {
          messageID: asString(ref.messageID) || undefined,
          partID: asString(ref.partID) || undefined,
          callID: asString(ref.callID) || undefined,
        };
        if (!res.messageID && !res.partID && !res.callID) {
          return null;
        }
        return res;
      })
      .filter((entry): entry is SubagentReference => !!entry)
    : [];

  return {
    id,
    parentSessionId,
    parentMessageId,
    childSessionId: asString(rec.childSessionId) || undefined,
    agentId: asString(rec.agentId) || undefined,
    providerID: asString(rec.providerID) || undefined,
    modelID: asString(rec.modelID) || undefined,
    startedAt: asOptionalNumber(rec.startedAt),
    endedAt: asOptionalNumber(rec.endedAt),
    durationMs: asOptionalNumber(rec.durationMs),
    status: isSubagentStatus(rec.status) ? rec.status : 'pending',
    latestActivity: asString(rec.latestActivity) || 'Subagent update',
    references
  };
}

function normalizeSubagentDetail(value: unknown): SubagentDetail | null {
  const summary = normalizeSubagentSummary(value);
  if (!summary) {
    return null;
  }
  const rec = asRecord(value);
  if (!rec) {
    return null;
  }

  const thinkingEvents = Array.isArray(rec.thinkingEvents)
    ? rec.thinkingEvents
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const text = asString(evt.text);
        if (!text) {
          return null;
        }
        const res: SubagentThinkingEvent = {
          id: asString(evt.id) || `${summary.id}:thinking:${index}`,
          text,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
        };
        return res;
      })
      .filter((entry): entry is SubagentThinkingEvent => !!entry)
    : [];

  const progressEvents = Array.isArray(rec.progressEvents)
    ? rec.progressEvents
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const title = asString(evt.title);
        if (!title) {
          return null;
        }
        const res: SubagentProgressEvent = {
          id: asString(evt.id) || `${summary.id}:progress:${index}`,
          title,
          status: normalizeProgressStatus(asString(evt.status)),
          meta: asString(evt.meta) || undefined,
          filePath: asString(evt.filePath) || undefined,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
          callID: asString(evt.callID) || undefined,
        };
        return res;
      })
      .filter((entry): entry is SubagentProgressEvent => !!entry)
    : [];

  const timelineEvents = Array.isArray(rec.timelineEvents)
    ? rec.timelineEvents
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const key = asString(evt.key);
        const type = asString(evt.type);
        const label = asString(evt.label);
        if (!key || !type || !label) {
          return null;
        }
        const res: SubagentTimelineEvent = {
          key: key || `${summary.id}:timeline:${index}`,
          type,
          label,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
          callID: asString(evt.callID) || undefined,
        };
        return res;
      })
      .filter((entry): entry is SubagentTimelineEvent => !!entry)
    : [];

  const tokenUsageRec = asRecord(rec.tokenUsage);
  const tokenCacheRec = asRecord(tokenUsageRec?.cache);

  return {
    ...summary,
    thinkingEvents,
    progressEvents,
    timelineEvents,
    tokenUsage: tokenUsageRec
      ? {
        input: asOptionalNumber(tokenUsageRec.input),
        output: asOptionalNumber(tokenUsageRec.output),
        reasoning: asOptionalNumber(tokenUsageRec.reasoning),
        cache: tokenCacheRec
          ? {
            read: asOptionalNumber(tokenCacheRec.read),
            write: asOptionalNumber(tokenCacheRec.write)
          }
          : undefined
      }
      : undefined,
    errorText: asString(rec.errorText) || undefined,
    hydrationUnavailable: asBoolean(rec.hydrationUnavailable, false)
  };
}

function normalizeSubagentSummaryMap(value: unknown): Record<string, SubagentSummary[]> {
  const rec = asRecord(value);
  if (!rec) {
    return {};
  }
  const out: Record<string, SubagentSummary[]> = {};
  for (const [key, item] of Object.entries(rec)) {
    if (!Array.isArray(item)) {
      continue;
    }
    const entries = item
      .map((raw) => normalizeSubagentSummary(raw))
      .filter((entry): entry is SubagentSummary => !!entry);
    out[key] = entries;
  }
  return out;
}

function normalizeSubagentDetailMap(value: unknown): Record<string, SubagentDetail> {
  const rec = asRecord(value);
  if (!rec) {
    return {};
  }
  const out: Record<string, SubagentDetail> = {};
  for (const [key, item] of Object.entries(rec)) {
    const detail = normalizeSubagentDetail(item);
    if (!detail) {
      continue;
    }
    out[key] = detail;
  }
  return out;
}

function extractSubagentsFromMessages(messages: Message[]): {
  summariesByParentMessageId: Record<string, SubagentSummary[]>;
  detailsById: Record<string, SubagentDetail>;
} {
  const summariesByParentMessageId: Record<string, SubagentSummary[]> = {};
  const detailsById: Record<string, SubagentDetail> = {};

  for (const message of messages) {
    const messageId = asString(asRecord(message.info)?.id) || asString((message as unknown as UnknownRecord).id);
    if (!messageId || !Array.isArray(message.subagents)) {
      continue;
    }
    const details = message.subagents
      .map((entry) => normalizeSubagentDetail(entry))
      .filter((entry): entry is SubagentDetail => !!entry);
    if (details.length === 0) {
      continue;
    }
    summariesByParentMessageId[messageId] = details.map((detail) => normalizeSubagentSummary(detail) as SubagentSummary);
    details.forEach((detail) => {
      detailsById[detail.id] = detail;
    });
  }

  return { summariesByParentMessageId, detailsById };
}

function extractMessageText(message: Message): string {
  const rec = asRecord(message);
  if (!rec) {
    return '';
  }

  if (typeof rec.content === 'string' && rec.content.trim()) {
    return rec.content;
  }
  if (typeof rec.text === 'string' && rec.text.trim()) {
    return rec.text;
  }

  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const fromParts = contentFromParts(parts);
  if (fromParts) {
    return fromParts;
  }

  const summary = summaryText(rec.info);
  if (summary) {
    return summary;
  }

  return reasoningFromParts(parts);
}

function slugifyChoiceValue(input: string): string {
  const value = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || 'option';
}

function stripChoicePrefix(input: string): string {
  return input
    .replace(/^(?:[-*]|\u2022)\s+/, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .replace(/^[a-zA-Z][.)]\s+/, '')
    .replace(/^>\s*/, '')
    .trim();
}

function stripMarkdownFormatting(input: string): string {
  return input
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isLikelyYesNoQuestion(question: string): boolean {
  return /^(do|does|did|is|are|was|were|can|could|should|would|will|have|has|had|may|might|am)\b/i.test(
    question.trim(),
  );
}

function normalizeChoiceFromLine(line: string, index: number): InteractiveChoice | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  const hasListPrefix = /^(?:[-*]|\u2022|\d{1,2}[.)]|[a-zA-Z][.)])\s+/.test(
    trimmed,
  );
  const hasLabelColon = /^[*_`"'(]*[A-Za-z][^?]{0,40}:\s+\S+/.test(trimmed);

  const candidate = stripMarkdownFormatting(stripChoicePrefix(trimmed));
  if (!hasListPrefix && !hasLabelColon) {
    const plainWords = candidate.split(/\s+/).filter(Boolean);
    const plainAllowed =
      candidate.length > 0 &&
      candidate.length <= 32 &&
      plainWords.length > 0 &&
      plainWords.length <= 4 &&
      /^[A-Za-z0-9 /+._-]+$/.test(candidate) &&
      !/[\\/]/.test(candidate);
    if (!plainAllowed) {
      return undefined;
    }
  }

  if (!candidate || candidate.length > 140 || candidate.includes('?')) {
    return undefined;
  }

  const looksPathLike =
    /(?:^|[\s"'`])(?:[A-Za-z]:\\|\.{0,2}[\\/]|[\w-]+[\\/][\w./\\-]+\.[A-Za-z0-9]{1,8})/.test(
      candidate,
    );
  if (looksPathLike && !hasLabelColon) {
    return undefined;
  }
  if (
    /auto-generated|generated file|timestamp/i.test(candidate) &&
    !/^(yes|no)\b/i.test(candidate)
  ) {
    return undefined;
  }

  let label = candidate;
  let description: string | undefined;
  const colonIndex = candidate.indexOf(':');
  if (colonIndex > 0 && colonIndex < 44) {
    label = candidate.slice(0, colonIndex).trim();
    const rest = candidate.slice(colonIndex + 1).trim();
    description = rest || undefined;
  }

  label = label.replace(/[.,;:]$/, '').trim();
  if (!label || label.length < 2 || label.split(/\s+/).length > 8) {
    return undefined;
  }

  return {
    id: `auto-opt-${index}`,
    label,
    value: slugifyChoiceValue(label),
    description
  };
}

function dedupeChoices(choices: InteractiveChoice[]): InteractiveChoice[] {
  const out: InteractiveChoice[] = [];
  const seen = new Set<string>();
  choices.forEach((choice) => {
    const key = `${choice.label}::${choice.value || choice.label}`.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(choice);
  });
  return out;
}

function collectOptionsInDirection(
  lines: string[],
  startIndex: number,
  step: 1 | -1,
  maxScanDistance = 8
): InteractiveChoice[] {
  const collected: InteractiveChoice[] = [];
  let scanned = 0;
  for (let index = startIndex; index >= 0 && index < lines.length && scanned < maxScanDistance; index += step) {
    scanned += 1;
    const line = lines[index].trim();
    if (!line) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    if (line.includes('?')) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }

    const option = normalizeChoiceFromLine(line, collected.length);
    if (!option) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    collected.push(option);
    if (collected.length >= 6) {
      break;
    }
  }

  if (step === -1) {
    collected.reverse();
  }
  return collected;
}

function extractInlineOrChoices(question: string): InteractiveChoice[] {
  const cleanQuestion = question.replace(/[?!.\s]+$/, '').trim();
  if (!/\bor\b/i.test(cleanQuestion)) {
    return [];
  }

  const useMatch = cleanQuestion.match(
    /\b(?:use|choose|pick|select|prefer|want)\s+([A-Za-z][A-Za-z0-9+._/-]{1,30})\s+or\s+([A-Za-z][A-Za-z0-9+._/-]{1,30})\b/i
  );
  if (useMatch) {
    const first = useMatch[1];
    const second = useMatch[2];
    return [
      { id: 'auto-opt-0', label: first, value: slugifyChoiceValue(first) },
      { id: 'auto-opt-1', label: second, value: slugifyChoiceValue(second) }
    ];
  }

  const genericMatch = cleanQuestion.match(
    /\b([A-Za-z][A-Za-z0-9+._/-]{1,30})\b\s+or\s+\b([A-Za-z][A-Za-z0-9+._/-]{1,30})\b/i
  );
  if (!genericMatch) {
    return [];
  }
  const first = genericMatch[1];
  const second = genericMatch[2];
  if (first.length < 2 || second.length < 2) {
    return [];
  }
  return [
    { id: 'auto-opt-0', label: first, value: slugifyChoiceValue(first) },
    { id: 'auto-opt-1', label: second, value: slugifyChoiceValue(second) }
  ];
}

function detectInteractiveEventsFromText(text: string, message: Message): InteractiveEvent[] {
  const trimmed = text.trim();
  if (!trimmed || !trimmed.includes('?')) {
    return [];
  }

  const sanitized = trimmed.replace(/```[\s\S]*?```/g, ' ');
  const lines = sanitized.split(/\r?\n/);
  const questionRows: Array<{ index: number; question: string }> = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.length > 220 || !line.includes('?')) {
      return;
    }
    const question = stripChoicePrefix(line);
    if (question.length < 6) {
      return;
    }
    questionRows.push({ index, question });
  });

  if (questionRows.length === 0) {
    return [];
  }

  const messageRec = asRecord(message);
  const info = asRecord(messageRec?.info);
  const idBase = asString(info?.id) || asString(messageRec?.id) || `${Date.now()}`;

  const detectedEvents: InteractiveEvent[] = [];

  for (const row of questionRows) {
    const yesNoQuestion = isLikelyYesNoQuestion(row.question);
    const optionsAfter = collectOptionsInDirection(lines, row.index + 1, 1);
    const optionsBefore = collectOptionsInDirection(lines, row.index - 1, -1);
    const inlineOptions = extractInlineOrChoices(row.question);
    const options = dedupeChoices(
      optionsAfter.length >= 2
        ? optionsAfter
        : optionsBefore.length >= 2
          ? optionsBefore
          : inlineOptions,
    );

    if (yesNoQuestion && inlineOptions.length === 0) {
      continue;
    }

    if (options.length >= 2) {
      detectedEvents.push({
        type: "question",
        id: `auto-question-${idBase}-${row.index}`,
        title: "Question",
        question: row.question,
        options,
      });
    }
  }

  if (detectedEvents.length > 0) {
    return detectedEvents;
  }

  const finalQuestion = questionRows[questionRows.length - 1].question;
  if (!isLikelyYesNoQuestion(finalQuestion)) {
    return [];
  }

  return [
    {
      type: 'confirm',
      id: `auto-confirm-${idBase}`,
      title: 'Question',
      question: finalQuestion,
      confirmLabel: 'Yes',
      cancelLabel: 'No'
    }
  ];
}

function interactiveEventsFromMessage(message: Message): InteractiveEvent[] {
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  if (role && role !== 'assistant') {
    return [];
  }

  if (Array.isArray(message.interactiveEvents) && message.interactiveEvents.length > 0) {
    return message.interactiveEvents;
  }
  const rec = asRecord(message);
  if (!rec) {
    return [];
  }
  const structured =
    normalizeStructuredOutput(rec.structuredOutput) ??
    normalizeStructuredOutput((rec as UnknownRecord).structured_output) ??
    normalizeStructuredOutput(asRecord(rec.info)?.structuredOutput) ??
    normalizeStructuredOutput((asRecord(rec.info) as UnknownRecord | null)?.structured_output);
  const fromStructured = toInteractiveEvents(structured);
  if (fromStructured.length > 0) {
    return fromStructured;
  }
  return [];
}

function buildStreamingMessage(streaming: StreamingState): Message {
  const parts: any[] = [
    {
      type: "text",
      text: streaming.content,
    },
  ];
  if (streaming.reasoning) {
    parts.push({
      type: 'reasoning',
      reasoning: streaming.reasoning
    });
  }

  return {
    role: "assistant",
    content: streaming.content || streaming.reasoning,
    parts,
    reasoningEvents: streaming.reasoningEvents,
    progressEvents: streaming.progressEvents.map((step) => ({
      type: step.type,
      title: step.title,
      content: step.filePath,
      status: step.status,
      meta: step.meta,
    })),
    steps: streaming.steps.map((step) => ({
      type: step.type,
      title: step.title,
      content: step.filePath,
      status: step.status,
      meta: step.meta,
    })),
    edits: streaming.edits.map((file) => ({ file })),
    info: {
      id: streaming.messageId ?? undefined,
      agent: streaming.agent,
      model: streaming.model,
      modelID: streaming.modelID,
      providerID: streaming.providerID,
      duration: streaming.usage?.duration,
    },
  };
}

function handleStreamEvent(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  payload: UnknownRecord
): void {
  const eventType = asString(payload.type) || asString(payload.event) || asString(payload.kind);
  const state = getState();
  const current = state.streaming;
  const properties = asRecord(payload.properties);
  const partRecord = asRecord(properties?.part);
  const infoRecord = asRecord(payload.info) ?? asRecord(properties?.info);
  const eventPart = asRecord(payload.part) ?? partRecord ?? (eventType === 'message.part.updated' ? asRecord(properties) : null);
  const structuredRecord = asRecord(payload.structured);
  const structuredKind = asString(structuredRecord?.kind).toLowerCase();
  const structuredText = asString(structuredRecord?.text);
  const structuredOutput =
    normalizeStructuredOutput(payload.structuredOutput) ??
    normalizeStructuredOutput((payload as UnknownRecord).structured_output) ??
    normalizeStructuredOutput(properties?.structuredOutput) ??
    normalizeStructuredOutput((properties as UnknownRecord | null)?.structured_output) ??
    normalizeStructuredOutput(infoRecord?.structuredOutput) ??
    normalizeStructuredOutput((infoRecord as UnknownRecord | null)?.structured_output);
  const eventSessionId =
    asString(payload.sessionId) ||
    asString(payload.sessionID) ||
    asString(properties?.sessionId) ||
    asString(properties?.sessionID) ||
    asString(partRecord?.sessionId) ||
    asString(partRecord?.sessionID);

  if (eventSessionId && state.currentSessionId && eventSessionId !== state.currentSessionId) {
    return;
  }

  const eventRole =
    asString(payload.role) ||
    asString(infoRecord?.role) ||
    asString(properties?.role) ||
    asString(partRecord?.role);
  if (eventRole && eventRole !== 'assistant') {
    return;
  }

  const messageId = asString(payload.messageId) || asString(payload.id) || current?.messageId || null;
  const isExplicitStart = eventType === 'start' || eventType === 'streamStart';
  const isAssistantUpdateStart =
    eventType === 'message.updated' &&
    asString(infoRecord?.role) === 'assistant' &&
    !asBoolean(infoRecord?.finish, false);
  const canBootstrapFromPart = eventType === 'message.part.updated' && shouldBootstrapStreamingFromPart(eventPart);

  // Ignore stray global stream events when neither a request is in progress nor the
  // event carries an explicit lifecycle signal. This prevents phantom "Thinking..." /
  // streaming UI on extension open while still allowing any event type to bootstrap the
  // streaming card once the user has sent a message (state.isProcessing = true).
  // Echo stripping inside the per-event switch cases handles residual false positives.
  if (!current && !state.isProcessing && !isExplicitStart && !isAssistantUpdateStart && !canBootstrapFromPart) {
    return;
  }

  if (
    !current &&
    (isExplicitStart ||
      isAssistantUpdateStart ||
      canBootstrapFromPart ||
      state.isProcessing)
  ) {
    // Extract model/agent metadata from the event payload or fall back to app state
    const eventAgent = asString(infoRecord?.agent) || asString(payload.agent);
    const eventModel = asRecord(infoRecord?.model) || asRecord(payload.model);
    const eventModelID =
      asString(infoRecord?.modelID) || asString(payload.modelID);
    const eventProviderID =
      asString(infoRecord?.providerID) || asString(payload.providerID);

    dispatch({
      type: "SET_STREAMING",
      payload: {
        messageId,
        content: "",
        reasoning: "",
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true,
        // Include model/agent metadata for display during streaming
        agent: eventAgent || state.selectedAgent || undefined,
        model:
          eventModel && typeof eventModel === "object"
            ? {
              modelID:
                asString(eventModel.modelID) ||
                state.selectedModel?.modelID ||
                "",
              providerID:
                asString(eventModel.providerID) ||
                state.selectedModel?.providerID ||
                "",
              name:
                asString((eventModel as Record<string, unknown>).name) ||
                undefined,
            }
            : undefined,
        modelID: eventModelID || state.selectedModel?.modelID,
        providerID: eventProviderID || state.selectedModel?.providerID,
      },
    });
  }

  switch (eventType) {
    case 'message.part.updated': {
      const properties = asRecord(payload.properties);
      const part = asRecord(payload.part) ?? asRecord(properties?.part) ?? properties;
      if (!part) {
        dispatch({ type: 'SET_PROCESSING', payload: true });
        break;
      }

      const partType = asString(part.type).toLowerCase();
      const deltaChunk =
        asRichString(properties?.delta) ||
        asRichString(payload.delta) ||
        asRichString(part.delta);
      const reasoningChunk =
        asRichString(part.reasoning) ||
        asRichString(part.thought) ||
        asRichString(part.thinking);
      const textChunk =
        structuredText ||
        deltaChunk ||
        asRichString(part.text) ||
        asRichString(part.content) ||
        asRichString(properties?.text) ||
        asRichString(properties?.content);
      const isProgressPartType =
        partType === "tool" ||
        partType === "step-start" ||
        partType === "step-finish" ||
        partType === "patch";

      const isReasoning = structuredKind === 'thinking' || partType === 'reasoning' || !!reasoningChunk;
      if (isReasoning) {
        const nextReasoning = sanitizeReasoningChunk(
          reasoningChunk || structuredText || deltaChunk,
        );
        if (nextReasoning) {
          dispatch({
            type: 'UPDATE_STREAMING_REASONING',
            payload: { reasoning: nextReasoning, append: true }
          });
        }
      } else if (
        structuredKind === "message" ||
        partType === "text" ||
        (!!textChunk && !isProgressPartType) ||
        (!partType && structuredKind !== "progress")
      ) {
        // Ignore id-like echoes that can appear before assistant output begins.
        if (isOpaqueIdLike(textChunk.trim())) {
          dispatch({ type: "SET_PROCESSING", payload: true });
          break;
        }
        const streamingState = getState().streaming;
        const contentEmpty = !streamingState || !streamingState.content.trim();
        const cleanedChunk = contentEmpty
          ? stripLeadingUserEcho(textChunk, getState())
          : textChunk;
        if (cleanedChunk) {
          console.debug("[OpenCode][stream] message.part.updated chunk", {
            messageId,
            eventType,
            partType,
            length: cleanedChunk.length,
            preview: cleanedChunk.slice(0, 80),
          });
          dispatch({
            type: "UPDATE_STREAMING_CONTENT",
            payload: { content: cleanedChunk, append: true },
          });
        }
      }

      if (partType === 'step-start' && structuredKind !== 'thinking') {
        dispatch({
          type: 'ADD_STREAMING_STEP',
          payload: {
            id: asString(part.id) || undefined,
            callID: asString(part.callID) || undefined,
            title: inferredStepTitle(part),
            type: 'step',
            status: 'pending',
            startTime: Date.now()
          }
        });
      }

      if (partType === 'step-finish' && structuredKind !== 'thinking') {
        const diffStatsRec = asRecord(part.diffStats);
        const diffStats = diffStatsRec
          ? {
            added: asNumber(diffStatsRec.added) || 0,
            deleted: asNumber(diffStatsRec.deleted) || 0,
          }
          : undefined;

        dispatch({
          type: "UPDATE_STREAMING_STEP",
          payload: {
            id: asString(part.id) || undefined,
            callID: asString(part.callID) || undefined,
            patch: {
              status: "done",
              duration: asOptionalNumber(asRecord(part.timing)?.duration),
              diffStats,
            },
          },
        });
      }

      if (partType === 'tool') {
        const tool = asString(part.tool);
        const stateObj = asRecord(part.state);
        const inputObj = asRecord(stateObj?.input);
        const filePath =
          asString(inputObj?.file) ||
          asString(inputObj?.path) ||
          asString(inputObj?.filename) ||
          asString(inputObj?.TargetFile) ||
          asString(inputObj?.AbsolutePath) ||
          asString(inputObj?.uri) ||
          asString(inputObj?.DirectoryPath) ||
          asString(inputObj?.SearchPath) ||
          asString(inputObj?.SearchDirectory) ||
          asString(part.filePath) ||
          undefined;
        const metaValues = [
          asString(inputObj?.CommandId),
          asString(inputObj?.CommandLine),
          asString(inputObj?.Query),
          asString(inputObj?.Pattern),
          asString(inputObj?.pattern),
          asString(inputObj?.command),
          asString(inputObj?.query),
          asString(inputObj?.url),
          asString(inputObj?.Url),
        ].filter(Boolean);
        const callID = asString(part.callID) || undefined;
        const title = asString(part.title) || (tool ? `Running ${tool}...` : inferredStepTitle(part));

        const existing = getState().streaming?.steps.find(
          (step) => !!callID && step.callID === callID
        );
        if (!existing) {
          dispatch({
            type: "ADD_STREAMING_STEP",
            payload: {
              id: asString(part.id) || undefined,
              callID,
              title,
              type: "tool",
              status: asString(part.status) === "error" ? "error" : "pending",
              meta: asString(part.meta) || metaValues[0] || undefined,
              filePath,
              startTime: Date.now(),
            },
          });
        } else {
          // Determine the final status for this tool step.
          // The backend reports completion in two places:
          //   1. part.status === 'done' (direct top-level field)
          //   2. part.state.status === 'done' (nested state object)
          //   3. part.state.result exists (implicit done — tool produced a result)
          const stateStatus = asString(stateObj?.status);
          const hasResult = stateObj && "result" in stateObj;
          const resolvedStatus =
            asString(part.status) === "done" ||
              stateStatus === "done" ||
              hasResult
              ? "done"
              : asString(part.status) === "error" || stateStatus === "error"
                ? "error"
                : existing.status; // keep current status if no new info

          dispatch({
            type: "UPDATE_STREAMING_STEP",
            payload: {
              callID,
              patch: {
                title,
                status: resolvedStatus,
                meta: asString(part.meta) || metaValues[0] || existing.meta,
                filePath: filePath || existing.filePath,
              },
            },
          });
        }

        if (filePath) {
          dispatch({ type: 'ADD_STREAMING_EDIT', payload: filePath });
        }
      }

      if (partType === 'patch') {
        const files = Array.isArray(part.files) ? part.files : [];
        files.forEach((file) => {
          const path = asString(file);
          if (path) {
            dispatch({ type: 'ADD_STREAMING_EDIT', payload: path });
          }
        });
      }

      dispatch({ type: 'SET_PROCESSING', payload: true });
      break;
    }
    case 'message.updated': {
      const info = asRecord(payload.info) ?? asRecord(payload.properties)?.info;
      const finish = info ? asBoolean((info as UnknownRecord).finish, false) : false;

      if (finish && structuredOutput) {
        if (structuredOutput.reasoning) {
          structuredOutput.reasoning.forEach((chunk) => {
            const sanitized = sanitizeReasoningChunk(chunk);
            if (sanitized) {
              dispatch({
                type: 'UPDATE_STREAMING_REASONING',
                payload: { reasoning: sanitized, append: true }
              });
            }
          });
        }

        if (structuredOutput.progressUpdates) {
          structuredOutput.progressUpdates.forEach((step) => {
            dispatch({
              type: 'ADD_STREAMING_STEP',
              payload: {
                title: step.title,
                type: 'step',
                status: step.status ?? 'pending',
                meta: step.meta,
                filePath: step.filePath
              }
            });
          });
        }

        if (structuredOutput.message) {
          dispatch({
            type: 'UPDATE_STREAMING_CONTENT',
            payload: { content: structuredOutput.message, append: false }
          });
        }

        const interactiveEvents = toInteractiveEvents(structuredOutput);
        if (interactiveEvents.length > 0) {
          dispatch({ type: 'SET_INTERACTIVE_EVENTS', payload: interactiveEvents });
        }

        if (structuredOutput && structuredOutput.responseType === 'subagents' && messageId) {
          if (!structuredOutput.subagents || structuredOutput.subagents.length === 0) {
            console.warn('Structured subagents responseType received without subagents array');
          }
        }

        if (structuredOutput.subagents && structuredOutput.subagents.length > 0 && messageId) {
          const parentSessionId = state.currentSessionId || '';
          const summaries: SubagentSummary[] = [];
          const details: Record<string, SubagentDetail> = {};

          structuredOutput.subagents.forEach((subagent) => {
            const statusValue = (subagent.status || 'pending').toLowerCase();
            const status: SubagentSummary['status'] =
              statusValue === 'running' || statusValue === 'done' || statusValue === 'error' || statusValue === 'orphaned'
                ? statusValue
                : 'pending';
            const summary: SubagentSummary = {
              id: subagent.id,
              parentSessionId: subagent.parentSessionId || parentSessionId,
              parentMessageId: subagent.parentMessageId || messageId,
              childSessionId: subagent.childSessionId,
              agentId: subagent.name || subagent.id,
              status,
              latestActivity:
                subagent.latestActivity || subagent.description || subagent.name || 'Subagent update',
              references: []
            };
            summaries.push(summary);
            details[subagent.id] = {
              ...summary,
              thinkingEvents: subagent.thinkingEvents || [],
              progressEvents: subagent.progressEvents || [],
              timelineEvents: subagent.timelineEvents || []
            };
          });

          if (summaries.length > 0) {
            dispatch({
              type: 'UPSERT_SUBAGENT_SUMMARIES',
              payload: { [messageId]: summaries }
            });
          }
          if (Object.keys(details).length > 0) {
            dispatch({ type: 'UPSERT_SUBAGENT_DETAIL', payload: details });
          }
        }

        if (structuredOutput.subagentsDelta && structuredOutput.subagentsDelta.items.length > 0) {
          const targetMessageId =
            structuredOutput.subagentsDelta.parentMessageId || messageId || '';
          if (targetMessageId) {
            const summaries: SubagentSummary[] = [];
            const details: Record<string, SubagentDetail> = {};

            structuredOutput.subagentsDelta.items.forEach((subagent) => {
              const statusValue = (subagent.status || 'pending').toLowerCase();
              const status: SubagentSummary['status'] =
                statusValue === 'running' ||
                statusValue === 'done' ||
                statusValue === 'error' ||
                statusValue === 'orphaned'
                  ? statusValue
                  : 'pending';
              const summary: SubagentSummary = {
                id: subagent.id,
                parentSessionId: subagent.parentSessionId || state.currentSessionId || '',
                parentMessageId: subagent.parentMessageId || targetMessageId,
                childSessionId: subagent.childSessionId,
                agentId: subagent.name || subagent.id,
                status,
                latestActivity:
                  subagent.latestActivity || subagent.description || subagent.name || 'Subagent update',
                references: []
              };
              summaries.push(summary);
              details[subagent.id] = {
                ...summary,
                thinkingEvents: subagent.thinkingEvents || [],
                progressEvents: subagent.progressEvents || [],
                timelineEvents: subagent.timelineEvents || []
              };
            });

            if (summaries.length > 0) {
              dispatch({
                type: 'UPSERT_SUBAGENT_SUMMARIES',
                payload: { [targetMessageId]: summaries }
              });
            }
            if (Object.keys(details).length > 0) {
              dispatch({ type: 'UPSERT_SUBAGENT_DETAIL', payload: details });
            }
          }
        }
      }



      if (finish) {
        dispatch({ type: 'FINISH_STREAMING' });
        dispatch({ type: 'SET_PROCESSING', payload: false });
      } else {
        dispatch({ type: 'SET_PROCESSING', payload: true });
      }
      break;
    }
    case 'session.error':
    case 'error': {
      dispatch({ type: 'SET_PROCESSING', payload: false });
      dispatch({ type: 'FINISH_STREAMING' });
      break;
    }
    case 'start':
    case 'streamStart': {
      // Extract model/agent metadata from the event payload or fall back to app state
      const eventAgent = asString(infoRecord?.agent) || asString(payload.agent);
      const eventModel = asRecord(infoRecord?.model) || asRecord(payload.model);
      const eventModelID = asString(infoRecord?.modelID) || asString(payload.modelID);
      const eventProviderID = asString(infoRecord?.providerID) || asString(payload.providerID);

      dispatch({
        type: "SET_STREAMING",
        payload: {
          messageId,
          content: "",
          reasoning: "",
          reasoningEvents: [],
          steps: [],
          progressEvents: [],
          edits: [],
          isActive: true,
          // Include model/agent metadata for display during streaming
          agent: eventAgent || state.selectedAgent || undefined,
          model:
            eventModel && typeof eventModel === "object"
              ? {
                modelID:
                  asString(eventModel.modelID) ||
                  state.selectedModel?.modelID ||
                  "",
                providerID:
                  asString(eventModel.providerID) ||
                  state.selectedModel?.providerID ||
                  "",
                name:
                  asString((eventModel as Record<string, unknown>).name) ||
                  undefined,
              }
              : undefined,
          modelID: eventModelID || state.selectedModel?.modelID,
          providerID: eventProviderID || state.selectedModel?.providerID,
        },
      });
      dispatch({ type: 'SET_PROCESSING', payload: true });
      break;
    }
    case 'contentDelta':
    case 'content':
    case 'text':
    case 'text-delta': {
      const chunk =
        asString(payload.delta) || asString(payload.text) || asString(payload.content) || asString(payload.chunk);
      if (chunk) {
        const streamingState = getState().streaming;
        const contentEmpty = !streamingState || !streamingState.content.trim();
        const cleanedChunk = contentEmpty ? stripLeadingUserEcho(chunk, getState()) : chunk;
        if (!cleanedChunk) {
          break;
        }
        console.debug("[OpenCode][stream] content delta chunk", {
          messageId,
          eventType,
          length: cleanedChunk.length,
          preview: cleanedChunk.slice(0, 80),
        });
        dispatch({ type: 'UPDATE_STREAMING_CONTENT', payload: { content: cleanedChunk, append: true } });
      }
      break;
    }
    case 'reasoningDelta':
    case 'reasoning':
    case 'thinking': {
      const chunk =
        asString(payload.delta) || asString(payload.reasoning) || asString(payload.thinking) || asString(payload.text);
      const sanitized = sanitizeReasoningChunk(chunk);
      if (sanitized) {
        dispatch({ type: 'UPDATE_STREAMING_REASONING', payload: { reasoning: sanitized, append: true } });
      }
      break;
    }
    case 'stepStart': {
      const step: StreamingStep = {
        id: asString(payload.id) || undefined,
        callID: asString(payload.callID) || undefined,
        title: asString(payload.title, 'Working'),
        type:
          asString(payload.stepType) === 'tool' || asString(payload.stepType) === 'reasoning'
            ? (asString(payload.stepType) as 'tool' | 'reasoning')
            : 'step',
        status: 'pending',
        meta: asString(payload.meta) || undefined,
        filePath: asString(payload.filePath) || undefined,
        startTime: Date.now()
      };
      dispatch({ type: 'ADD_STREAMING_STEP', payload: step });
      break;
    }
    case 'stepUpdate': {
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            title: asString(payload.title) || undefined,
            meta: asString(payload.meta) || undefined,
            filePath: asString(payload.filePath) || undefined
          }
        }
      });
      break;
    }
    case 'stepDone': {
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            status: 'done',
            duration: asOptionalNumber(payload.duration)
          }
        }
      });
      break;
    }
    case 'stepError': {
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            status: 'error',
            meta: asString(payload.error) || asString(payload.meta) || 'Failed'
          }
        }
      });
      break;
    }
    case 'edit':
    case 'fileEdit': {
      const file = asString(payload.file) || asString(payload.path);
      if (file) {
        dispatch({ type: 'ADD_STREAMING_EDIT', payload: file });
      }
      break;
    }
    case 'finish':
    case 'done': {
      dispatch({
        type: 'FINISH_STREAMING',
        payload: {
          usage: {
            total: asNumber(payload.total, 0),
            duration: asOptionalNumber(payload.duration)
          }
        }
      });
      dispatch({ type: 'SET_PROCESSING', payload: false });
      break;
    }
    default:
      break;
  }
}

export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState) {
  return (event: MessageEvent) => {
    const data = asRecord(event.data);
    if (!data) {
      return;
    }

    const type = asString(data.type);

    // Set processing state BEFORE handling message types to ensure streaming state is created early
    if (asBoolean(data.processing, false)) {
      dispatch({ type: "SET_PROCESSING", payload: true });
    }

    switch (type) {
      case "initState":
      case "init": {
        const state = asRecord(data.state) ?? data;
        const sessionId =
          asString(state.sessionId) || asString(state.currentSessionId) || null;

        const selectedModelRecord = asRecord(state.selectedModel);
        const selectedModel = selectedModelRecord
          ? {
            providerID: asString(selectedModelRecord.providerID),
            modelID: asString(selectedModelRecord.modelID),
          }
          : null;

        dispatch({ type: "SET_SESSION_ID", payload: sessionId });
        dispatch({
          type: "SET_SERVER_STATUS",
          payload: asString(state.serverStatus, "connected"),
        });
        dispatch({
          type: "SET_SELECTED_MODEL",
          payload:
            selectedModel?.providerID && selectedModel?.modelID
              ? selectedModel
              : null,
        });
        dispatch({
          type: "SET_SELECTED_AGENT",
          payload: asString(state.selectedAgent),
        });
        dispatch({ type: "SET_RECEIVED_INIT_STATE", payload: true });
        break;
      }
      case "modelsList": {
        const models = asArray(
          data.models,
          (item): item is AppState["availableModels"][number] => {
            const rec = asRecord(item);
            return (
              !!rec &&
              typeof rec.modelID === "string" &&
              typeof rec.providerID === "string" &&
              typeof rec.name === "string"
            );
          },
        );
        dispatch({ type: "SET_MODELS_LIST", payload: models });
        break;
      }
      case "agentsList": {
        const agents = asArray(
          data.agents,
          (item): item is AppState["availableAgents"][number] => {
            const rec = asRecord(item);
            return (
              !!rec &&
              typeof rec.id === "string" &&
              typeof rec.name === "string" &&
              typeof rec.description === "string"
            );
          },
        );
        dispatch({ type: "SET_AGENTS_LIST", payload: agents });
        break;
      }
      case "statusUpdate": {
        dispatch({
          type: "SET_SERVER_STATUS",
          payload: asString(data.status, "unknown"),
        });
        break;
      }
      case "messageResponse": {
        const msg =
          (asRecord(data.message) as Message | null) ??
          (data as unknown as Message);
        const currentMessages = getState().messages;

        // FORBIDDEN TO REMOVE - token accumulation for sticky header
        dispatch({
          type: "ACCUMULATE_SESSION_STATS",
          payload: {
            input: msg.tokens?.input || msg.info?.tokens?.input || 0,
            output: msg.tokens?.output || msg.info?.tokens?.output || 0,
            read: msg.tokens?.cache?.read || msg.info?.tokens?.cache?.read || 0,
            write:
              msg.tokens?.cache?.write || msg.info?.tokens?.cache?.write || 0,
            duration:
              msg.duration || msg.timing?.duration || msg.info?.duration || 0,
          },
        });

        const streaming = getState().streaming;
        const normalizedMessage = isMessage(msg)
          ? normalizeMessage(msg, streaming)
          : streaming
            ? buildStreamingMessage(streaming)
            : undefined;
        if (normalizedMessage) {
          const sanitized = sanitizeAssistantMessageEcho(
            normalizedMessage,
            getState(),
          );
          dispatch({
            type: "SET_MESSAGES",
            payload: [...currentMessages, sanitized],
          });
          const { summariesByParentMessageId, detailsById } =
            extractSubagentsFromMessages([sanitized]);
          if (Object.keys(summariesByParentMessageId).length > 0) {
            dispatch({
              type: "UPSERT_SUBAGENT_SUMMARIES",
              payload: summariesByParentMessageId,
            });
          }
          if (Object.keys(detailsById).length > 0) {
            dispatch({ type: "UPSERT_SUBAGENT_DETAIL", payload: detailsById });
          }
          const interactiveEvents = interactiveEventsFromMessage(sanitized);
          if (interactiveEvents.length > 0) {
            dispatch({
              type: "SET_INTERACTIVE_EVENTS",
              payload: interactiveEvents,
            });
          }
        }
        dispatch({ type: "SET_PROCESSING", payload: false });
        dispatch({ type: "SET_STREAMING", payload: null });
        break;
      }
      case "chatHistory": {
        const messages = asArray(data.messages, isMessage)
          .map((msg) => normalizeMessage(msg, null))
          .filter((msg): msg is Message => !!msg);

        // Clear any stale streaming state and in-progress flag when history is
        // loaded (extension open or session switch) so the UI starts clean.
        dispatch({ type: "SET_STREAMING", payload: null });
        dispatch({ type: "SET_PROCESSING", payload: false });

        dispatch({ type: "CLEAR_MESSAGES" });
        dispatch({ type: "SET_MESSAGES", payload: messages });

        // If the backend included a sessionId (e.g. on session switch), update it BEFORE
        // storing stats so RESET_SESSION_STATS writes under the correct key.
        const chatHistorySessionId = asString(data.sessionId);
        if (chatHistorySessionId) {
          dispatch({ type: "SET_SESSION_ID", payload: chatHistorySessionId });
          // Clear todo items from the previous session so stale tasks are not shown.
          dispatch({ type: "SET_TODO_ITEMS", payload: [] });
        }

        // FORBIDDEN TO REMOVE - recalculate session stats from full history
        const stats = { input: 0, output: 0, read: 0, write: 0, duration: 0 };
        messages.forEach((msg) => {
          stats.input += msg.tokens?.input || msg.info?.tokens?.input || 0;
          stats.output += msg.tokens?.output || msg.info?.tokens?.output || 0;
          stats.read +=
            msg.tokens?.cache?.read || msg.info?.tokens?.cache?.read || 0;
          stats.write +=
            msg.tokens?.cache?.write || msg.info?.tokens?.cache?.write || 0;
          stats.duration +=
            msg.duration || msg.timing?.duration || msg.info?.duration || 0;
        });
        dispatch({ type: "RESET_SESSION_STATS", payload: stats });
        dispatch({ type: "CLEAR_SUBAGENTS_FOR_SESSION" });
        const { summariesByParentMessageId, detailsById } =
          extractSubagentsFromMessages(messages);
        if (Object.keys(summariesByParentMessageId).length > 0) {
          dispatch({
            type: "UPSERT_SUBAGENT_SUMMARIES",
            payload: summariesByParentMessageId,
          });
        }
        if (Object.keys(detailsById).length > 0) {
          dispatch({ type: "UPSERT_SUBAGENT_DETAIL", payload: detailsById });
        }
        let latestInteractive: InteractiveEvent[] = [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const msg = messages[index];
          const role = msg.role ?? msg.info?.role;
          const items = interactiveEventsFromMessage(msg);
          if (items.length > 0) {
            latestInteractive = items;
            break;
          }
          if (role === "user") {
            break;
          }
        }
        dispatch({
          type: "SET_INTERACTIVE_EVENTS",
          payload: latestInteractive,
        });
        break;
      }
      case "subagentSnapshot": {
        const summariesByParentMessageId = normalizeSubagentSummaryMap(
          data.summariesByParentMessageId ?? data.subagentsByParentMessageId,
        );
        const detailsById = normalizeSubagentDetailMap(
          data.detailsById ?? data.subagentDetailsById,
        );
        dispatch({ type: "CLEAR_SUBAGENTS_FOR_SESSION" });
        if (Object.keys(summariesByParentMessageId).length > 0) {
          dispatch({
            type: "UPSERT_SUBAGENT_SUMMARIES",
            payload: summariesByParentMessageId,
          });
        }
        if (Object.keys(detailsById).length > 0) {
          dispatch({ type: "UPSERT_SUBAGENT_DETAIL", payload: detailsById });
        }
        break;
      }
      case "subagentUpdate": {
        const summariesByParentMessageId = normalizeSubagentSummaryMap(
          data.summariesByParentMessageId ?? data.subagentsByParentMessageId,
        );
        const detailsById = normalizeSubagentDetailMap(
          data.detailsById ?? data.subagentDetailsById,
        );
        if (Object.keys(summariesByParentMessageId).length > 0) {
          dispatch({
            type: "UPSERT_SUBAGENT_SUMMARIES",
            payload: summariesByParentMessageId,
          });
        }
        if (Object.keys(detailsById).length > 0) {
          dispatch({ type: "UPSERT_SUBAGENT_DETAIL", payload: detailsById });
        }
        break;
      }
      case "streamEvent": {
        const payload = asRecord(data.event) ?? data;
        handleStreamEvent(dispatch, getState, payload);
        break;
      }
      case "error": {
        const errorMsg = asString(data.message, "Unknown error");

        // If we were in the middle of a stream, preserve it as a message so the user
        // can see partial output + the error banner + retry.
        // NOTE: In that case, the error is shown via partialMessage.error inside
        // AssistantMessage, so we must NOT also dispatch ADD_ERROR_MESSAGE — that
        // would render a second, duplicate "Request Failed" banner above the message.
        const currentStreaming = getState().streaming;
        if (currentStreaming) {
          const partialMessage: Message = {
            id: currentStreaming.messageId || `error-${Date.now()}`,
            role: "assistant",
            agent: currentStreaming.agent,
            modelID: currentStreaming.modelID,
            providerID: currentStreaming.providerID,
            content: currentStreaming.content,
            reasoningEvents: currentStreaming.reasoningEvents,
            steps: currentStreaming.steps as any,
            created: Date.now(),
            error: errorMsg,
          };
          const messages = getState().messages;
          dispatch({
            type: "SET_MESSAGES",
            payload: [...messages, partialMessage],
          });
        } else {
          // No active stream — show the error as a top-level banner since there is no
          // message card to attach it to.
          dispatch({
            type: "ADD_ERROR_MESSAGE",
            payload: errorMsg,
          });
        }

        dispatch({ type: "SET_PROCESSING", payload: false });
        dispatch({ type: "FINISH_STREAMING" });
        dispatch({ type: "SET_STREAMING", payload: null });
        break;
      }
      case "appendPrompt": {
        const current = getState().inputValue;
        const extra = asString(data.text);
        const next = current ? `${current}\n${extra}` : extra;
        dispatch({ type: "SET_INPUT_VALUE", payload: next });
        break;
      }
      case "addContext": {
        const item = asRecord(data.context);
        if (!item) {
          break;
        }
        const context: ContextItem = {
          file: asString(item.file) || "",
          lineInfo: asString(item.lineInfo) || "",
          isAuto: asBoolean(item.isAuto, false),
          content: asString(item.content),
          languageId: asString(item.languageId),
        };
        if (!context.file) {
          break;
        }
        const selected = getState().selectedContexts;

        let nextSelected = [...selected];

        // If it's an auto context, remove any existing auto context
        if (context.isAuto) {
          nextSelected = nextSelected.filter((c) => !c.isAuto);
        }

        // Avoid exact duplicates
        const exists = nextSelected.some(
          (c) => c.file === context.file && c.lineInfo === context.lineInfo,
        );

        if (!exists) {
          nextSelected.push(context);
        }

        dispatch({ type: "SET_SELECTED_CONTEXTS", payload: nextSelected });
        break;
      }
      case "clearAutoContext": {
        const selected = getState().selectedContexts;
        const nextSelected = selected.filter((c) => !c.isAuto);
        if (nextSelected.length !== selected.length) {
          dispatch({ type: "SET_SELECTED_CONTEXTS", payload: nextSelected });
        }
        break;
      }
      case "fileSearchResults": {
        const results = asArray(data.results, isFileResult);
        dispatch({ type: "SET_FILE_SUGGESTIONS", payload: results });
        dispatch({
          type: "SET_SHOW_FILE_SUGGESTIONS",
          payload: results.length > 0,
        });
        dispatch({ type: "SET_SUGGESTION_INDEX", payload: 0 });
        break;
      }
      case "sessionsList": {
        dispatch({
          type: "SET_SESSIONS_LIST",
          payload: asArray(data.sessions, isSession),
        });
        dispatch({
          type: "SET_SESSION_ID",
          payload: asString(data.currentSessionId) || null,
        });
        break;
      }
      case "queueUpdate": {
        dispatch({
          type: "SET_QUEUE",
          payload: asArray(data.queue, isQueueItem),
        });
        break;
      }
      case "queueExecutionStarted": {
        dispatch({ type: "SET_EXECUTING_QUEUE", payload: true });
        break;
      }
      case "queueExecutionFinished": {
        dispatch({ type: "SET_EXECUTING_QUEUE", payload: false });
        break;
      }
      case "quotaData":
      case "quotaUpdate": {
        dispatch({ type: "SET_QUOTA_DATA", payload: data.data as QuotaData });
        break;
      }
      case "budgetInfo": {
        dispatch({ type: "SET_BUDGET_INFO", payload: data.data as BudgetInfo });
        break;
      }
      case "mcpStatus": {
        // Payload: { servers: Record<string, { status: string; error?: string }>, toolIds?: string[] }
        const serversRec = asRecord(data.servers);
        const toolIds: string[] = Array.isArray(data.toolIds)
          ? (data.toolIds as unknown[]).filter(
            (t): t is string => typeof t === "string",
          )
          : [];
        if (serversRec) {
          const mcpServers: McpServerInfo[] = Object.entries(serversRec).map(
            ([name, raw]) => {
              const entry = asRecord(raw);
              const status =
                (asString(entry?.status) as McpServerStatus) || "disconnected";
              const error = entry?.error ? asString(entry.error) : undefined;
              // Associate tools whose ID starts with `name/` convention
              const serverTools = toolIds.filter(
                (id) =>
                  id === name ||
                  id.startsWith(`${name}/`) ||
                  id.startsWith(`${name}_`),
              );
              return { name, status, error, tools: serverTools };
            },
          );
          dispatch({ type: "SET_MCP_SERVERS", payload: mcpServers });
        }
        break;
      }
      case "lspStatus": {
        // Payload: { servers: Array<LspStatus> }
        const rawServers = Array.isArray(data.servers) ? data.servers : [];
        const lspServers: LspServerInfo[] = rawServers.map((raw) => {
          const entry = asRecord(raw) ?? {};
          return {
            id: asString(entry.id),
            name: asString(entry.name),
            root: asString(entry.root),
            status: asString(entry.status) === "error" ? "error" : "connected",
          };
        });
        dispatch({ type: "SET_LSP_SERVERS", payload: lspServers });
        break;
      }
      case "todoUpdate": {
        const action = asString(data.action);
        const item = asRecord(data.item);
        if (!item) break;
        const todoId = asString(item.id);
        const patch: any = {};
        if (typeof item.text === "string") patch.text = item.text;
        if (typeof item.status === "string") patch.status = item.status;
        if (typeof item.sessionId === "string")
          patch.sessionId = item.sessionId;
        if (action === "add") {
          dispatch({
            type: "ADD_TODO_ITEM",
            payload: {
              id: todoId,
              text: asString(item.text),
              status: asString(item.status) as any,
              sessionId: asString(item.sessionId),
            },
          });
        } else if (action === "update") {
          dispatch({
            type: "UPDATE_TODO_ITEM",
            payload: { id: todoId, patch },
          });
        }
        break;
      }
      case "thinkingLevelUpdate": {
        const level = asString(data.level) as any;
        if (level) {
          dispatch({ type: "SET_THINKING_LEVEL", payload: level });
        }
        break;
      }
      case "addPlanAttachment": {
        const p = asRecord(data.payload);
        if (!p) break;
        dispatch({
          type: "ADD_ATTACHMENT",
          payload: {
            id: asString(p.id) || `plan-${Date.now()}`,
            filename: asString(p.filename, "Implementation Plan"),
            mimeType: asString(p.mimeType, "text/markdown"),
            dataUrl: asString(p.dataUrl),
          },
        });
        break;
      }
      case "injectThemeCss": {
        const css = asString(data.css);
        if (css) {
          let styleTag = document.getElementById("vscode-theme-icons");
          if (!styleTag) {
            styleTag = document.createElement("style");
            styleTag.id = "vscode-theme-icons";
            document.head.appendChild(styleTag);
          }
          styleTag.textContent = css;
        }
        break;
      }
      default:
        break;
    }

    const candidate = asRecord(data.message);
    if (candidate) {
      const text = extractMessageText(candidate as Message);
      if (text && asString(data.type) === "appendPrompt") {
        const current = getState().inputValue;
        dispatch({
          type: "SET_INPUT_VALUE",
          payload: current ? `${current}\n${text}` : text,
        });
      }
    }
  };
}
