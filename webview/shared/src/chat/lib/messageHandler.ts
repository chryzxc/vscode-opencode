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
  MessagePart,
  QueueItem,
  QuotaData,
  SlashCommand,
  Session,
  StreamingState,
  StreamingStep,
  SubagentDetail,
  SubagentSummary,
  SubagentReference,
  SubagentThinkingEvent,
  SubagentProgressEvent,
  SubagentTimelineEvent,
  TodoItem,
} from "./types";
import type { StructuredResponseType } from "./generated/structuredOutputSchema";
import {
  sanitizeStructuredOutput,
  validateStructuredOutput,
} from "./structuredOutputValidator";
import vscode from "./vscode";

const STREAM_DEBUG_ENABLED =
  typeof window !== "undefined" &&
  (window as unknown as { __OPENCODE_STREAM_DEBUG__?: boolean })
    .__OPENCODE_STREAM_DEBUG__ === true;

function streamDebug(...args: unknown[]): void {
  if (STREAM_DEBUG_ENABLED) {
    console.debug(...args);
  }
}

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

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function asSessionStats(value: unknown): AppState["sessionStats"] | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const normalize = (raw: unknown): number | undefined =>
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0
      ? Math.floor(raw)
      : undefined;

  const input = normalize(rec.input);
  const output = normalize(rec.output);
  const read = normalize(rec.read);
  const write = normalize(rec.write);
  const duration = normalize(rec.duration);
  if (
    input === undefined &&
    output === undefined &&
    read === undefined &&
    write === undefined &&
    duration === undefined
  ) {
    return undefined;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    read: read ?? 0,
    write: write ?? 0,
    duration: duration ?? 0,
  };
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

function joinRichStringSegments(segments: string[]): string {
  let out = "";
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    if (!out) {
      out = segment;
      continue;
    }

    const prevChar = out[out.length - 1];
    const nextChar = segment[0];
    const hasWhitespaceBoundary = /\s/.test(prevChar) || /\s/.test(nextChar);
    const startsWithClosingPunctuation = /^[,.;:!?)}\]]/.test(segment);
    const endsWithOpeningPunctuation = /[(\[{]$/.test(prevChar);

    if (
      !hasWhitespaceBoundary &&
      !startsWithClosingPunctuation &&
      !endsWithOpeningPunctuation
    ) {
      out += " ";
    }

    out += segment;
  }
  return out;
}

function asRichString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return joinRichStringSegments(value.map((item) => asRichString(item)));
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

function looksLikeReasoningTrace(value: string, currentContent: string): boolean {
  const text = value.trim();
  if (!text || text.length < 60) {
    return false;
  }

  // If user-facing content is already underway, avoid reclassifying later chunks.
  if (currentContent.trim().length > 40) {
    return false;
  }

  const normalized = text.toLowerCase();
  let score = 0;

  const markerPhrases = [
    "the user is asking",
    "this is a straightforward informational question",
    "i don't need to",
    "not a request to implement",
    "not related to their specific codebase",
    "create todos",
    "use explore",
  ];
  markerPhrases.forEach((phrase) => {
    if (normalized.includes(phrase)) {
      score += 1;
    }
  });

  if (/\bi (?:need|should|must|will|can|can't)\b/.test(normalized)) {
    score += 1;
  }
  if (/^\s*(use|create|read|write|analyze|review)\b/im.test(text)) {
    score += 1;
  }
  if (
    /\b(not related to|general question|don't need to|straightforward informational question)\b/.test(
      normalized,
    )
  ) {
    score += 2;
  }

  return score >= 3;
}

function splitMixedReasoningFromContent(
  value: string,
): { content: string; reasoning: string } | null {
  const text = value.trim();
  if (!text || text.length < 40) {
    return null;
  }

  const markers = [
    /the\s*user\s*(?:is\s*asking|just\s*said)/i,
    /the\s*user\s*keeps?\s*saying/i,
    /let\s*me\s*check/i,
    /behavior\s*instructions?/i,
    /tone[_\s-]*and[_\s-]*style/i,
    /start\s*work\s*immediately/i,
    /\bi\s*should\b/i,
    /no\s*tools?\s*are\s*needed/i,
    /without\s*flattery/i,
  ];

  let splitIndex = -1;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (!match) continue;
    if (match.index <= 8) continue;
    if (splitIndex < 0 || match.index < splitIndex) {
      splitIndex = match.index;
    }
  }

  // Fallback for leaked text where spaces/punctuation are stripped
  // (e.g. "Theuserkeepssaying...Ishouldrespond...").
  const compactChars: string[] = [];
  const compactToRaw: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index].toLowerCase();
    if (/[a-z0-9]/.test(char)) {
      compactChars.push(char);
      compactToRaw.push(index);
    }
  }
  const compact = compactChars.join("");
  const compactMarkers = [
    "theuserisasking",
    "theuserjustsaid",
    "theuserkeepssaying",
    "letmecheck",
    "behaviorinstructions",
    "toneandstyle",
    "startworkimmediately",
    "ishouldrespond",
    "ishouldacknowledge",
    "ishouldreply",
    "notoolsareneeded",
    "withoutflattery",
  ];
  for (const marker of compactMarkers) {
    const compactIndex = compact.indexOf(marker);
    if (compactIndex <= 0 || compactIndex >= compactToRaw.length) {
      continue;
    }
    const rawIndex = compactToRaw[compactIndex];
    if (rawIndex <= 8) {
      continue;
    }
    if (splitIndex < 0 || rawIndex < splitIndex) {
      splitIndex = rawIndex;
    }
  }

  if (splitIndex < 0) {
    return null;
  }

  const content = text.slice(0, splitIndex).trim();
  const reasoning = text.slice(splitIndex).trim();
  if (content.length < 8 || reasoning.length < 20) {
    return null;
  }

  return { content, reasoning };
}

function needsBoundarySpace(previous: string, next: string): boolean {
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

function resolveStreamingContentUpdate(
  currentContent: string,
  incomingChunk: string,
  fromDelta: boolean,
): { content: string; append: boolean } | null {
  if (!incomingChunk) {
    return null;
  }

  if (!currentContent) {
    return { content: incomingChunk, append: false };
  }

  const withBoundary =
    fromDelta && needsBoundarySpace(currentContent, incomingChunk)
      ? ` ${incomingChunk}`
      : incomingChunk;

  if (fromDelta) {
    return { content: withBoundary, append: true };
  }

  const currentNormalized = currentContent.replace(/\r\n/g, '\n');
  const incomingNormalized = incomingChunk.replace(/\r\n/g, '\n');

  if (incomingNormalized === currentNormalized) {
    return null;
  }

  if (incomingNormalized.startsWith(currentNormalized)) {
    const remainder = incomingNormalized.slice(currentNormalized.length);
    if (!remainder) {
      return null;
    }
    const patchedRemainder =
      needsBoundarySpace(currentContent, remainder) ? ` ${remainder}` : remainder;
    return { content: patchedRemainder, append: true };
  }

  if (currentNormalized.startsWith(incomingNormalized)) {
    // Older snapshot; ignore to avoid regressions/flicker.
    return null;
  }

  // Non-delta updates are usually full snapshots from providers.
  return { content: incomingChunk, append: false };
}

function normalizePartType(value: unknown): string {
  const raw = asString(value).trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw === "thinking" || raw === "thought") {
    return "reasoning";
  }
  if (raw === "stepstart" || raw === "step_start") {
    return "step-start";
  }
  if (raw === "stepfinish" || raw === "step_finish") {
    return "step-finish";
  }
  if (raw === "toolcall" || raw === "tool_call" || raw === "tool-call") {
    return "tool";
  }
  return raw;
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

function normalizeDiffStats(
  value: unknown,
): { added: number; deleted: number } | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const addedRaw =
    typeof rec.added === "number" && Number.isFinite(rec.added)
      ? rec.added
      : undefined;
  const deletedRaw =
    typeof rec.deleted === "number" && Number.isFinite(rec.deleted)
      ? rec.deleted
      : undefined;
  if (typeof addedRaw !== "number" && typeof deletedRaw !== "number") {
    return undefined;
  }
  return {
    added: Math.max(0, addedRaw ?? 0),
    deleted: Math.max(0, deletedRaw ?? 0),
  };
}

function normalizeActivityStepRecord(value: unknown): MessageStep | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const title = asString(rec.title) || asString(rec.message);
  if (!title) {
    return undefined;
  }
  const filePath =
    asString(rec.filePath) ||
    asString(rec.content) ||
    asString(rec.file) ||
    asString(rec.path) ||
    undefined;
  const statusRaw = asString(rec.status);

  return {
    type: asString(rec.type) || "step",
    title,
    content: filePath,
    status: statusRaw ? normalizeProgressStatus(statusRaw) : undefined,
    meta: asString(rec.meta) || asString(rec.detail) || undefined,
    id: asString(rec.id) || undefined,
    callID: asString(rec.callID) || asString(rec.callId) || undefined,
    streamSeq: asOptionalNumber(rec.streamSeq),
    diffStats: normalizeDiffStats(rec.diffStats),
  };
}

function activityStepMergeKey(step: MessageStep, index: number): string {
  const callID = asString(step.callID).trim();
  if (callID) {
    return `call:${callID}`;
  }
  const id = asString(step.id).trim();
  if (id) {
    return `id:${id}`;
  }
  const title = asString(step.title).trim().toLowerCase();
  const content = asString(step.content).trim().toLowerCase();
  if (title || content) {
    return `title:${title}|content:${content}`;
  }
  return `index:${index}`;
}

