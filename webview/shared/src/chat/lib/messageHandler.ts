import type { Dispatch } from 'react';

import type { AppAction } from './store';
import type {
  AppState,
  ContextItem,
  FileResult,
  Message,
  QueueItem,
  QuotaData,
  Session,
  StreamingState,
  StreamingStep,
  SubagentDetail,
  SubagentSummary
} from './types';

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

type StructuredOutput = {
  responseType?: string;
  message?: string;
  reasoning?: string[];
  progressUpdates?: StructuredProgressUpdate[];
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

  const responseType =
    asString(rec.responseType) || asString(rec.type) || asString(rec.kind) || undefined;
  const message =
    asString(rec.message) ||
    asString(rec.output) ||
    asString(rec.answer) ||
    asString(rec.content) ||
    asString(rec.text) ||
    undefined;

  const reasoningRaw = rec.reasoning ?? rec.thinking ?? rec.thoughts;
  const reasoning = Array.isArray(reasoningRaw)
    ? reasoningRaw
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : typeof reasoningRaw === 'string' && reasoningRaw.trim()
      ? [reasoningRaw.trim()]
      : [];

  const progressRaw = rec.progressUpdates ?? rec.progress_updates;
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
          const status =
            statusValue === 'pending' || statusValue === 'done' || statusValue === 'error'
              ? statusValue
              : undefined;
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

  if (!responseType && !message && reasoning.length === 0 && progressUpdates.length === 0) {
    return undefined;
  }

  return {
    responseType,
    message,
    reasoning: reasoning.length > 0 ? reasoning : undefined,
    progressUpdates: progressUpdates.length > 0 ? progressUpdates : undefined
  };
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
  if (partType === 'reasoning' || partType === 'step-start' || partType === 'tool' || partType === 'patch') {
    return true;
  }

  const reasoningLike =
    asString(part.reasoning) || asString(part.thought) || asString(part.thinking);
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
          const messageID = asString(ref.messageID) || undefined;
          const partID = asString(ref.partID) || undefined;
          const callID = asString(ref.callID) || undefined;
          if (!messageID && !partID && !callID) {
            return null;
          }
          return { messageID, partID, callID };
        })
        .filter((entry): entry is NonNullable<SubagentSummary['references'][number]> => !!entry)
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
          return {
            id: asString(evt.id) || `${summary.id}:thinking:${index}`,
            text,
            createdAt: asNumber(evt.createdAt, Date.now()),
            messageID: asString(evt.messageID) || undefined,
            partID: asString(evt.partID) || undefined
          };
        })
        .filter((entry): entry is SubagentDetail['thinkingEvents'][number] => !!entry)
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
          return {
            id: asString(evt.id) || `${summary.id}:progress:${index}`,
            title,
            status: asString(evt.status) === 'done' || asString(evt.status) === 'error' ? (asString(evt.status) as 'done' | 'error') : 'pending',
            meta: asString(evt.meta) || undefined,
            filePath: asString(evt.filePath) || undefined,
            createdAt: asNumber(evt.createdAt, Date.now()),
            messageID: asString(evt.messageID) || undefined,
            partID: asString(evt.partID) || undefined,
            callID: asString(evt.callID) || undefined
          };
        })
        .filter((entry): entry is SubagentDetail['progressEvents'][number] => !!entry)
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
          return {
            key: key || `${summary.id}:timeline:${index}`,
            type,
            label,
            createdAt: asNumber(evt.createdAt, Date.now()),
            messageID: asString(evt.messageID) || undefined,
            partID: asString(evt.partID) || undefined,
            callID: asString(evt.callID) || undefined
          };
        })
        .filter((entry): entry is SubagentDetail['timelineEvents'][number] => !!entry)
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

