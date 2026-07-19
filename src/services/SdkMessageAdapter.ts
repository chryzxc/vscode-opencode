import type {
  AgentPart,
  AssistantMessage,
  CompactionPart,
  FilePart,
  Message,
  Part,
  PatchPart,
  PermissionRequest,
  QuestionRequest,
  ReasoningPart,
  RetryPart,
  Session,
  SnapshotPart,
  StepFinishPart,
  StepStartPart,
  SubtaskPart,
  TextPart,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2";

// ---------------------------------------------------------------------------
// Compatibility types mirroring the webview render model (webview/shared/src/chat/lib/types.ts).
// Defined locally to avoid cross-rootDir imports since the webview lives outside src/.
// ---------------------------------------------------------------------------

/** Mirrors webview `MessageInfo` — metadata attached to a rendered message. */
export interface SdkMessageInfo {
  id?: string;
  parentID?: string;
  agent?: string;
  role?: string;
  model?: { modelID: string; providerID: string; name?: string };
  modelID?: string;
  providerID?: string;
  variant?: string;
  summary?: { title?: string; body?: string };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  duration?: number;
  finish?: boolean;
  structured?: Record<string, unknown>;
  structuredOutput?: Record<string, unknown>;
}

/** Mirrors webview `MessagePart` — a single part within a message. */
export interface SdkMessagePart {
  type?: string;
  text?: string;
  /** SDK transport-only text must not be rendered as user-authored content. */
  synthetic?: boolean;
  content?: string;
  message?: string;
  reasoning?: string;
  url?: string;
  filename?: string;
  mime?: string;
  source?: unknown;
}

/** Mirrors webview `MessageStep` — a timeline step / progress item. */
export interface SdkMessageStep {
  type: string;
  title: string;
  content?: string;
  status?: string;
  internal?: boolean;
  meta?: string;
  callID?: string;
  id?: string;
  messageID?: string;
  sessionID?: string;
  startedAt?: number;
  endedAt?: number;
  source?: "final";
  partType?: string;
  filePath?: string;
  diffStats?: { added: number; deleted: number };
  activityDetail?: {
    kind?: string;
    tool?: string;
    summary?: string;
    command?: string;
    input?: unknown;
    output?: string;
    file?: string;
    metadata?: Record<string, unknown>;
    files?: string[];
    diffExcerpt?: {
      header?: string;
      lines?: string[];
      added?: number;
      deleted?: number;
    };
  };
}

/** Mirrors webview `MessageEdit` — a file change record. */
export interface SdkMessageEdit {
  file: string;
  added?: number;
  deleted?: number;
}

/** SDK `info.summary.diffs` projected for the rehydrated File Changes card. */
export interface SdkMessageChangeSummary {
  messageId: string;
  filesChanged: number;
  added: number;
  deleted: number;
  files: Array<{
    file: string;
    added: number;
    deleted: number;
    diffExcerpt?: {
      header?: string;
      lines?: string[];
      added?: number;
      deleted?: number;
    };
  }>;
}

/** Mirrors webview `InteractiveEvent` choice option. */
export interface SdkInteractiveChoice {
  id?: string;
  label: string;
  value?: string;
  description?: string;
  recommended?: boolean;
}

/** Mirrors webview `InteractiveQuestionEvent`. */
export interface SdkInteractiveQuestionEvent {
  type: "question";
  id: string;
  requestID?: string;
  questionIndex?: number;
  title?: string;
  question: string;
  options: SdkInteractiveChoice[];
  multiSelect?: boolean;
  allowCustomInput?: boolean;
  contextMessage?: string;
}

/** Typed reasoning projection from the SDK's `ReasoningPart`. */
export interface SdkReasoningEvent {
  id: string;
  text: string;
  partID: string;
  messageID: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

/** Mirrors webview `SubagentDetail` (subset used by the adapter). */
export interface SdkSubagentDetail {
  id: string;
  name?: string;
  parentSessionId?: string;
  parentMessageId?: string;
  childSessionId?: string;
  agentId?: string;
  providerID?: string;
  modelID?: string;
  status: string;
  latestActivity?: string;
  references?: Array<{ messageID?: string; partID?: string }>;
  thinkingEvents?: unknown[];
  progressEvents?: unknown[];
  timelineEvents?: unknown[];
}

/** The rendered message produced by this adapter (mirrors webview `Message`). */
export interface SdkRenderedMessage {
  id?: string;
  role?: string;
  responseType?: string;
  structuredOutput?: Record<string, unknown>;
  parts?: SdkMessagePart[];
  text?: string;
  content?: string;
  tokens?: SdkMessageInfo["tokens"];
  duration?: number;
  error?: string;
  reasoningEvents?: SdkReasoningEvent[];
  progressEvents?: SdkMessageStep[];
  info?: SdkMessageInfo;
  plan?: Record<string, unknown>;
  edits?: SdkMessageEdit[];
  steps?: SdkMessageStep[];
  subagents?: SdkSubagentDetail[];
  interactiveEvents?: SdkInteractiveQuestionEvent[];
  rawStructuredOutputs?: unknown[];
  images?: string[];
  model?: { modelID: string; providerID: string; name?: string };
  modelID?: string;
  providerID?: string;
  agent?: string;
  variant?: string;
  created?: number;
  summary?: Record<string, unknown>;
  retryState?: string;
  retryStartedAt?: number;
  retryMessage?: string;
  changeSummary?: SdkMessageChangeSummary;
}

type SdkMessageEnvelope = { info: Message; parts: Part[] };
type UnknownRecord = Record<string, unknown>;

function isAssistantMessage(info: Message): info is AssistantMessage {
  return info.role === "assistant";
}

function isUserMessage(info: Message): info is UserMessage {
  return info.role === "user";
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The webview renders duration values as seconds. OpenCode message timestamps
 * are Unix milliseconds, so normalize once at the SDK boundary.
 */
function durationSeconds(info: AssistantMessage): number | undefined {
  const created = optionalNumber(info.time.created);
  const completed = optionalNumber(info.time.completed);
  if (created === undefined || completed === undefined || completed < created) {
    return undefined;
  }
  return (completed - created) / 1000;
}

function toRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function asDiffStats(value: unknown): { added: number; deleted: number } | undefined {
  const record = toRecord(value);
  const added = optionalNumber(record?.added) ?? optionalNumber(record?.additions);
  const deleted = optionalNumber(record?.deleted) ?? optionalNumber(record?.deletions) ?? optionalNumber(record?.removed);
  return added !== undefined || deleted !== undefined
    ? { added: added ?? 0, deleted: deleted ?? 0 }
    : undefined;
}

interface ToolDiffProjection {
  filePath?: string;
  diffStats?: { added: number; deleted: number };
  diffExcerpt?: {
    header?: string;
    lines?: string[];
    added?: number;
    deleted?: number;
  };
}

function diffExcerptFromPatch(
  patch: string | undefined,
  diffStats?: { added: number; deleted: number },
): ToolDiffProjection["diffExcerpt"] {
  const lines = patch
    ?.replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) =>
      line.length > 0 &&
      !line.startsWith("Index: ") &&
      !line.startsWith("===================================================================") &&
      !line.startsWith("--- ") &&
      !line.startsWith("+++ "),
    )
    .slice(0, 40);
  if (!lines || lines.length === 0) {
    return undefined;
  }
  return {
    header: lines.find((line) => line.startsWith("@@")),
    lines,
    added: diffStats?.added ?? lines.filter((line) => line.startsWith("+")).length,
    deleted: diffStats?.deleted ?? lines.filter((line) => line.startsWith("-")).length,
  };
}

/**
 * Converts the SDK's tool-state diff variants into the UI's semantic diff
 * fields. The raw SDK part is left untouched; this is only a render adapter.
 */
function toolDiffProjection(
  partRecord: UnknownRecord,
  stateRecord: UnknownRecord,
): ToolDiffProjection {
  const input = toRecord(stateRecord.input);
  const metadata = toRecord(stateRecord.metadata);
  const fileDiff = toRecord(metadata?.filediff);
  const diffStats =
    asDiffStats(fileDiff) ??
    asDiffStats(partRecord.diffStats) ??
    asDiffStats(stateRecord.diffStats);
  const patch =
    optionalString(fileDiff?.patch) ??
    optionalString(metadata?.diff);
  const diffExcerpt = diffExcerptFromPatch(patch, diffStats);

  return {
    filePath:
      optionalString(fileDiff?.file) ??
      optionalString(input?.filePath) ??
      optionalString(partRecord.filePath) ??
      optionalString(stateRecord.filePath),
    diffStats,
    diffExcerpt,
  };
}

function summaryDiffProjection(info: Message): SdkMessageChangeSummary | undefined {
  const summary = toRecord((info as unknown as UnknownRecord).summary);
  const diffs = Array.isArray(summary?.diffs) ? summary.diffs : [];
  const files = diffs.flatMap((value) => {
    const diff = toRecord(value);
    const file = optionalString(diff?.file);
    if (!file) {
      return [];
    }
    const diffStats = asDiffStats(diff);
    return [{
      file,
      added: diffStats?.added ?? 0,
      deleted: diffStats?.deleted ?? 0,
      diffExcerpt: diffExcerptFromPatch(optionalString(diff?.patch), diffStats),
    }];
  });
  if (files.length === 0) {
    return undefined;
  }
  return {
    messageId: info.id,
    filesChanged: files.length,
    added: files.reduce((total, file) => total + file.added, 0),
    deleted: files.reduce((total, file) => total + file.deleted, 0),
    files,
  };
}

function modelFromInfo(info: Message): { modelID: string; providerID: string; name?: string } | undefined {
  if (isAssistantMessage(info)) {
    return { modelID: info.modelID, providerID: info.providerID };
  }
  return { modelID: info.model.modelID, providerID: info.model.providerID };
}

function buildMessageInfo(info: Message): SdkMessageInfo {
  const model = modelFromInfo(info);
  const messageInfo: SdkMessageInfo = {
    id: info.id,
    parentID: isAssistantMessage(info) ? info.parentID : undefined,
    role: info.role,
    agent: info.agent,
    model,
    modelID: model?.modelID,
    providerID: model?.providerID,
    variant: isAssistantMessage(info) ? info.variant : info.model.variant,
  };

  if (isAssistantMessage(info)) {
    messageInfo.tokens = info.tokens;
    messageInfo.duration = durationSeconds(info);
    messageInfo.finish = info.finish !== undefined;
    if (info.structured !== undefined) {
      messageInfo.structured = toRecord(info.structured) ?? { value: info.structured };
      messageInfo.structuredOutput = adaptStructuredOutput(info);
    }
  }

  return messageInfo;
}

function errorToString(error: AssistantMessage["error"]): string | undefined {
  if (!error) return undefined;
  const data = toRecord(error.data);
  return optionalString(data?.message) ?? error.name;
}

function adaptToolPart(part: ToolPart): SdkMessageStep {
  const partRecord = part as ToolPart & UnknownRecord;
  const stateRecord = part.state as typeof part.state & UnknownRecord;
  const stateTitle = optionalString(stateRecord.title);
  const output = optionalString(stateRecord.output) ?? optionalString(stateRecord.error);
  const diff = toolDiffProjection(partRecord, stateRecord);
  const toolTime = toRecord(stateRecord.time);

  const step: SdkMessageStep = {
    type: "tool",
    // The tool name drives activity semantics (for example, whether an Edit
    // row renders its inline diff). `state.title` is display metadata such as
    // "package.json", not the action identity.
    title: optionalString(partRecord.title) ?? part.tool ?? stateTitle ?? "tool",
    id: part.id,
    callID: part.callID,
    messageID: part.messageID,
    sessionID: part.sessionID,
    status: part.state.status,
    source: "final",
    partType: "tool",
    startedAt: typeof toolTime?.start === "number" ? toolTime.start : undefined,
    endedAt: typeof toolTime?.end === "number" ? toolTime.end : undefined,
    activityDetail: {
      kind: "tool_call",
      tool: part.tool,
      input: part.state.input,
      output,
      file: diff.filePath,
      metadata: toRecord(stateRecord.metadata) ?? undefined,
      diffExcerpt: diff.diffExcerpt,
    },
  };
  if (diff.diffStats) step.diffStats = diff.diffStats;
  if (diff.filePath) step.filePath = diff.filePath;
  return step;
}

function adaptStepStartPart(part: StepStartPart): SdkMessageStep {
  const partRecord = part as StepStartPart & UnknownRecord; // title is present in some server payloads before SDK typing catches up.
  return {
    type: "step-start",
    title: optionalString(partRecord.title) ?? "Step started",
    internal: true,
    meta: optionalString(part.snapshot),
  };
}

function adaptStepFinishPart(part: StepFinishPart): SdkMessageStep {
  const partRecord = part as StepFinishPart & UnknownRecord;
  const step: SdkMessageStep = {
    type: "step-finish",
    title: optionalString(partRecord.title) ?? "Step finished",
    status: optionalString(partRecord.status) ?? part.reason,
    internal: true,
    meta: optionalString(part.snapshot),
  };
  const diffStats = asDiffStats(partRecord.diffStats);
  if (diffStats) step.diffStats = diffStats;
  return step;
}

function adaptPatchPart(part: PatchPart): SdkMessageEdit[] {
  const partRecord = part as PatchPart & UnknownRecord;
  const diffStats = asDiffStats(partRecord.diffStats);
  const files = Array.isArray(part.files) && part.files.length > 0
    ? part.files
    : [optionalString(partRecord.filePath) ?? optionalString(partRecord.file)].filter((file): file is string => !!file);
  return files.map((file): SdkMessageEdit => ({
    file,
    added: diffStats?.added,
    deleted: diffStats?.deleted,
  }));
}

export function adaptSubtaskPart(part: SubtaskPart, info: Message): SdkSubagentDetail {
  const id = part.sessionID;
  const name = part.description || part.prompt;
  const detail: SdkSubagentDetail & { name: string } = {
    id,
    name,
    parentSessionId: info.sessionID,
    parentMessageId: part.messageID,
    childSessionId: part.sessionID,
    agentId: part.agent,
    providerID: part.model?.providerID,
    modelID: part.model?.modelID,
    status: "pending",
    latestActivity: name,
    references: [{ messageID: part.messageID, partID: part.id }],
    thinkingEvents: [],
    progressEvents: [],
    timelineEvents: [],
  };
  return detail;
}

function adaptFilePart(part: FilePart): SdkMessagePart {
  return {
    type: "file",
    url: part.url,
    filename: part.filename,
    mime: part.mime,
    source: part.source,
  };
}

function textFromDataUrl(url: string | undefined, mime: string | undefined): string | undefined {
  if (!url || !mime?.toLowerCase().startsWith("text/") || !url.startsWith("data:")) {
    return undefined;
  }
  const commaIndex = url.indexOf(",");
  if (commaIndex < 0) {
    return undefined;
  }
  const metadata = url.slice(0, commaIndex).toLowerCase();
  const payload = url.slice(commaIndex + 1);
  try {
    if (metadata.includes(";base64")) {
      return Buffer.from(payload, "base64").toString("utf-8");
    }
    return decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

/**
 * OpenCode rehydration can include a text/plain attachment twice: once as a
 * `file` part and again as a plain text part. Keep the file part so its chip
 * renders, but do not turn its identical payload into bubble content.
 */
function visibleUserTextFromParts(parts: SdkMessagePart[]): string {
  const attachmentContents = new Set(
    parts
      .filter((part) => part.type === "file")
      .map((part) => textFromDataUrl(part.url, part.mime))
      .filter((text): text is string => typeof text === "string"),
  );

  return parts
    .filter((part) => part.type === "text" && part.synthetic !== true)
    .map((part) => part.text ?? part.content ?? part.message ?? "")
    .filter((text) => text.trim().length > 0 && !attachmentContents.has(text))
    .join("");
}

function applyRetryMarker(message: SdkRenderedMessage, part: RetryPart): void {
  message.retryState = "retrying_without_structured_output";
  message.retryStartedAt = part.time.created;
  message.retryMessage = errorToString(part.error) ?? `Retry attempt ${part.attempt}`;
}

function applyCompactionMarker(message: SdkRenderedMessage, part: CompactionPart): void {
  const marker = part.overflow ? "Context compacted after overflow" : part.auto ? "Context compacted automatically" : "Context compacted";
  message.summary = { ...(message.summary ?? {}), body: marker };
  message.info = { ...(message.info ?? {}), summary: { ...(message.info?.summary ?? {}), body: marker } };
}

export function adaptSdkMessage(sdkMessage: SdkMessageEnvelope): SdkRenderedMessage {
  const { info, parts } = sdkMessage;
  const message: SdkRenderedMessage = {
    id: info.id,
    role: info.role,
    info: buildMessageInfo(info),
    parts: [],
    reasoningEvents: [],
    steps: [],
    progressEvents: [],
    edits: [],
    subagents: [],
    created: info.time.created,
    model: modelFromInfo(info),
    modelID: modelFromInfo(info)?.modelID,
    providerID: modelFromInfo(info)?.providerID,
    agent: info.agent,
    changeSummary: summaryDiffProjection(info),
  };

  if (isAssistantMessage(info)) {
    message.tokens = info.tokens;
    message.duration = durationSeconds(info);
    message.error = errorToString(info.error);
    if (info.structured !== undefined) {
      const structuredOutput = adaptStructuredOutput(info);
      message.structuredOutput = structuredOutput;
      message.rawStructuredOutputs = [info.structured];
      message.responseType = optionalString(structuredOutput.responseType);
      if (toRecord(structuredOutput.plan)) {
        message.plan = structuredOutput.plan as Record<string, unknown>;
      }
      const events = structuredOutput.interactiveEvents;
      if (Array.isArray(events)) {
        message.interactiveEvents = events as SdkInteractiveQuestionEvent[];
      }
    }
  }

  const textParts: string[] = [];
  const images: string[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      const textPart = part as TextPart;
      textParts.push(textPart.text);
      const synthetic = (textPart as unknown as { synthetic?: unknown }).synthetic === true;
      message.parts?.push({ type: "text", text: textPart.text, synthetic });
    } else if (part.type === "reasoning") {
      const reasoningPart = part as ReasoningPart;
      message.reasoningEvents?.push({
        id: reasoningPart.id,
        text: reasoningPart.text,
        partID: reasoningPart.id,
        messageID: info.id,
        createdAt: reasoningPart.time?.start ?? info.time.created,
        startedAt: reasoningPart.time?.start,
        endedAt: reasoningPart.time?.end,
      });
    } else if (part.type === "tool") {
      const step = adaptToolPart(part as ToolPart);
      message.steps?.push(step);
      message.progressEvents?.push(step);
    } else if (part.type === "step-start") {
      message.steps?.push(adaptStepStartPart(part as StepStartPart));
    } else if (part.type === "step-finish") {
      message.steps?.push(adaptStepFinishPart(part as StepFinishPart));
    } else if (part.type === "patch") {
      message.edits?.push(...adaptPatchPart(part as PatchPart));
    } else if (part.type === "snapshot") {
      const snapshotPart = part as SnapshotPart;
      message.steps?.push({ type: "snapshot", title: "Checkpoint", internal: true, meta: snapshotPart.snapshot, id: snapshotPart.id });
    } else if (part.type === "subtask") {
      message.subagents?.push(adaptSubtaskPart(part as SubtaskPart, info));
    } else if (part.type === "file") {
      const filePart = part as FilePart;
      message.parts?.push(adaptFilePart(filePart));
      if (isUserMessage(info) && filePart.mime.startsWith("image/")) {
        images.push(filePart.url);
      }
    } else if (part.type === "agent") {
      const agentPart = part as AgentPart;
      message.agent = agentPart.name;
      message.info = { ...(message.info ?? {}), agent: agentPart.name };
    } else if (part.type === "retry") {
      applyRetryMarker(message, part as RetryPart);
    } else if (part.type === "compaction") {
      applyCompactionMarker(message, part as CompactionPart);
    }
  }

  const content = isUserMessage(info)
    ? visibleUserTextFromParts(message.parts ?? [])
    : textParts.join("");
  if (content) {
    message.content = content;
    message.text = content;
  }
  if (images.length > 0) {
    message.images = images;
  }

  return message;
}

export function adaptSdkMessages(sdkMessages: SdkMessageEnvelope[]): SdkRenderedMessage[] {
  // `info.summary.diffs` belongs to the SDK message that owns it (normally
  // the user request). Keep that ownership intact: the transcript can then
  // place the change summary directly below that request, while its
  // `messageId` remains the exact Undo target. Moving it to a neighbouring
  // assistant envelope loses both the visual ordering and the SDK boundary.
  return sdkMessages.map(adaptSdkMessage);
}

export function adaptStructuredOutput(info: AssistantMessage): Record<string, unknown> {
  const structured = toRecord(info.structured);
  if (!structured) return {};

  const responseType = optionalString(structured.type)
    ?? optionalString(structured.responseType)
    ?? (structured.plan !== undefined ? "implementation_plan" : structured.question !== undefined ? "question" : "message");
  const result: Record<string, unknown> = {
    ...structured,
    type: responseType,
    responseType,
  };

  const plan = toRecord(structured.plan);
  if (plan) {
    const files = Array.isArray(plan.files) ? plan.files : undefined;
    result.plan = {
      file: optionalString(plan.file),
      content: optionalString(plan.content),
      title: optionalString(plan.title),
      intro: optionalString(plan.intro),
      summary: optionalString(plan.summary),
      files,
      fileCount: optionalNumber(plan.fileCount) ?? files?.length,
    };
  }

  const question = toRecord(structured.question);
  if (question) {
    const event = questionRecordToInteractiveEvent(question, optionalString(structured.requestID) ?? info.id);
    if (event) result.interactiveEvents = [event];
  }

  return result;
}

export function adaptSessionToMeta(session: Session): { id: string; title: string; createdAt?: number; parentSessionId?: string } {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.time?.created,
    parentSessionId: session.parentID,
  };
}

function questionRecordToInteractiveEvent(question: UnknownRecord, requestID: string, questionIndex = 0): SdkInteractiveQuestionEvent | undefined {
  const questionText = optionalString(question.question) ?? optionalString(question.text) ?? optionalString(question.message);
  if (!questionText) return undefined;
  const rawOptions = Array.isArray(question.options) ? question.options : [];
  return {
    type: "question",
    id: `${requestID}:${questionIndex}`,
    requestID,
    questionIndex,
    title: optionalString(question.header) ?? optionalString(question.title),
    question: questionText,
    options: rawOptions.map((option, index) => {
      const optionRecord = toRecord(option);
      const label = optionalString(optionRecord?.label) ?? optionalString(option) ?? `Option ${index + 1}`;
      return {
        id: optionalString(optionRecord?.id) ?? String(index),
        label,
        value: optionalString(optionRecord?.value) ?? label,
        description: optionalString(optionRecord?.description),
        recommended: optionRecord?.recommended === true,
      };
    }),
    multiSelect: question.multiple === true || question.multiSelect === true,
    allowCustomInput: question.custom === true || question.allowCustomInput === true,
    contextMessage: optionalString(question.displayPrompt) ?? optionalString(question.contextMessage),
  };
}

export function adaptQuestionRequest(q: QuestionRequest): SdkInteractiveQuestionEvent {
  const firstQuestion = toRecord(q.questions[0]);
  return (firstQuestion ? questionRecordToInteractiveEvent(firstQuestion, q.id, 0) : undefined) ?? {
    type: "question",
    id: `${q.id}:0`,
    requestID: q.id,
    questionIndex: 0,
    question: "Question",
    options: [],
  };
}

export function adaptPermissionRequest(p: PermissionRequest): {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  tool?: { messageID: string; callID: string };
} {
  return {
    id: p.id,
    sessionID: p.sessionID,
    permission: p.permission,
    patterns: p.patterns,
    tool: p.tool,
  };
}