function mergeCanonicalActivityStep(
  existing: MessageStep,
  incoming: MessageStep,
): MessageStep {
  const currentStatus = asString(existing.status);
  const nextStatus = asString(incoming.status);
  let status = currentStatus || undefined;
  if (nextStatus) {
    if (
      (currentStatus === "done" || currentStatus === "error") &&
      nextStatus === "pending"
    ) {
      status = currentStatus;
    } else {
      status = normalizeProgressStatus(nextStatus);
    }
  }

  const existingSeq = existing.streamSeq;
  const incomingSeq = incoming.streamSeq;
  let streamSeq = existingSeq;
  if (typeof streamSeq !== "number") {
    streamSeq = incomingSeq;
  } else if (typeof incomingSeq === "number") {
    streamSeq = Math.min(streamSeq, incomingSeq);
  }

  return {
    ...existing,
    ...incoming,
    title: incoming.title || existing.title,
    type: incoming.type || existing.type,
    status,
    meta: incoming.meta || existing.meta,
    content: incoming.content || existing.content,
    id: existing.id || incoming.id,
    callID: existing.callID || incoming.callID,
    streamSeq,
    diffStats: incoming.diffStats || existing.diffStats,
  };
}

function extractActivityStepsFromParts(parts: MessagePart[]): MessageStep[] {
  const fromParts: MessageStep[] = [];
  const seenCallIds = new Set<string>();
  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec || asString(rec.type).toLowerCase() !== "tool") {
      continue;
    }

    const tool = asString(rec.tool);
    const toolLower = tool.toLowerCase();
    if (
      toolLower.includes("structuredoutput") ||
      toolLower.includes("structured_output")
    ) {
      continue;
    }

    const callID = asString(rec.callID) || asString(rec.callId) || undefined;
    if (callID) {
      if (seenCallIds.has(callID)) {
        continue;
      }
      seenCallIds.add(callID);
    }

    const stateRec = asRecord(rec.state);
    const inputRec = asRecord(stateRec?.input);
    const resultRec = asRecord(stateRec?.result);
    const filePath =
      asString(inputRec?.file) ||
      asString(inputRec?.path) ||
      asString(inputRec?.filename) ||
      asString(inputRec?.TargetFile) ||
      asString(inputRec?.AbsolutePath) ||
      asString(inputRec?.uri) ||
      asString(inputRec?.DirectoryPath) ||
      asString(inputRec?.SearchPath) ||
      asString(inputRec?.SearchDirectory) ||
      asString(rec.filePath) ||
      undefined;
    const metaValues = [
      asString(inputRec?.CommandId),
      asString(inputRec?.CommandLine),
      asString(inputRec?.Query),
      asString(inputRec?.Pattern),
      asString(inputRec?.pattern),
      asString(inputRec?.command),
      asString(inputRec?.query),
      asString(inputRec?.url),
      asString(inputRec?.Url),
    ].filter(Boolean);
    const title = asString(rec.title) || (tool ? `${tool}` : "Tool call");
    const statusValue = asString(stateRec?.status ?? rec.status);

    fromParts.push({
      type: "tool",
      title,
      content: filePath,
      status: statusValue ? normalizeProgressStatus(statusValue) : "done",
      meta: asString(rec.meta) || metaValues[0] || undefined,
      id: asString(rec.id) || undefined,
      callID,
      streamSeq: asOptionalNumber(rec.streamSeq),
      diffStats:
        normalizeDiffStats(resultRec?.diffStats) ||
        normalizeDiffStats(rec.diffStats),
    });
  }
  return fromParts;
}

function normalizeActivitySteps(
  message: Message,
  streaming: StreamingState | null,
  sanitizedMergedParts: MessagePart[],
): MessageStep[] {
  const candidates: unknown[] = [];
  if (Array.isArray(message.steps)) {
    candidates.push(...message.steps);
  }
  if (Array.isArray(message.progressEvents)) {
    candidates.push(...message.progressEvents);
  }
  if (Array.isArray(streaming?.steps)) {
    candidates.push(...streaming.steps);
  }
  if (Array.isArray(streaming?.progressEvents)) {
    candidates.push(...streaming.progressEvents);
  }

  const merged: MessageStep[] = [];
  const indexByKey = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    const normalized = normalizeActivityStepRecord(candidate);
    if (!normalized) {
      return;
    }
    const key = activityStepMergeKey(normalized, index);
    const existingIndex = indexByKey.get(key);
    if (typeof existingIndex !== "number") {
      indexByKey.set(key, merged.length);
      merged.push(normalized);
      return;
    }
    merged[existingIndex] = mergeCanonicalActivityStep(
      merged[existingIndex],
      normalized,
    );
  });

  if (merged.length > 0) {
    return merged;
  }
  return extractActivityStepsFromParts(sanitizedMergedParts);
}

type StructuredInteractiveEvent = {
  type: 'question' | 'confirm' | 'quick_actions' | 'message';
  id?: string;
  title?: string;
  question?: string;
  message?: string;
  options?: InteractiveChoice[];
  actions?: InteractiveChoice[];
  confirmLabel?: string;
  cancelLabel?: string;
  dismissLabel?: string;
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
  responseType?: StructuredResponseType | string;
  assistantMessage?: string;
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
  if (!responseType) {
    return undefined;
  }
  const assistantMessage =
    asString(sanitizedRec.assistantMessage) ||
    asString(sanitizedRec.message) ||
    undefined;
  const message = asString(sanitizedRec.message) || undefined;

  const reasoningRaw =
    sanitizedRec.reasoning;
  const reasoning = Array.isArray(reasoningRaw)
    ? reasoningRaw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : typeof reasoningRaw === 'string' && reasoningRaw.trim()
      ? [reasoningRaw.trim()]
      : [];
  const normalizeComparableText = (value: string): string =>
    value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim().toLowerCase();
  const stripAssistantEchoFromReasoning = (
    chunk: string,
    replyText?: string,
  ): string => {
    const trimmedChunk = chunk.trim();
    if (!trimmedChunk) {
      return "";
    }
    if (!replyText) {
      return trimmedChunk;
    }
    const trimmedReply = replyText.trim();
    if (!trimmedReply) {
      return trimmedChunk;
    }
    if (
      normalizeComparableText(trimmedChunk) ===
      normalizeComparableText(trimmedReply)
    ) {
      return "";
    }
    if (trimmedChunk.startsWith(trimmedReply)) {
      return trimmedChunk
        .slice(trimmedReply.length)
        .replace(/^[\s:;,\-.!?]+/, "")
        .trim();
    }
    return trimmedChunk;
  };
  const cleanedReasoning = reasoning
    .map((chunk) =>
      stripAssistantEchoFromReasoning(chunk, assistantMessage || message),
    )
    .filter(Boolean);

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
      if (!question || options.length < 2) {
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

    if (typeRaw === 'message') {
      const message =
        asString(event.message) ||
        asString(event.content) ||
        asString(event.text);
      if (!message) {
        return undefined;
      }
      return {
        type: 'message',
        id,
        title: asString(event.title) || undefined,
        message,
        dismissLabel:
          asString(event.dismissLabel) ||
          asString(event.dismiss_label) ||
          undefined,
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
    if (rootQuestion && rootOptions.length >= 2) {
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

  const isInteractiveResponseType =
    responseType === 'question' || responseType === 'interactive';
  if (interactiveEvents.length === 0 && isInteractiveResponseType) {
    const fallbackQuestion =
      asString(rec.question) ||
      asString(rec.prompt) ||
      message ||
      "I need a quick clarification before I continue.";
    interactiveEvents = [
      {
        type: 'question',
        id: `interactive-${Date.now()}-fallback`,
        title: asString(rec.title) || "Question",
        question: fallbackQuestion,
        options: [
          { id: "yes", label: "Yes", value: "yes" },
          { id: "no", label: "No", value: "no" },
        ],
        allowCustomInput: true,
      },
    ];
  }

  const subagentsRaw =
    sanitizedRec.subagents ?? (rec.spawnedSubagents as unknown);
  const normalizeSubagentStatus = (value: string): SubagentSummary['status'] => {
    const lowered = value.toLowerCase();
    if (lowered === 'running' || lowered === 'done' || lowered === 'error' || lowered === 'orphaned') {
      return lowered;
    }
    return 'pending';
  };
  const normalizeSubagentProgressEvents = (
    raw: unknown,
    subagentId: string,
  ): SubagentProgressEvent[] | undefined => {
    if (!Array.isArray(raw)) {
      return undefined;
    }
    const events = raw
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
          id: asString(evt.id) || `${subagentId}:progress:${index}`,
          title,
          status: normalizeProgressStatus(asString(evt.status)),
          meta: asString(evt.meta) || undefined,
          filePath:
            asString(evt.filePath) ||
            asString(evt.file) ||
            asString(evt.path) ||
            undefined,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
          callID: asString(evt.callID) || undefined,
        } as SubagentProgressEvent;
      })
      .filter((item): item is SubagentProgressEvent => !!item);
    return events.length > 0 ? events : undefined;
  };
  const normalizeSubagentThinkingEvents = (
    raw: unknown,
    subagentId: string,
  ): SubagentThinkingEvent[] | undefined => {
    if (!Array.isArray(raw)) {
      return undefined;
    }
    const events = raw
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
          id: asString(evt.id) || `${subagentId}:thinking:${index}`,
          text,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
        } as SubagentThinkingEvent;
      })
      .filter((item): item is SubagentThinkingEvent => !!item);
    return events.length > 0 ? events : undefined;
  };
  const normalizeSubagentTimelineEvents = (
    raw: unknown,
    subagentId: string,
  ): SubagentTimelineEvent[] | undefined => {
    if (!Array.isArray(raw)) {
      return undefined;
    }
    const events = raw
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const label = asString(evt.label);
        if (!label) {
          return null;
        }
        return {
          key: asString(evt.key) || `${subagentId}:timeline:${index}`,
          type: asString(evt.type) || 'event',
          label,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
          callID: asString(evt.callID) || undefined,
        } as SubagentTimelineEvent;
      })
      .filter((item): item is SubagentTimelineEvent => !!item);
    return events.length > 0 ? events : undefined;
  };
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
        return {
          id,
          name: asString(subagent.name) || asString(subagent.agentId) || undefined,
          status: asString(subagent.status) ? normalizeSubagentStatus(asString(subagent.status)) : undefined,
          progress: typeof subagent.progress === 'number' ? subagent.progress : undefined,
          description: asString(subagent.description) || undefined,
          latestActivity: asString(subagent.latestActivity) || asString(subagent.description) || undefined,
          childSessionId: asString(subagent.childSessionId) || undefined,
          parentSessionId: asString(subagent.parentSessionId) || undefined,
          parentMessageId: asString(subagent.parentMessageId) || undefined,
          progressEvents: normalizeSubagentProgressEvents(subagent.progressEvents, id),
          thinkingEvents: normalizeSubagentThinkingEvents(subagent.thinkingEvents, id),
          timelineEvents: normalizeSubagentTimelineEvents(subagent.timelineEvents, id),
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
                parentMessageId: asString(subagent.parentMessageId) || undefined,
                progressEvents: normalizeSubagentProgressEvents(subagent.progressEvents, id),
                thinkingEvents: normalizeSubagentThinkingEvents(subagent.thinkingEvents, id),
                timelineEvents: normalizeSubagentTimelineEvents(subagent.timelineEvents, id),
              } as StructuredSubagent;
            })
            .filter(Boolean) as StructuredSubagent[]
        }
      : undefined;

  if (
    !assistantMessage &&
    !message &&
    cleanedReasoning.length === 0 &&
    progressUpdates.length === 0 &&
    interactiveEvents.length === 0 &&
    subagents.length === 0 &&
    !subagentsDelta
  ) {
    return undefined;
  }

  return {
    responseType,
    assistantMessage,
    message,
    reasoning: cleanedReasoning.length > 0 ? cleanedReasoning : undefined,
    progressUpdates: progressUpdates.length > 0 ? progressUpdates : undefined,
    interactiveEvents: interactiveEvents.length > 0 ? interactiveEvents : undefined,
    subagents: subagents.length > 0 ? subagents : undefined,
    subagentsDelta
  };
}