function buildStreamingMessage(streaming: StreamingState): Message {
  const parts = [
    {
      type: 'text',
      text: streaming.content
    }
  ];
  if (streaming.reasoning) {
    parts.push({
      type: 'reasoning',
      reasoning: streaming.reasoning
    });
  }

  return {
    role: 'assistant',
    content: streaming.content || streaming.reasoning,
    parts,
    reasoningEvents: streaming.reasoningEvents,
    progressEvents: streaming.progressEvents.map((step) => ({
      type: step.type,
      title: step.title,
      content: step.filePath,
      status: step.status,
      meta: step.meta
    })),
    steps: streaming.steps.map((step) => ({
      type: step.type,
      title: step.title,
      content: step.filePath,
      status: step.status,
      meta: step.meta
    })),
    edits: streaming.edits.map((file) => ({ file })),
    info: {
      id: streaming.messageId ?? undefined,
      duration: streaming.usage?.duration
    }
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

  // Ignore stray global stream events when the user has not started a request.
  // This prevents phantom "Thinking..." / streaming UI on extension open.
  if (!current && !state.isProcessing && !isExplicitStart && !isAssistantUpdateStart && !canBootstrapFromPart) {
    return;
  }

  // Only bootstrap a streaming card from explicit assistant lifecycle events.
  // This prevents user-side echo events from becoming assistant output.
  if (!current && !isExplicitStart && !isAssistantUpdateStart && !canBootstrapFromPart) {
    return;
  }

  if (!current && (isExplicitStart || isAssistantUpdateStart || canBootstrapFromPart)) {
    dispatch({
      type: 'SET_STREAMING',
      payload: {
        messageId,
        content: '',
        reasoning: '',
        reasoningEvents: [],
        steps: [],
        progressEvents: [],
        edits: [],
        isActive: true
      }
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
      const delta =
        asString(properties?.delta) || asString(payload.delta) || asString(part.delta);
      const reasoningChunk =
        asString(part.reasoning) || asString(part.thought) || asString(part.thinking);
      const textChunk =
        structuredText || delta || asRichString(part.text) || asRichString(part.content);

      const isReasoning = structuredKind === 'thinking' || partType === 'reasoning' || !!reasoningChunk;
      if (isReasoning) {
        const nextReasoning = sanitizeReasoningChunk(reasoningChunk || structuredText || delta);
        if (nextReasoning) {
          dispatch({
            type: 'UPDATE_STREAMING_REASONING',
            payload: { reasoning: nextReasoning, append: true }
          });
        }
      } else if (
        structuredKind === 'message' ||
        partType === 'text' ||
        (!partType && structuredKind !== 'progress')
      ) {
        // Ignore id-like echoes that can appear before assistant output begins.
        if (isOpaqueIdLike(textChunk.trim())) {
          dispatch({ type: 'SET_PROCESSING', payload: true });
          break;
        }
        const streamingState = getState().streaming;
        const contentEmpty = !streamingState || !streamingState.content.trim();
        const cleanedChunk = contentEmpty ? stripLeadingUserEcho(textChunk, getState()) : textChunk;
        if (cleanedChunk) {
          dispatch({
            type: 'UPDATE_STREAMING_CONTENT',
            payload: { content: cleanedChunk, append: true }
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
        dispatch({
          type: 'UPDATE_STREAMING_STEP',
          payload: {
            id: asString(part.id) || undefined,
            callID: asString(part.callID) || undefined,
            patch: {
              status: 'done',
              duration: asOptionalNumber(asRecord(part.timing)?.duration)
            }
          }
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
          asString(part.filePath) ||
          undefined;
        const callID = asString(part.callID) || undefined;
        const title = asString(part.title) || (tool ? `Running ${tool}...` : inferredStepTitle(part));

        const existing = getState().streaming?.steps.find(
          (step) => !!callID && step.callID === callID
        );
        if (!existing) {
          dispatch({
            type: 'ADD_STREAMING_STEP',
            payload: {
              id: asString(part.id) || undefined,
              callID,
              title,
              type: 'tool',
              status: asString(part.status) === 'error' ? 'error' : 'pending',
              meta: asString(part.meta) || undefined,
              filePath,
              startTime: Date.now()
            }
          });
        } else {
          dispatch({
            type: 'UPDATE_STREAMING_STEP',
            payload: {
              callID,
              patch: {
                title,
                status:
                  asString(part.status) === 'done'
                    ? 'done'
                    : asString(part.status) === 'error'
                      ? 'error'
                      : existing.status,
                meta: asString(part.meta) || existing.meta,
                filePath: filePath || existing.filePath
              }
            }
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
      dispatch({
        type: 'SET_STREAMING',
        payload: {
          messageId,
          content: '',
          reasoning: '',
          reasoningEvents: [],
          steps: [],
          progressEvents: [],
          edits: [],
          isActive: true
        }
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

    switch (type) {
      case 'initState':
      case 'init': {
        const state = asRecord(data.state) ?? data;
        const sessionId = asString(state.sessionId) || asString(state.currentSessionId) || null;

        const selectedModelRecord = asRecord(state.selectedModel);
        const selectedModel = selectedModelRecord
          ? {
              providerID: asString(selectedModelRecord.providerID),
              modelID: asString(selectedModelRecord.modelID)
            }
          : null;

        dispatch({ type: 'SET_SESSION_ID', payload: sessionId });
        dispatch({ type: 'SET_SERVER_STATUS', payload: asString(state.serverStatus, 'connected') });
        dispatch({
          type: 'SET_SELECTED_MODEL',
          payload: selectedModel?.providerID && selectedModel?.modelID ? selectedModel : null
        });
        dispatch({ type: 'SET_SELECTED_AGENT', payload: asString(state.selectedAgent) });
        dispatch({ type: 'SET_RECEIVED_INIT_STATE', payload: true });
        break;
      }
      case 'modelsList': {
        const models = asArray(data.models, (item): item is AppState['availableModels'][number] => {
          const rec = asRecord(item);
          return !!rec && typeof rec.modelID === 'string' && typeof rec.providerID === 'string' && typeof rec.name === 'string';
        });
        dispatch({ type: 'SET_MODELS_LIST', payload: models });
        break;
      }
      case 'agentsList': {
        const agents = asArray(data.agents, (item): item is AppState['availableAgents'][number] => {
          const rec = asRecord(item);
          return !!rec && typeof rec.id === 'string' && typeof rec.name === 'string' && typeof rec.description === 'string';
        });
        dispatch({ type: 'SET_AGENTS_LIST', payload: agents });
        break;
      }
      case 'statusUpdate': {
        dispatch({ type: 'SET_SERVER_STATUS', payload: asString(data.status, 'unknown') });
        break;
      }
      case 'messageResponse': {
        const msg = (asRecord(data.message) as Message | null) ?? (data as unknown as Message);
        const currentMessages = getState().messages;

        // FORBIDDEN TO REMOVE - token accumulation for sticky header
        dispatch({
          type: 'ACCUMULATE_SESSION_STATS',
          payload: {
            input: msg.info?.tokens?.input || 0,
            output: msg.info?.tokens?.output || 0,
            read: msg.info?.tokens?.cache?.read || 0,
            write: msg.info?.tokens?.cache?.write || 0,
            duration: msg.info?.duration || 0
          }
        });

        const streaming = getState().streaming;
        const normalizedMessage = isMessage(msg)
          ? normalizeMessage(msg, streaming)
          : streaming
            ? buildStreamingMessage(streaming)
            : undefined;
        if (normalizedMessage) {
          const sanitized = sanitizeAssistantMessageEcho(normalizedMessage, getState());
          dispatch({ type: 'SET_MESSAGES', payload: [...currentMessages, sanitized] });
          const { summariesByParentMessageId, detailsById } = extractSubagentsFromMessages([sanitized]);
          if (Object.keys(summariesByParentMessageId).length > 0) {
            dispatch({ type: 'UPSERT_SUBAGENT_SUMMARIES', payload: summariesByParentMessageId });
          }
          if (Object.keys(detailsById).length > 0) {
            dispatch({ type: 'UPSERT_SUBAGENT_DETAIL', payload: detailsById });
          }
        }
        dispatch({ type: 'SET_PROCESSING', payload: false });
        dispatch({ type: 'SET_STREAMING', payload: null });
        break;
      }
      case 'chatHistory': {
        const messages = asArray(data.messages, isMessage)
          .map((msg) => normalizeMessage(msg, null))
          .filter((msg): msg is Message => !!msg);
        dispatch({ type: 'CLEAR_MESSAGES' });
        dispatch({ type: 'SET_MESSAGES', payload: messages });

        // FORBIDDEN TO REMOVE - recalculate session stats from full history
        const stats = { input: 0, output: 0, read: 0, write: 0, duration: 0 };
        messages.forEach((msg) => {
          stats.input += msg.info?.tokens?.input || 0;
          stats.output += msg.info?.tokens?.output || 0;
          stats.read += msg.info?.tokens?.cache?.read || 0;
          stats.write += msg.info?.tokens?.cache?.write || 0;
          stats.duration += msg.info?.duration || 0;
        });
        dispatch({ type: 'RESET_SESSION_STATS', payload: stats });
        dispatch({ type: 'CLEAR_SUBAGENTS_FOR_SESSION' });
        const { summariesByParentMessageId, detailsById } = extractSubagentsFromMessages(messages);
        if (Object.keys(summariesByParentMessageId).length > 0) {
          dispatch({ type: 'UPSERT_SUBAGENT_SUMMARIES', payload: summariesByParentMessageId });
        }
        if (Object.keys(detailsById).length > 0) {
          dispatch({ type: 'UPSERT_SUBAGENT_DETAIL', payload: detailsById });
        }
        break;
      }
      case 'subagentSnapshot': {
        const summariesByParentMessageId = normalizeSubagentSummaryMap(
          data.summariesByParentMessageId ?? data.subagentsByParentMessageId
        );
        const detailsById = normalizeSubagentDetailMap(data.detailsById ?? data.subagentDetailsById);
        dispatch({ type: 'CLEAR_SUBAGENTS_FOR_SESSION' });
        if (Object.keys(summariesByParentMessageId).length > 0) {
          dispatch({ type: 'UPSERT_SUBAGENT_SUMMARIES', payload: summariesByParentMessageId });
        }
        if (Object.keys(detailsById).length > 0) {
          dispatch({ type: 'UPSERT_SUBAGENT_DETAIL', payload: detailsById });
        }
        break;
      }
      case 'subagentUpdate': {
        const summariesByParentMessageId = normalizeSubagentSummaryMap(
          data.summariesByParentMessageId ?? data.subagentsByParentMessageId
        );
        const detailsById = normalizeSubagentDetailMap(data.detailsById ?? data.subagentDetailsById);
        if (Object.keys(summariesByParentMessageId).length > 0) {
          dispatch({ type: 'UPSERT_SUBAGENT_SUMMARIES', payload: summariesByParentMessageId });
        }
        if (Object.keys(detailsById).length > 0) {
          dispatch({ type: 'UPSERT_SUBAGENT_DETAIL', payload: detailsById });
        }
        break;
      }
      case 'streamEvent': {
        const payload = asRecord(data.event) ?? data;
        handleStreamEvent(dispatch, getState, payload);
        break;
      }
      case 'error': {
        dispatch({ type: 'ADD_ERROR_MESSAGE', payload: asString(data.message, 'Unknown error') });
        dispatch({ type: 'SET_PROCESSING', payload: false });
        dispatch({ type: 'FINISH_STREAMING' });
        dispatch({ type: 'SET_STREAMING', payload: null });
        break;
      }
      case 'appendPrompt': {
        const current = getState().inputValue;
        const extra = asString(data.text);
        const next = current ? `${current}\n${extra}` : extra;
        dispatch({ type: 'SET_INPUT_VALUE', payload: next });
        break;
      }
      case 'addContext': {
        const item = asRecord(data.context);
        if (!item) {
          break;
        }
        const context: ContextItem = {
          file: asString(item.file),
          lineInfo: asString(item.lineInfo)
        };
        if (!context.file) {
          break;
        }
        const selected = getState().selectedContexts;
        dispatch({ type: 'SET_SELECTED_CONTEXTS', payload: [...selected, context] });
        break;
      }
      case 'fileSearchResults': {
        const results = asArray(data.results, isFileResult);
        dispatch({ type: 'SET_FILE_SUGGESTIONS', payload: results });
        dispatch({ type: 'SET_SHOW_FILE_SUGGESTIONS', payload: results.length > 0 });
        dispatch({ type: 'SET_SUGGESTION_INDEX', payload: 0 });
        break;
      }
      case 'sessionsList': {
        dispatch({ type: 'SET_SESSIONS_LIST', payload: asArray(data.sessions, isSession) });
        dispatch({ type: 'SET_SESSION_ID', payload: asString(data.currentSessionId) || null });
        break;
      }
      case 'queueUpdate': {
        dispatch({ type: 'SET_QUEUE', payload: asArray(data.queue, isQueueItem) });
        break;
      }
      case 'queueExecutionStarted': {
        dispatch({ type: 'SET_EXECUTING_QUEUE', payload: true });
        break;
      }
      case 'queueExecutionFinished': {
        dispatch({ type: 'SET_EXECUTING_QUEUE', payload: false });
        break;
      }
    case 'quotaData':
    case 'quotaUpdate': {
      dispatch({ type: 'SET_QUOTA_DATA', payload: data.data as QuotaData });
      break;
    }
    case 'todoUpdate': {
      const action = asString(data.action);
      const item = asRecord(data.item);
      if (!item) break;
      const todoId = asString(item.id);
      const patch: any = {};
      if (typeof item.text === 'string') patch.text = item.text;
      if (typeof item.status === 'string') patch.status = item.status;
      if (typeof item.sessionId === 'string') patch.sessionId = item.sessionId;
      if (action === 'add') {
        dispatch({ type: 'ADD_TODO_ITEM', payload: { id: todoId, text: asString(item.text), status: asString(item.status) as any, sessionId: asString(item.sessionId) } });
      } else if (action === 'update') {
        dispatch({ type: 'UPDATE_TODO_ITEM', payload: { id: todoId, patch } });
      }
      break;
    }
    case 'thinkingLevelUpdate': {
      const level = asString(data.level) as any;
      if (level) {
        dispatch({ type: 'SET_THINKING_LEVEL', payload: level });
      }
      break;
    }
    case 'addPlanAttachment': {
      const p = asRecord(data.payload);
      if (!p) break;
      dispatch({
        type: 'ADD_ATTACHMENT',
        payload: {
          id: asString(p.id) || `plan-${Date.now()}`,
          filename: asString(p.filename, 'Implementation Plan'),
          mimeType: asString(p.mimeType, 'text/markdown'),
          dataUrl: asString(p.dataUrl),
        }
      });
      break;
    }
      default:
        break;
    }

    if (asBoolean(data.processing, false)) {
      dispatch({ type: 'SET_PROCESSING', payload: true });
    }

    const candidate = asRecord(data.message);
    if (candidate) {
      const text = extractMessageText(candidate as Message);
      if (text && asString(data.type) === 'appendPrompt') {
        const current = getState().inputValue;
        dispatch({ type: 'SET_INPUT_VALUE', payload: current ? `${current}\n${text}` : text });
      }
    }
  };
}