// Normalize incoming todo-like records into a canonical Todo shape used by the
// reducer ingestion path. Returns null for malformed entries so callers can
// skip without throwing.
function normalizeTodoRecord(raw: unknown): { id: string; text: string; status: TodoItem['status']; sessionId?: string } | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = asString(rec.id).trim();
  const text = asString(rec.text).trim();
  const statusRaw = asString(rec.status).trim().toLowerCase();
  const sessionId = asOptionalString(rec.sessionId);

  if (!id || !text) return null;

  const allowedStatuses = new Set([
    'pending',
    'in_progress',
    'completed',
    'cancelled',
    'failed',
  ]);
  if (!allowedStatuses.has(statusRaw)) return null;

  return { id, text, status: statusRaw as TodoItem['status'], sessionId };
}

// Given a normalized todo record, decide whether to ADD_TODO_ITEM or
// UPDATE_TODO_ITEM so both stream-derived structured payloads and explicit
// todoUpdate postMessage events follow one ingestion path and produce the
// same reducer state. Malformed items are ignored by callers before calling
// this helper.
function ingestNormalizedTodo(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  item: { id: string; text: string; status: TodoItem['status']; sessionId?: string },
): void {
  const existingIds = new Set((getState().todoItems || []).map((t) => t.id));
  if (existingIds.has(item.id)) {
    const patch: Partial<TodoItem> = { text: item.text, status: item.status };
    if (item.sessionId) patch.sessionId = item.sessionId;
    dispatch({ type: 'UPDATE_TODO_ITEM', payload: { id: item.id, patch } });
  } else {
    dispatch({
      type: 'ADD_TODO_ITEM',
      payload: {
        id: item.id,
        text: item.text,
        status: item.status,
        sessionId: item.sessionId ?? '',
      },
    });
  }
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
        if (!event.question || options.length < 2) {
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
      if (event.type === 'message') {
        if (!event.message) {
          return undefined;
        }
        return {
          type: 'message',
          id,
          title: event.title,
          message: event.message,
          dismissLabel: event.dismissLabel,
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

  const description = asString(part.description).trim();
  if (description && !isOpaqueIdLike(description)) {
    return description;
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

  const partType = normalizePartType(part.type);
  if (partType === "subtask") {
    return "Starting subtask";
  }
  if (partType === "agent") {
    return "Assigning agent";
  }
  if (partType === "step-start") {
    return "Starting step";
  }
  if (partType === "step-finish") {
    return "Finishing step";
  }
  if (partType === "patch") {
    return "Applying patch";
  }
  if (partType === "tool") {
    return "Running tool";
  }
  if (partType) {
    return `Processing ${partType}`;
  }

  return "Working...";
}

function shouldBootstrapStreamingFromPart(part: UnknownRecord | null): boolean {
  if (!part) {
    return false;
  }

  const partType = normalizePartType(part.type);
  // Include text parts to bootstrap streaming for regular content chunks
  if (
    partType === "reasoning" ||
    partType === "step-start" ||
    partType === "tool" ||
    partType === "patch" ||
    partType === "text" ||
    partType === "subtask" ||
    partType === "agent"
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
  const type = normalizePartType(part.type);
  return (
    type === 'reasoning' ||
    typeof part.reasoning !== 'undefined' ||
    typeof part.thought !== 'undefined' ||
    typeof part.thinking !== 'undefined'
  );
}

function upsertStreamingStep(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  step: StreamingStep,
): void {
  const title = step.title.trim();
  if (!title) {
    return;
  }

  const streaming = getState().streaming;
  if (!streaming) {
    dispatch({
      type: "ADD_STREAMING_STEP",
      payload: {
        ...step,
        title,
      },
    });
    return;
  }

  const titleKey = title.toLowerCase();
  const idx = streaming.steps.findIndex(
    (candidate) =>
      (step.id && candidate.id === step.id) ||
      (step.callID && candidate.callID === step.callID) ||
      candidate.title.trim().toLowerCase() === titleKey,
  );

  if (idx < 0) {
    dispatch({
      type: "ADD_STREAMING_STEP",
      payload: {
        ...step,
        title,
      },
    });
    return;
  }

  const current = streaming.steps[idx];
  let nextStatus = step.status;
  if (
    (current.status === "done" || current.status === "error") &&
    step.status === "pending"
  ) {
    nextStatus = current.status;
  }

  dispatch({
    type: "UPDATE_STREAMING_STEP",
    payload: {
      index: idx,
      patch: {
        title,
        type: step.type || current.type,
        status: nextStatus || current.status,
        meta: step.meta || current.meta,
        filePath: step.filePath || current.filePath,
        diffStats: step.diffStats || current.diffStats,
        duration:
          typeof step.duration === "number" ? step.duration : current.duration,
      },
    },
  });
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

function normalizeComparableText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function comparableTokens(value: string): string[] {
  return normalizeComparableText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function shouldPreferStreamingContent(
  finalContent: string,
  streamingContent: string,
): boolean {
  if (splitMixedReasoningFromContent(streamingContent)) {
    return false;
  }
  if (looksLikeReasoningTrace(streamingContent, "")) {
    return false;
  }

  const finalNorm = normalizeComparableText(finalContent);
  const streamNorm = normalizeComparableText(streamingContent);
  if (!streamNorm) {
    return false;
  }
  if (!finalNorm) {
    return true;
  }
  if (streamNorm === finalNorm) {
    return false;
  }
  if (finalNorm.includes(streamNorm)) {
    return false;
  }
  // When the stream text clearly contains the final text as a subset, prefer the
  // richer stream snapshot so intermediate details are not dropped on finalize.
  if (streamNorm.includes(finalNorm) && streamNorm.length >= finalNorm.length + 24) {
    return true;
  }
  // Fallback: some providers condense final payloads so they are no longer literal
  // subsets. Keep stream text when final tokens mostly overlap but stream is much richer.
  if (streamNorm.length < finalNorm.length + 64) {
    return false;
  }
  const finalTokens = comparableTokens(finalNorm);
  if (finalTokens.length === 0) {
    return false;
  }
  const streamTokenSet = new Set(comparableTokens(streamNorm));
  let matchedFinalTokens = 0;
  for (const token of finalTokens) {
    if (streamTokenSet.has(token)) {
      matchedFinalTokens += 1;
    }
  }
  const overlapRatio = matchedFinalTokens / finalTokens.length;
  return overlapRatio >= 0.65 && matchedFinalTokens >= Math.min(6, finalTokens.length);
}

function partsWithStreamingContent(
  parts: MessagePart[] | undefined,
  streamingContent: string,
): MessagePart[] {
  if (!Array.isArray(parts) || parts.length === 0) {
    return [
      {
        type: "text",
        text: streamingContent,
      } as MessagePart,
    ];
  }

  let replaced = false;
  const updated = parts.map((part) => {
    if (replaced) {
      return part;
    }
    const rec = asRecord(part);
    if (!rec) {
      return part;
    }
    const partType = normalizePartType(rec.type);
    const hasTextLike =
      partType === "" ||
      partType === "text" ||
      typeof rec.text === "string" ||
      typeof rec.content === "string";
    if (!hasTextLike) {
      return part;
    }
    replaced = true;
    return {
      ...(part as MessagePart),
      type: partType || "text",
      text: streamingContent,
    } as MessagePart;
  });

  if (replaced) {
    return updated;
  }

  return [
    {
      type: "text",
      text: streamingContent,
    } as MessagePart,
    ...parts,
  ];
}

function pickBestContentCandidate(
  candidates: Array<string | undefined>,
): string {
  const normalizedCandidates = candidates.filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  if (normalizedCandidates.length === 0) {
    return "";
  }

  let best = normalizedCandidates[0];
  for (let index = 1; index < normalizedCandidates.length; index += 1) {
    const candidate = normalizedCandidates[index];
    const bestNorm = normalizeComparableText(best);
    const candidateNorm = normalizeComparableText(candidate);
    if (!candidateNorm) {
      continue;
    }
    if (!bestNorm) {
      best = candidate;
      continue;
    }
    if (
      candidateNorm.includes(bestNorm) &&
      candidateNorm.length >= bestNorm.length + 24
    ) {
      best = candidate;
      continue;
    }
    if (
      candidateNorm.length > bestNorm.length + 120 &&
      !bestNorm.includes(candidateNorm)
    ) {
      best = candidate;
    }
  }
  return best;
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
  const directReasoningRaw = rec.reasoning ?? rec.thinking ?? rec.thoughts;
  const directReasoningChunks = Array.isArray(directReasoningRaw)
    ? directReasoningRaw
        .map((item) => asRichString(item).trim())
        .filter((item) => item.length > 0)
    : typeof directReasoningRaw !== "undefined"
      ? [asRichString(directReasoningRaw).trim()].filter((item) => item.length > 0)
      : [];
  if (directReasoningChunks.length > 0 && !currentReasoning) {
    for (const chunk of directReasoningChunks) {
      mergedParts.push({
        type: "reasoning",
        reasoning: chunk,
      });
    }
  }
  const hasReasoningAfterDirect = reasoningFromParts(mergedParts);
  if (streaming?.reasoning && !hasReasoningAfterDirect) {
    mergedParts.push({
      type: 'reasoning',
      reasoning: streaming.reasoning
    });
  }
  const detachedReasoningChunks: string[] = [];
  const sanitizedMergedParts = mergedParts.map((part) => {
    const rec = asRecord(part);
    if (!rec || isReasoningPart(rec)) {
      return part;
    }
    const partType = normalizePartType(rec.type);
    const textLike =
      asRichString(rec.text) || asRichString(rec.content) || asRichString(rec.delta);
    if (!textLike) {
      return part;
    }
    const mixed = splitMixedReasoningFromContent(textLike);
    if (!mixed) {
      return part;
    }
    const detached = sanitizeReasoningChunk(mixed.reasoning).trim();
    if (detached) {
      detachedReasoningChunks.push(detached);
    }

    const nextPart: Record<string, unknown> = { ...(part as Record<string, unknown>) };
    if (typeof rec.text === "string" || partType === "text") {
      nextPart.type = partType || "text";
      nextPart.text = mixed.content;
    } else if (typeof rec.content === "string") {
      nextPart.content = mixed.content;
    } else if (typeof rec.delta === "string") {
      nextPart.delta = mixed.content;
    }
    return nextPart as MessagePart;
  });

  const splitReasoningFromCandidate = (raw: string): string => {
    const mixed = splitMixedReasoningFromContent(raw);
    if (!mixed) {
      return raw;
    }
    const detached = sanitizeReasoningChunk(mixed.reasoning).trim();
    if (detached) {
      detachedReasoningChunks.push(detached);
    }
    return mixed.content;
  };

  const role = asString(rec.role) || asString(asRecord(rec.info)?.role);
  const content = pickBestContentCandidate([
    splitReasoningFromCandidate(asRichString(rec.content)),
    splitReasoningFromCandidate(asRichString(rec.text)),
    contentFromParts(sanitizedMergedParts),
    summaryText(rec.info),
  ]);

  const streamingRawContent = asString(streaming?.content);
  const streamingMixed = splitMixedReasoningFromContent(streamingRawContent);
  if (streamingMixed) {
    const detached = sanitizeReasoningChunk(streamingMixed.reasoning).trim();
    if (detached) {
      detachedReasoningChunks.push(detached);
    }
  }
  const streamingContent = streamingMixed ? streamingMixed.content : streamingRawContent;
  const preferStreamingContent = shouldPreferStreamingContent(
    content || "",
    streamingContent,
  );
  const normalized: Message = {
    ...(message as Message),
    role: role || (parts.length > 0 ? 'assistant' : message.role),
    content: preferStreamingContent ? streamingContent : content || message.content,
    parts: preferStreamingContent
      ? partsWithStreamingContent(sanitizedMergedParts as MessagePart[], streamingContent)
      : sanitizedMergedParts.length > 0
        ? (sanitizedMergedParts as Message['parts'])
        : message.parts
  };

  const existingReasoningEvents = Array.isArray(message.reasoningEvents)
    ? message.reasoningEvents
    : [];
  const mergedReasoningEvents = [
    ...existingReasoningEvents,
    ...(streaming?.reasoningEvents ?? [])
  ];
  const streamingReasoningLeak = sanitizeReasoningChunk(
    streamingMixed ? streamingMixed.reasoning : asString(streaming?.content),
  ).trim();
  if (
    streamingReasoningLeak &&
    (looksLikeReasoningTrace(streamingReasoningLeak, "") || !!streamingMixed) &&
    !shouldPreferStreamingContent(content || "", streamingReasoningLeak)
  ) {
    const leakNorm = normalizeComparableText(streamingReasoningLeak);
    const finalNorm = normalizeComparableText(content || "");
    const leakAlreadyInFinal =
      !!leakNorm &&
      !!finalNorm &&
      (finalNorm.includes(leakNorm) || leakNorm.includes(finalNorm));
    const leakAlreadyTracked = mergedReasoningEvents.some(
      (event) => normalizeComparableText(asString(event.text)) === leakNorm,
    );
    if (!leakAlreadyInFinal && !leakAlreadyTracked) {
      mergedReasoningEvents.push({
        text: streamingReasoningLeak,
        createdAt: Date.now(),
      });
    }
  }
  if (detachedReasoningChunks.length > 0) {
    detachedReasoningChunks.forEach((chunk) => {
      const norm = normalizeComparableText(chunk);
      if (!norm) return;
      const alreadyTracked = mergedReasoningEvents.some(
        (event) => normalizeComparableText(asString(event.text)) === norm,
      );
      if (!alreadyTracked) {
        mergedReasoningEvents.push({ text: chunk, createdAt: Date.now() });
      }
    });
  }
  if (mergedReasoningEvents.length > 0) {
    normalized.reasoningEvents = mergedReasoningEvents;
  }

  const canonicalSteps = normalizeActivitySteps(
    normalized,
    streaming,
    sanitizedMergedParts as MessagePart[],
  );
  if (canonicalSteps.length > 0) {
    normalized.steps = canonicalSteps;
    normalized.progressEvents = canonicalSteps;
  }

  // Extract file edits from patch-type parts when edits are not already populated.
  if (!Array.isArray(normalized.edits) || normalized.edits.length === 0) {
    const fromParts: Array<{ file: string }> = [];
    for (const part of sanitizedMergedParts) {
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

function isSlashCommand(value: unknown): value is SlashCommand {
  const rec = asRecord(value);
  return !!rec && typeof rec.name === "string";
}

function isQueueItem(value: unknown): value is QueueItem {
  const rec = asRecord(value);
  return (
    !!rec &&
    typeof rec.text === "string" &&
    (rec.id === undefined || typeof rec.id === "string") &&
    (rec.sessionId === undefined || typeof rec.sessionId === "string") &&
    (rec.createdAt === undefined || typeof rec.createdAt === "number")
  );
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
      typeof asRecord(rec.info)?.role === 'string' ||
      typeof rec.content === 'string' ||
      typeof rec.text === 'string' ||
      Array.isArray(rec.parts) ||
      Array.isArray(rec.subagents) ||
      Array.isArray(rec.reasoningEvents) ||
      Array.isArray(rec.progressEvents) ||
      Array.isArray(rec.steps))
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

function hydrateSubagentSummary(
  summary: SubagentSummary,
  detailsById: Record<string, SubagentDetail>,
): SubagentDetail {
  const detail = detailsById[summary.id];
  if (!detail) {
    return {
      ...(summary as SubagentDetail),
      thinkingEvents: [],
      progressEvents: [],
      timelineEvents: [],
    };
  }
  return {
    ...summary,
    ...detail,
    parentSessionId: detail.parentSessionId || summary.parentSessionId,
    parentMessageId: detail.parentMessageId || summary.parentMessageId,
    status: detail.status || summary.status,
    latestActivity: detail.latestActivity || summary.latestActivity,
    references:
      Array.isArray(detail.references) && detail.references.length > 0
        ? detail.references
        : summary.references,
    thinkingEvents: Array.isArray(detail.thinkingEvents)
      ? detail.thinkingEvents
      : [],
    progressEvents: Array.isArray(detail.progressEvents)
      ? detail.progressEvents
      : [],
    timelineEvents: Array.isArray(detail.timelineEvents)
      ? detail.timelineEvents
      : [],
  };
}

function areSubagentListsEquivalent(
  previous: SubagentDetail[] | undefined,
  next: SubagentDetail[],
): boolean {
  const prev = Array.isArray(previous) ? previous : [];
  if (prev.length !== next.length) {
    return false;
  }
  for (let index = 0; index < prev.length; index += 1) {
    const a = prev[index];
    const b = next[index];
    if (
      a.id !== b.id ||
      a.status !== b.status ||
      a.latestActivity !== b.latestActivity ||
      (a.durationMs ?? 0) !== (b.durationMs ?? 0) ||
      (a.progressEvents?.length ?? 0) !== (b.progressEvents?.length ?? 0) ||
      (a.thinkingEvents?.length ?? 0) !== (b.thinkingEvents?.length ?? 0) ||
      (a.timelineEvents?.length ?? 0) !== (b.timelineEvents?.length ?? 0)
    ) {
      return false;
    }
  }
  return true;
}

function deriveSessionIdFromMessage(
  message: Message,
  fallbackSessionId: string | null,
): string | null {
  const info = asRecord(message.info);
  const infoSessionId =
    asString(info?.sessionID) || asString(info?.sessionId);
  if (infoSessionId) {
    return infoSessionId;
  }

  if (Array.isArray(message.subagents)) {
    for (const subagent of message.subagents) {
      const sessionId = asString(asRecord(subagent)?.parentSessionId);
      if (sessionId) {
        return sessionId;
      }
    }
  }

  return fallbackSessionId;
}

function getMessageId(message: Message): string | null {
  return (
    asString(asRecord(message.info)?.id) ||
    asString((message as unknown as UnknownRecord).id) ||
    null
  );
}

function mergeSubagentSummaries(
  existing: SubagentSummary[] | undefined,
  incoming: SubagentSummary[],
): SubagentSummary[] {
  const byId = new Map<string, SubagentSummary>();
  const source = Array.isArray(existing) ? existing : [];
  source.forEach((entry) => {
    if (entry?.id) {
      byId.set(entry.id, entry);
    }
  });
  incoming.forEach((entry) => {
    if (!entry?.id) {
      return;
    }
    const prev = byId.get(entry.id);
    byId.set(entry.id, prev ? { ...prev, ...entry, id: entry.id } : entry);
  });
  return Array.from(byId.values());
}

function findLatestAssistantMessageIdForSession(
  messages: Message[],
  fallbackSessionId: string | null,
  targetSessionId?: string,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = message.role ?? asString(asRecord(message.info)?.role) ?? "";
    if (role !== "assistant") {
      continue;
    }
    const messageId = getMessageId(message);
    if (!messageId) {
      continue;
    }

    if (targetSessionId) {
      const sessionId = deriveSessionIdFromMessage(message, fallbackSessionId);
      if (sessionId && sessionId !== targetSessionId) {
        continue;
      }
    }

    return messageId;
  }

  return null;
}

function syncSubagentMapsIntoMessages(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  summariesByParentMessageId: Record<string, SubagentSummary[]>,
  detailsById: Record<string, SubagentDetail>,
  mode: "merge" | "replace",
): void {
  const state = getState();
  const allSummariesByParentMessageId =
    mode === "replace"
      ? summariesByParentMessageId
      : {
          ...state.subagentsByParentMessageId,
          ...summariesByParentMessageId,
        };
  const allDetailsById =
    mode === "replace"
      ? detailsById
      : {
          ...state.subagentDetailsById,
          ...detailsById,
        };

  const messageIds = new Set<string>();
  state.messages.forEach((message) => {
    const messageId = getMessageId(message);
    if (messageId) {
      messageIds.add(messageId);
    }
  });

  // Rebind orphaned summary groups (usually keyed by transient streaming IDs)
  // to the latest assistant message for the same session so cards survive
  // reload/session hydration even when final message IDs differ.
  const fallbackSessionId = state.currentSessionId;
  const effectiveSummariesByParentMessageId: Record<string, SubagentSummary[]> = {
    ...allSummariesByParentMessageId,
  };
  for (const [parentMessageId, summaries] of Object.entries(
    allSummariesByParentMessageId,
  )) {
    if (!Array.isArray(summaries) || summaries.length === 0) {
      continue;
    }
    if (messageIds.has(parentMessageId)) {
      continue;
    }

    const targetSessionId =
      summaries.find((summary) => summary.parentSessionId)?.parentSessionId ||
      undefined;
    const reboundParentMessageId = findLatestAssistantMessageIdForSession(
      state.messages,
      fallbackSessionId,
      targetSessionId,
    );
    if (!reboundParentMessageId) {
      continue;
    }

    const reboundSummaries = summaries.map((summary) => ({
      ...summary,
      parentMessageId: reboundParentMessageId,
      parentSessionId:
        summary.parentSessionId || targetSessionId || fallbackSessionId || "",
    }));
    effectiveSummariesByParentMessageId[reboundParentMessageId] =
      mergeSubagentSummaries(
        effectiveSummariesByParentMessageId[reboundParentMessageId],
        reboundSummaries,
      );

    reboundSummaries.forEach((summary) => {
      const detail = allDetailsById[summary.id];
      if (!detail) {
        return;
      }
      allDetailsById[summary.id] = {
        ...detail,
        parentMessageId: reboundParentMessageId,
        parentSessionId: summary.parentSessionId,
      };
    });
  }

  const updatedMessages: Message[] = [];
  let hasChanges = false;
  const nextMessages = state.messages.map((message) => {
    const messageId = getMessageId(message);
    if (!messageId) {
      return message;
    }
    const summaries = effectiveSummariesByParentMessageId[messageId];
    if (!Array.isArray(summaries) || summaries.length === 0) {
      return message;
    }
    const hydratedSubagents = summaries.map((summary) =>
      hydrateSubagentSummary(summary, allDetailsById),
    );
    if (areSubagentListsEquivalent(message.subagents, hydratedSubagents)) {
      return message;
    }

    hasChanges = true;
    const nextMessage: Message = {
      ...message,
      subagents: hydratedSubagents,
    };
    updatedMessages.push(nextMessage);
    return nextMessage;
  });

  if (!hasChanges) {
    return;
  }

  dispatch({ type: "SET_MESSAGES", payload: nextMessages });
  const currentSessionId = getState().currentSessionId;
  for (const message of updatedMessages) {
    const sessionId = deriveSessionIdFromMessage(message, currentSessionId);
    if (!sessionId) {
      continue;
    }
    vscode.postMessage({
      type: "persistAssistantMessage",
      sessionId,
      message,
    });
  }
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

function hasRenderableHistoryPayload(message: Message): boolean {
  const text = extractMessageText(message).trim();
  if (text.length > 0) {
    return true;
  }

  if (Array.isArray(message.images) && message.images.length > 0) {
    return true;
  }
  if (
    Array.isArray((message as unknown as UnknownRecord).attachments) &&
    ((message as unknown as UnknownRecord).attachments as unknown[]).length > 0
  ) {
    return true;
  }
  if (Array.isArray(message.subagents) && message.subagents.length > 0) {
    return true;
  }
  if (
    Array.isArray(message.interactiveEvents) &&
    message.interactiveEvents.length > 0
  ) {
    return true;
  }
  if (Array.isArray(message.reasoningEvents) && message.reasoningEvents.length > 0) {
    return true;
  }
  if (Array.isArray(message.progressEvents) && message.progressEvents.length > 0) {
    return true;
  }
  if (Array.isArray(message.steps) && message.steps.length > 0) {
    return true;
  }
  if (Array.isArray(message.edits) && message.edits.length > 0) {
    return true;
  }
  if (
    typeof (message as unknown as UnknownRecord).error === 'string' &&
    asString((message as unknown as UnknownRecord).error).trim().length > 0
  ) {
    return true;
  }
  if (message.plan && typeof message.plan === 'object') {
    return true;
  }

  if (Array.isArray(message.parts)) {
    return message.parts.some((part) => {
      const rec = asRecord(part);
      if (!rec) {
        return false;
      }
      return (
        asString(rec.filename).length > 0 ||
        asString(asRecord(rec.source)?.path).length > 0 ||
        asString(rec.url).length > 0
      );
    });
  }

  return false;
}

function isRenderableHistoryMessage(message: Message): boolean {
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  const hasPayload = hasRenderableHistoryPayload(message);
  if (role === 'user' || role === 'assistant') {
    return hasPayload;
  }
  return hasPayload;
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

function detectInteractiveEventsFromText(_text: string, _message: Message): InteractiveEvent[] {
  return [];
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
  const canonicalSteps = normalizeActivitySteps(
    {
      role: "assistant",
      parts: parts as MessagePart[],
    } as Message,
    streaming,
    parts as MessagePart[],
  );

  return {
    role: "assistant",
    content: streaming.content,
    parts,
    reasoningEvents: streaming.reasoningEvents,
    progressEvents: canonicalSteps,
    steps: canonicalSteps,
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
  const isPartUpdateEvent = eventType.startsWith("message.part.");
  const normalizedEventType = isPartUpdateEvent ? "message.part.updated" : eventType;
  const state = getState();
  const current = state.streaming;
  const properties = asRecord(payload.properties);
  const partRecord = asRecord(properties?.part);
  const infoRecord = asRecord(payload.info) ?? asRecord(properties?.info);
  const eventPart =
    asRecord(payload.part) ??
    partRecord ??
    (isPartUpdateEvent ? asRecord(properties) : null);
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

  const messageId =
    asString(payload.messageId) ||
    asString((payload as UnknownRecord).messageID) ||
    asString(payload.id) ||
    asString(properties?.messageId) ||
    asString(properties?.messageID) ||
    asString(partRecord?.messageId) ||
    asString(partRecord?.messageID) ||
    asString(infoRecord?.id) ||
    current?.messageId ||
    null;
  const isExplicitStart = eventType === 'start' || eventType === 'streamStart';
  const isAssistantUpdateStart =
    eventType === 'message.updated' &&
    asString(infoRecord?.role) === 'assistant' &&
    !asBoolean(infoRecord?.finish, false);
  const canBootstrapFromPart =
    isPartUpdateEvent && shouldBootstrapStreamingFromPart(eventPart);

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

  switch (normalizedEventType) {
    case 'message.part.updated':
    case 'message.part.added':
    case 'message.part.created': {
      const properties = asRecord(payload.properties);
      const part = asRecord(payload.part) ?? asRecord(properties?.part) ?? properties;
      if (!part) {
        dispatch({ type: 'SET_PROCESSING', payload: true });
        break;
      }

      const partType = normalizePartType(part.type);
      const deltaChunk =
        asRichString(properties?.delta) ||
        asRichString(payload.delta) ||
        asRichString(part.delta);
      const reasoningChunk =
        asRichString(part.reasoning) ||
        asRichString(part.thought) ||
        asRichString(part.thinking) ||
        asRichString(properties?.reasoning) ||
        asRichString(properties?.thought) ||
        asRichString(properties?.thinking) ||
        asRichString(payload.reasoning) ||
        asRichString(payload.thought) ||
        asRichString(payload.thinking);
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
        partType === "patch" ||
        partType === "subtask" ||
        partType === "agent";

      if (structuredOutput?.reasoning) {
        const reasoningEvents = getState().streaming?.reasoningEvents;
        const latestReasoning =
          reasoningEvents && reasoningEvents.length > 0
            ? reasoningEvents[reasoningEvents.length - 1].text
            : undefined;
        structuredOutput.reasoning.forEach((chunk) => {
          const sanitized = sanitizeReasoningChunk(chunk);
          if (sanitized && sanitized !== latestReasoning) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: { reasoning: sanitized, append: true },
            });
          }
        });
      }

      if (structuredOutput?.progressUpdates) {
        structuredOutput.progressUpdates.forEach((update) => {
          upsertStreamingStep(dispatch, getState, {
            title: update.title,
            type: "step",
            status: update.status ?? "pending",
            meta: update.meta,
            filePath: update.filePath,
          });
        });
      }

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
        const streamingState = getState().streaming;
        const rawReasoningLike = looksLikeReasoningTrace(textChunk, streamingState?.content || "");
        const mixedChunk = splitMixedReasoningFromContent(textChunk);
        if (rawReasoningLike && !mixedChunk) {
          const reasoningLeak = sanitizeReasoningChunk(textChunk);
          if (reasoningLeak) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: { reasoning: reasoningLeak, append: true },
            });
          }
          dispatch({ type: "SET_PROCESSING", payload: true });
          break;
        }

        let candidateChunk = textChunk;
        if (mixedChunk) {
          const reasoningLeak = sanitizeReasoningChunk(mixedChunk.reasoning);
          if (reasoningLeak) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: { reasoning: reasoningLeak, append: true },
            });
          }
          candidateChunk = mixedChunk.content;
        }

        if (looksLikeReasoningTrace(candidateChunk, streamingState?.content || "")) {
          const reasoningLeak = sanitizeReasoningChunk(candidateChunk);
          if (reasoningLeak) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: { reasoning: reasoningLeak, append: true },
            });
          }
          dispatch({ type: "SET_PROCESSING", payload: true });
          break;
        }
        // Ignore id-like echoes that can appear before assistant output begins.
        if (isOpaqueIdLike(candidateChunk.trim())) {
          dispatch({ type: "SET_PROCESSING", payload: true });
          break;
        }
        const contentEmpty = !streamingState || !streamingState.content.trim();
        const cleanedChunk = contentEmpty
          ? stripLeadingUserEcho(candidateChunk, getState())
          : candidateChunk;
          if (cleanedChunk) {
            const contentPatch = resolveStreamingContentUpdate(
              streamingState?.content || '',
              cleanedChunk,
              !!deltaChunk,
            );
            if (!contentPatch) {
              dispatch({ type: "SET_PROCESSING", payload: true });
              break;
            }
            streamDebug("[OpenCode][stream] message.part.updated chunk", {
              messageId,
              eventType,
              partType,
              append: contentPatch.append,
              length: cleanedChunk.length,
              preview: cleanedChunk.slice(0, 80),
            });
            dispatch({
              type: "UPDATE_STREAMING_CONTENT",
              payload: { content: contentPatch.content, append: contentPatch.append },
            });
          }
        }

      if (partType === 'step-start' && structuredKind !== 'thinking') {
        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: 'step',
          status: 'pending',
          startTime: Date.now()
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

        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: "step",
          status: "done",
          duration: asOptionalNumber(asRecord(part.timing)?.duration),
          diffStats,
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
          upsertStreamingStep(dispatch, getState, {
            id: asString(part.id) || undefined,
            callID,
            title,
            type: "tool",
            status: asString(part.status) === "error" ? "error" : "pending",
            meta: asString(part.meta) || metaValues[0] || undefined,
            filePath,
            startTime: Date.now(),
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

          upsertStreamingStep(dispatch, getState, {
            id: asString(part.id) || existing.id,
            callID,
            title,
            type: "tool",
            status: resolvedStatus,
            meta: asString(part.meta) || metaValues[0] || existing.meta,
            filePath: filePath || existing.filePath,
          });
        }

        if (filePath) {
          dispatch({ type: 'ADD_STREAMING_EDIT', payload: filePath });
        }
      }

      if (
        (partType === "subtask" || partType === "agent") &&
        structuredKind !== "thinking"
      ) {
        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: "step",
          status: normalizeProgressStatus(asString(part.status)),
          meta: asString(part.meta) || undefined,
          startTime: Date.now(),
        });
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

      if (
        structuredKind === "progress" &&
        !isProgressPartType &&
        !isReasoning &&
        partType
      ) {
        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: "step",
          status: normalizeProgressStatus(asString(part.status)),
          meta: asString(part.meta) || undefined,
          startTime: Date.now(),
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
            upsertStreamingStep(dispatch, getState, {
              title: step.title,
              type: 'step',
              status: step.status ?? 'pending',
              meta: step.meta,
              filePath: step.filePath
            });
          });
        }

        const structuredMessage =
          structuredOutput.assistantMessage || structuredOutput.message;
        if (structuredMessage) {
          const streamingState = getState().streaming;
          const rawReasoningLike = looksLikeReasoningTrace(structuredMessage, streamingState?.content || "");
          const mixedMessage = splitMixedReasoningFromContent(
            structuredMessage,
          );
          let messageText = structuredMessage;
          if (mixedMessage) {
            const mixedReasoning = sanitizeReasoningChunk(mixedMessage.reasoning);
            if (mixedReasoning) {
              dispatch({
                type: 'UPDATE_STREAMING_REASONING',
                payload: { reasoning: mixedReasoning, append: true }
              });
            }
            messageText = mixedMessage.content;
          }

          if (rawReasoningLike && !mixedMessage) {
            const reasoningLeak = sanitizeReasoningChunk(structuredMessage);
            if (reasoningLeak) {
              dispatch({
                type: 'UPDATE_STREAMING_REASONING',
                payload: { reasoning: reasoningLeak, append: true }
              });
            }
          } else if (looksLikeReasoningTrace(messageText, streamingState?.content || "")) {
            const reasoningLeak = sanitizeReasoningChunk(messageText);
            if (reasoningLeak) {
              dispatch({
                type: 'UPDATE_STREAMING_REASONING',
                payload: { reasoning: reasoningLeak, append: true }
              });
            }
          } else {
            if (mixedMessage) {
              const contentPatch = resolveStreamingContentUpdate(
                streamingState?.content || '',
                messageText,
                false,
              );
              if (contentPatch) {
                dispatch({
                  type: 'UPDATE_STREAMING_CONTENT',
                  payload: { content: contentPatch.content, append: contentPatch.append }
                });
              }
            } else {
              const contentPatch = resolveStreamingContentUpdate(
                streamingState?.content || '',
                structuredMessage,
                false,
              );
              if (contentPatch) {
                dispatch({
                  type: 'UPDATE_STREAMING_CONTENT',
                  payload: { content: contentPatch.content, append: contentPatch.append }
                });
              }
            }
          }
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

        // Handle todo_update structured responses by normalizing each todo item
        // and routing them through the same reducer actions used by the explicit
        // "todoUpdate" postMessage path. This keeps reducer semantics identical
        // regardless of whether the host forwarded a postMessage or the stream
        // carried the structured payload directly.
          try {
            const todoSource =
              asRecord(payload.structuredOutput) ?? structuredRecord ?? asRecord(properties?.structuredOutput);
            const rawTodoItems = Array.isArray(todoSource?.todoItems) ? todoSource!.todoItems : undefined;
            if (
              structuredOutput &&
              (structuredOutput.responseType === 'todo_update' ||
                asString(payload.responseType) === 'todo_update') &&
              Array.isArray(rawTodoItems)
            ) {
              for (const raw of rawTodoItems) {
                const normalized = normalizeTodoRecord(raw);
                if (!normalized) continue; // skip malformed items silently
                ingestNormalizedTodo(dispatch, getState, normalized);
              }
            }
          } catch (e) {
            // Defensive: never allow malformed structured payloads to throw inside
            // the message handler — just skip and continue processing other parts.
            console.warn('Failed to normalize todo_update structured payload', e);
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
          let candidateChunk = contentEmpty
            ? stripLeadingUserEcho(chunk, getState())
            : chunk;
          const mixedChunk = splitMixedReasoningFromContent(candidateChunk);
          if (mixedChunk) {
            const mixedReasoning = sanitizeReasoningChunk(mixedChunk.reasoning);
            if (mixedReasoning) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: { reasoning: mixedReasoning, append: true },
              });
            }
            candidateChunk = mixedChunk.content;
          }
          const cleanedChunk = candidateChunk;
          if (!cleanedChunk) {
            break;
          }
          if (looksLikeReasoningTrace(cleanedChunk, streamingState?.content || "")) {
            const reasoningLeak = sanitizeReasoningChunk(cleanedChunk);
            if (reasoningLeak) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: { reasoning: reasoningLeak, append: true },
              });
            }
            break;
          }
          const fromDelta =
            eventType === 'contentDelta' ||
            eventType === 'text-delta' ||
            !!asString(payload.delta);
          const contentPatch = resolveStreamingContentUpdate(
            streamingState?.content || '',
            cleanedChunk,
            fromDelta,
          );
          if (!contentPatch) {
            break;
          }
          streamDebug("[OpenCode][stream] content delta chunk", {
            messageId,
            eventType,
            append: contentPatch.append,
            length: cleanedChunk.length,
            preview: cleanedChunk.slice(0, 80),
          });
          dispatch({
            type: 'UPDATE_STREAMING_CONTENT',
            payload: { content: contentPatch.content, append: contentPatch.append },
          });
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
      const stepTypeRaw = asString(payload.stepType).toLowerCase();
      const step: StreamingStep = {
        id: asString(payload.id) || undefined,
        callID: asString(payload.callID) || undefined,
        title: asString(payload.title, 'Working'),
        type:
          stepTypeRaw === 'tool' ||
          stepTypeRaw === 'reasoning' ||
          stepTypeRaw === 'thinking'
            ? (stepTypeRaw === "thinking" ? "reasoning" : stepTypeRaw)
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
    default: {
      let consumed = false;
      if (structuredOutput?.reasoning) {
        structuredOutput.reasoning.forEach((chunk) => {
          const sanitized = sanitizeReasoningChunk(chunk);
          if (!sanitized) {
            return;
          }
          dispatch({
            type: "UPDATE_STREAMING_REASONING",
            payload: { reasoning: sanitized, append: true },
          });
          consumed = true;
        });
      }

      if (structuredOutput?.progressUpdates) {
        structuredOutput.progressUpdates.forEach((step) => {
          upsertStreamingStep(dispatch, getState, {
            title: step.title,
            type: "step",
            status: step.status ?? "pending",
            meta: step.meta,
            filePath: step.filePath,
          });
          consumed = true;
        });
      }

      if (structuredKind === "thinking" && structuredText) {
        const chunk = sanitizeReasoningChunk(structuredText);
        if (chunk) {
          dispatch({
            type: "UPDATE_STREAMING_REASONING",
            payload: { reasoning: chunk, append: true },
          });
          consumed = true;
        }
        } else if (structuredKind === "message" && structuredText) {
          const streamingState = getState().streaming;
          const rawReasoningLike = looksLikeReasoningTrace(structuredText, streamingState?.content || "");
          let messageText = structuredText;
          const mixedMessage = splitMixedReasoningFromContent(messageText);
          if (mixedMessage) {
            const mixedReasoning = sanitizeReasoningChunk(mixedMessage.reasoning);
            if (mixedReasoning) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: { reasoning: mixedReasoning, append: true },
              });
              consumed = true;
            }
            messageText = mixedMessage.content;
          }
          if (rawReasoningLike && !mixedMessage) {
            const reasoningLeak = sanitizeReasoningChunk(structuredText);
            if (reasoningLeak) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: { reasoning: reasoningLeak, append: true },
              });
              consumed = true;
            }
            break;
          }
          if (looksLikeReasoningTrace(messageText, streamingState?.content || "")) {
            const reasoningLeak = sanitizeReasoningChunk(messageText);
            if (reasoningLeak) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: { reasoning: reasoningLeak, append: true },
              });
              consumed = true;
            }
            break;
          }
          const contentPatch = resolveStreamingContentUpdate(
            streamingState?.content || '',
            messageText,
            false,
          );
          if (!contentPatch) {
            break;
          }
          dispatch({
            type: "UPDATE_STREAMING_CONTENT",
            payload: { content: contentPatch.content, append: contentPatch.append },
          });
          consumed = true;
        } else if (structuredKind === "progress") {
        const fallbackPart = eventPart ?? properties ?? payload;
        const title = structuredText || inferredStepTitle(fallbackPart);
        if (title) {
          upsertStreamingStep(dispatch, getState, {
            id: asString(fallbackPart.id) || undefined,
            callID: asString(fallbackPart.callID) || undefined,
            title,
            type: "step",
            status: normalizeProgressStatus(asString(fallbackPart.status)),
            meta: asString(fallbackPart.meta) || undefined,
            startTime: Date.now(),
          });
          consumed = true;
        }
      }

      if (consumed) {
        dispatch({ type: "SET_PROCESSING", payload: true });
      }
      break;
    }
  }
}

function bindStreamingToParentMessageIdFromSubagents(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  summariesByParentMessageId: Record<string, SubagentSummary[]>,
): void {
  const parentMessageIds = Object.keys(summariesByParentMessageId).filter(Boolean);
  if (parentMessageIds.length === 0) {
    return;
  }

  const streaming = getState().streaming;
  if (!streaming || !streaming.isActive || streaming.messageId) {
    return;
  }

  dispatch({
    type: "SET_STREAMING",
    payload: {
      ...streaming,
      messageId: parentMessageIds[0],
    },
  });
}

function collectHydratedSubagentsFromState(
  state: AppState,
  parentMessageIds: Array<string | null | undefined>,
): SubagentDetail[] {
  const uniqueParentIds = Array.from(
    new Set(
      parentMessageIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ),
    ),
  );
  if (uniqueParentIds.length === 0) {
    return [];
  }

  const byId = new Map<string, SubagentDetail>();
  for (const parentMessageId of uniqueParentIds) {
    const summaries = state.subagentsByParentMessageId[parentMessageId];
    if (!Array.isArray(summaries) || summaries.length === 0) {
      continue;
    }
    for (const summary of summaries) {
      byId.set(
        summary.id,
        hydrateSubagentSummary(summary, state.subagentDetailsById),
      );
    }
  }

  return Array.from(byId.values());
}

function mergeSubagentsIntoMessage(
  message: Message,
  hydratedFromState: SubagentDetail[],
): Message {
  if (hydratedFromState.length === 0) {
    return message;
  }

  const mergedById = new Map<string, SubagentDetail>();
  for (const entry of hydratedFromState) {
    mergedById.set(entry.id, entry);
  }

  const existing = Array.isArray(message.subagents) ? message.subagents : [];
  for (const entry of existing) {
    const current = mergedById.get(entry.id);
    if (!current) {
      mergedById.set(entry.id, entry);
      continue;
    }
    mergedById.set(entry.id, {
      ...current,
      ...entry,
      references:
        Array.isArray(entry.references) && entry.references.length > 0
          ? entry.references
          : current.references,
      thinkingEvents:
        Array.isArray(entry.thinkingEvents) && entry.thinkingEvents.length > 0
          ? entry.thinkingEvents
          : current.thinkingEvents,
      progressEvents:
        Array.isArray(entry.progressEvents) && entry.progressEvents.length > 0
          ? entry.progressEvents
          : current.progressEvents,
      timelineEvents:
        Array.isArray(entry.timelineEvents) && entry.timelineEvents.length > 0
          ? entry.timelineEvents
          : current.timelineEvents,
    });
  }

  return {
    ...message,
    subagents: Array.from(mergedById.values()),
  };
}

function remapSubagentsToFinalMessageId(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  streamingMessageId: string | null,
  finalMessageId: string | null,
): void {
  if (
    !streamingMessageId ||
    !finalMessageId ||
    streamingMessageId === finalMessageId
  ) {
    return;
  }

  const state = getState();
  const source = state.subagentsByParentMessageId[streamingMessageId];
  if (!Array.isArray(source) || source.length === 0) {
    return;
  }

  const updatedSource = source.map((entry) => ({
    ...entry,
    parentMessageId: finalMessageId,
  }));
  const existingTarget = Array.isArray(
    state.subagentsByParentMessageId[finalMessageId],
  )
    ? state.subagentsByParentMessageId[finalMessageId]
    : [];
  const mergedById = new Map<string, SubagentSummary>();
  existingTarget.forEach((entry) => {
    mergedById.set(entry.id, entry);
  });
  updatedSource.forEach((entry) => {
    mergedById.set(entry.id, entry);
  });

  dispatch({
    type: "UPSERT_SUBAGENT_SUMMARIES",
    payload: {
      [finalMessageId]: Array.from(mergedById.values()),
    },
  });

  const detailUpdates: Record<string, SubagentDetail> = {};
  for (const entry of updatedSource) {
    const detail = state.subagentDetailsById[entry.id];
    if (detail && detail.parentMessageId !== finalMessageId) {
      detailUpdates[entry.id] = {
        ...detail,
        parentMessageId: finalMessageId,
      };
    }
  }
  if (Object.keys(detailUpdates).length > 0) {
    dispatch({ type: "UPSERT_SUBAGENT_DETAIL", payload: detailUpdates });
  }
}

export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState) {
  let latestStreamingSnapshot: StreamingState | null = null;

  return (event: MessageEvent) => {
    const data = asRecord(event.data);
    if (!data) {
      return;
    }

    const type = asString(data.type);

    // Set processing state BEFORE handling message types to ensure streaming state is created early.
    // Never bootstrap "in progress" UI from compaction lifecycle messages.
    if (
      asBoolean(data.processing, false) &&
      type !== "compactionStatus" &&
      type !== "compactionViewState"
    ) {
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

        if (sessionId) {
          dispatch({ type: "SET_SESSION_ID", payload: sessionId });
        }
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
        dispatch({
          type: "SET_SERVER_VERSION",
          payload: asString(state.serverVersion) || undefined,
        });
        dispatch({ type: "SET_RECEIVED_INIT_STATE", payload: true });
        break;
      }
      case "modelsList": {
        const models = asArray(
          data.models,
          (item): item is AppState["availableModels"][number] => {
            const rec = asRecord(item);
            const contextLimit =
              typeof rec?.contextLimit === "number"
                ? rec.contextLimit
                : undefined;
            return (
              !!rec &&
              typeof rec.modelID === "string" &&
              typeof rec.providerID === "string" &&
              typeof rec.name === "string" &&
              (contextLimit === undefined ||
                (Number.isFinite(contextLimit) && contextLimit > 0))
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
      case "compactionStatus": {
        const sessionId = asString(data.sessionId);
        const currentSessionId = getState().currentSessionId;
        if (sessionId && currentSessionId && sessionId !== currentSessionId) {
          break;
        }
        const status = asString(data.status).toLowerCase();
        if (status !== "running" && status !== "done" && status !== "error") {
          break;
        }
        const normalizedStatus = status as "running" | "done" | "error";
        dispatch({
          type: "SET_COMPACTION_STATUS",
          payload: {
            status: normalizedStatus,
            at: asOptionalNumber(data.at),
            error: asString(data.error) || undefined,
            compactionDividerIndex: asOptionalNumber(data.compactionDividerIndex),
            compactionDividerBeforeMessageId: asOptionalString(
              data.compactionDividerBeforeMessageId,
            ),
            compactionDividerAfterMessageId: asOptionalString(
              data.compactionDividerAfterMessageId,
            ),
            collapsed:
              typeof data.collapsed === "boolean"
                ? data.collapsed
                : undefined,
            baselineStats: asSessionStats(data.baselineStats),
          },
        });
        if (normalizedStatus === "done") {
          const nextState = getState();
          if (nextState.currentSessionId) {
            vscode.postMessage({
              type: "setCompactionViewState",
              sessionId: nextState.currentSessionId,
              lastCompactedAt: nextState.lastCompactedAt,
              compactionDividerIndex: nextState.compactionDividerIndex,
              compactionDividerBeforeMessageId:
                nextState.compactionDividerBeforeMessageId,
              compactionDividerAfterMessageId:
                nextState.compactionDividerAfterMessageId,
              baselineStats: nextState.compactionBaselineStats,
              collapsed: nextState.compactedMessagesCollapsed,
            });
          }
        }
        if (normalizedStatus !== "running") {
          latestStreamingSnapshot = null;
          dispatch({ type: "SET_STEERING", payload: false });
          dispatch({ type: "SET_PROCESSING", payload: false });
          dispatch({ type: "FINISH_STREAMING" });
          dispatch({ type: "SET_STREAMING", payload: null });
        }
        break;
      }
      case "compactionViewState": {
        const sessionId = asString(data.sessionId);
        const currentSessionId = getState().currentSessionId;
        if (sessionId && currentSessionId && sessionId !== currentSessionId) {
          break;
        }
        dispatch({
          type: "SET_COMPACTION_VIEW_STATE",
          payload: {
            lastCompactedAt: asOptionalNumber(data.lastCompactedAt),
            compactionDividerIndex: asOptionalNumber(data.compactionDividerIndex),
            compactionDividerBeforeMessageId: asOptionalString(
              data.compactionDividerBeforeMessageId,
            ),
            compactionDividerAfterMessageId: asOptionalString(
              data.compactionDividerAfterMessageId,
            ),
            collapsed:
              typeof data.collapsed === "boolean"
                ? data.collapsed
                : undefined,
            baselineStats: asSessionStats(data.baselineStats),
          },
        });
        break;
      }
      case "stopRequestHandled": {
        latestStreamingSnapshot = getState().streaming ?? latestStreamingSnapshot;
        dispatch({ type: "SET_STEERING", payload: false });
        dispatch({ type: "SET_PROCESSING", payload: false });
        dispatch({ type: "FINISH_STREAMING" });
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

        const responseMessageId =
          asString(msg.id) || asString(asRecord(msg.info)?.id);
        const currentStreaming = getState().streaming;
        const snapshotMessageId = latestStreamingSnapshot?.messageId || null;
        if (
          !currentStreaming &&
          latestStreamingSnapshot &&
          responseMessageId &&
          snapshotMessageId &&
          snapshotMessageId !== responseMessageId
        ) {
          streamDebug(
            "[OpenCode][stream] messageResponse id mismatch; preserving latest streaming snapshot",
            {
              responseMessageId,
              snapshotMessageId,
            },
          );
        }
        // Always prefer the latest local streaming snapshot for final normalization.
        // Some providers emit different IDs between stream events and final response.
        const streaming = currentStreaming ?? latestStreamingSnapshot;
        const normalizedMessage = isMessage(msg)
          ? normalizeMessage(msg, streaming)
          : streaming
            ? buildStreamingMessage(streaming)
            : undefined;
        if (normalizedMessage) {
          const streamingMessageId =
            currentStreaming?.messageId || snapshotMessageId;
          let sanitized = sanitizeAssistantMessageEcho(
            normalizedMessage,
            getState(),
          );
          const provisionalFinalMessageId =
            asString(asRecord(sanitized.info)?.id) ||
            asString(sanitized.id) ||
            responseMessageId ||
            null;
          const hydratedSubagentsFromState = collectHydratedSubagentsFromState(
            getState(),
            [provisionalFinalMessageId, streamingMessageId],
          );
          if (hydratedSubagentsFromState.length > 0) {
            sanitized = mergeSubagentsIntoMessage(
              sanitized,
              hydratedSubagentsFromState,
            );
          }
          if (
            !asString(asRecord(sanitized.info)?.id) &&
            !asString(sanitized.id) &&
            streamingMessageId
          ) {
            sanitized = {
              ...sanitized,
              id: streamingMessageId,
            };
          }

          dispatch({
            type: "SET_MESSAGES",
            payload: [...currentMessages, sanitized],
          });
          const finalMessageId =
            asString(asRecord(sanitized.info)?.id) ||
            asString(sanitized.id) ||
            responseMessageId ||
            null;
          remapSubagentsToFinalMessageId(
            dispatch,
            getState,
            streamingMessageId,
            finalMessageId,
          );
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

          const sessionId = deriveSessionIdFromMessage(
            sanitized,
            getState().currentSessionId,
          );
          if (sessionId) {
            vscode.postMessage({
              type: "persistAssistantMessage",
              sessionId,
              message: sanitized,
            });
          }
        }
        latestStreamingSnapshot = null;
        dispatch({ type: "SET_PROCESSING", payload: false });
        dispatch({ type: "SET_STREAMING", payload: null });
        break;
      }
      case "chatHistory": {
        const messages = asArray(data.messages, isMessage)
          .map((msg) => normalizeMessage(msg, null))
          .filter((msg): msg is Message => !!msg)
          .filter((msg) => isRenderableHistoryMessage(msg));

        latestStreamingSnapshot = null;

        // Clear any stale streaming state and in-progress flag when history is
        // loaded (extension open or session switch) so the UI starts clean.
        dispatch({ type: "SET_STREAMING", payload: null });
        dispatch({ type: "SET_PROCESSING", payload: false });
        // Clear transient top-level errors so they don't persist into a new chat/session.
        dispatch({ type: "CLEAR_ERROR_MESSAGES" });

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
        const hasSnapshotSubagents =
          Object.keys(summariesByParentMessageId).length > 0 ||
          Object.keys(detailsById).length > 0;

        // Defensive fallback: some session/history hydration flows can emit an
        // empty snapshot right after chatHistory has already restored subagents
        // from persisted messages. Avoid clobbering those restored cards.
        if (!hasSnapshotSubagents) {
          const fallback = extractSubagentsFromMessages(getState().messages);
          if (
            Object.keys(fallback.summariesByParentMessageId).length > 0 ||
            Object.keys(fallback.detailsById).length > 0
          ) {
            dispatch({
              type: "UPSERT_SUBAGENT_SUMMARIES",
              payload: fallback.summariesByParentMessageId,
            });
            dispatch({
              type: "UPSERT_SUBAGENT_DETAIL",
              payload: fallback.detailsById,
            });
            syncSubagentMapsIntoMessages(
              dispatch,
              getState,
              fallback.summariesByParentMessageId,
              fallback.detailsById,
              "merge",
            );
            break;
          }
        }
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
        bindStreamingToParentMessageIdFromSubagents(
          dispatch,
          getState,
          summariesByParentMessageId,
        );
        syncSubagentMapsIntoMessages(
          dispatch,
          getState,
          summariesByParentMessageId,
          detailsById,
          "replace",
        );
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
        bindStreamingToParentMessageIdFromSubagents(
          dispatch,
          getState,
          summariesByParentMessageId,
        );
        syncSubagentMapsIntoMessages(
          dispatch,
          getState,
          summariesByParentMessageId,
          detailsById,
          "merge",
        );
        break;
      }
      case "streamEvent": {
        const streamingBefore = getState().streaming;
        if (streamingBefore) {
          latestStreamingSnapshot = streamingBefore;
        }
        const payload = asRecord(data.event) ?? data;
        streamDebug("[OpenCode][webview] streamEvent received", {
          type: asString(payload.type) || "unknown",
          hasProperties: !!asRecord(payload.properties),
          hasPart: !!asRecord(asRecord(payload.properties)?.part),
          structuredKind:
            asString(asRecord(payload.structured)?.kind) || "unknown",
        });
        handleStreamEvent(dispatch, getState, payload);
        const streamingAfter = getState().streaming;
        if (streamingAfter) {
          latestStreamingSnapshot = streamingAfter;
        }
        break;
      }
      case "streamEventEnrich": {
        const callID = asString(data.callID);
        const diffStatsRec = asRecord(data.diffStats);
        if (!callID || !diffStatsRec) {
          break;
        }
        dispatch({
          type: "UPDATE_STREAMING_STEP",
          payload: {
            callID,
            patch: {
              diffStats: {
                added: asNumber(diffStatsRec.added) || 0,
                deleted: asNumber(diffStatsRec.deleted) || 0,
              },
            },
          },
        });
        break;
      }
      case "error": {
        latestStreamingSnapshot = null;
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
      case "commandsList": {
        const commands = asArray(data.commands, isSlashCommand);
        dispatch({ type: "SET_COMMANDS_LIST", payload: commands });
        break;
      }
      case "sessionsList": {
        const currentSessionId = asString(data.currentSessionId) || null;
        dispatch({
          type: "SET_SESSIONS_LIST",
          payload: asArray(data.sessions, isSession),
        });
        if (currentSessionId) {
          dispatch({
            type: "SET_SESSION_ID",
            payload: currentSessionId,
          });
        }
        break;
      }
      case "queueUpdate": {
        const sessionId = asString(data.sessionId) || null;
        dispatch({
          type: "SET_QUEUE",
          payload: {
            sessionId,
            queue: asArray(data.queue, isQueueItem),
          },
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
            // Normalize the incoming item to the canonical shape and ingest via
            // the shared ingestion helper so stream-origin and direct postMessage
            // messages produce identical reducer effects.
            try {
              const action = asString(data.action);
              const item = data.item;
              // Guard: ignore malformed or missing items silently.
              if (!item) break;
              const normalized = normalizeTodoRecord(item);
              if (!normalized) break;

              // Keep a clear, test-friendly branching for add/update so existing
              // string-based regression tests continue to match the handler body.
              if (action === "add") {
                dispatch({
                  type: "ADD_TODO_ITEM",
                  payload: {
                    id: normalized.id,
                    text: normalized.text,
                    status: normalized.status,
                    sessionId: normalized.sessionId ?? "",
                  },
                });
              } else if (action === "update") {
                const patch: Partial<TodoItem> = {
                  text: normalized.text,
                  status: normalized.status,
                };
                if (normalized.sessionId) patch.sessionId = normalized.sessionId;
                dispatch({ type: "UPDATE_TODO_ITEM", payload: { id: normalized.id, patch } });
              } else {
                // Unknown action: fall back to unified ingestion which will decide
                // whether to add or update based on existing state.
                ingestNormalizedTodo(dispatch, getState, normalized);
              }
            } catch (e) {
              // Defensive: do not allow a malformed postMessage to throw.
              console.warn("Failed to process todoUpdate postMessage", e);
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
