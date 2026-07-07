type UnknownRecord = Record<string, unknown>;

export type SubagentStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "orphaned";

export type SubagentReference = {
  messageID?: string;
  partID?: string;
  callID?: string;
};

export type SubagentTimelineEvent = {
  key: string;
  type: string;
  label: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
  callID?: string;
};

export type SubagentThinkingEvent = {
  id: string;
  text: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
};

export type SubagentConversationEvent = {
  id: string;
  role: string;
  kind: "message" | "reasoning" | "step";
  text: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
};

export type SubagentProgressEvent = {
  id: string;
  title: string;
  status: "pending" | "done" | "error";
  meta?: string;
  filePath?: string;
  diffStats?: { added: number; deleted: number };
  createdAt: number;
  messageID?: string;
  partID?: string;
  callID?: string;
};

export type SubagentSummary = {
  id: string;
  parentSessionId: string;
  parentMessageId: string;
  childSessionId?: string;
  agentId?: string;
  providerID?: string;
  modelID?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  status: SubagentStatus;
  latestActivity: string;
  references: SubagentReference[];
};

export type SubagentDetail = SubagentSummary & {
  thinkingEvents: SubagentThinkingEvent[];
  conversationEvents: SubagentConversationEvent[];
  progressEvents: SubagentProgressEvent[];
  timelineEvents: SubagentTimelineEvent[];
  tokenUsage?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  errorText?: string;
  hydrationUnavailable?: boolean;
};

export type SubagentUpdatePayload = {
  summariesByParentMessageId: Record<string, SubagentSummary[]>;
  detailsById: Record<string, SubagentDetail>;
};

type FinalizeParentMessageOptions = {
  client: {
    session?: {
      children?: (params: { sessionID: string }) => Promise<{
        data?: unknown[];
        error?: unknown;
      }>;
      messages?: (params: { sessionID: string }) => Promise<{
        data?: unknown[];
        error?: unknown;
      }>;
    };
  };
  parentSessionId: string;
  parentMessageId: string;
};

const MAX_TIMELINE_EVENTS = 200;
const MAX_PROGRESS_EVENTS = 200;
const MAX_THINKING_EVENTS = 200;
const MAX_CONVERSATION_EVENTS = 400;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function extractErrorText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  const rec = asRecord(value);
  if (!rec) {
    return "";
  }

  const directMessage = asString(rec.message).trim();
  if (directMessage) {
    return directMessage;
  }

  const data = asRecord(rec.data);
  const dataMessage = asString(data?.message).trim();
  if (dataMessage) {
    return dataMessage;
  }

  const nestedDataError = asRecord(data?.error);
  const nestedDataErrorMessage = asString(nestedDataError?.message).trim();
  if (nestedDataErrorMessage) {
    return nestedDataErrorMessage;
  }

  const nestedError = asRecord(rec.error);
  const nestedErrorMessage = asString(nestedError?.message).trim();
  if (nestedErrorMessage) {
    return nestedErrorMessage;
  }

  // Try even more nested fields that might contain the actual error
  const cause = asRecord(rec.cause);
  const causeMessage = cause ? asString(cause.message).trim() : "";
  if (causeMessage) {
    return causeMessage;
  }

  const response = asRecord(rec.response);
  const responseData = response ? asRecord(response.data) : null;
  const responseMessage = responseData ? asString(responseData.message).trim() : "";
  if (responseMessage) {
    return responseMessage;
  }

  const body = asRecord(rec.body);
  const bodyMessage = body ? asString(body.message).trim() : "";
  if (bodyMessage) {
    return bodyMessage;
  }

  // Check other common error message fields
  const description = asString(rec.description).trim();
  if (description) {
    return description;
  }

  const details = asString(rec.details).trim();
  if (details) {
    return details;
  }

  const reason = asString(rec.reason).trim();
  if (reason) {
    return reason;
  }

  // Only use error name as absolute last resort
  const name = asString(rec.name).trim();
  if (name && name.toLowerCase() !== "unknownerror") {
    // If the name is a generic error class name, don't use it - we want the actual message
    if (name.endsWith('Error')) {
      // Don't return just the error class name - this is likely not helpful
      // Return empty string to indicate we couldn't find a meaningful error message
      return "";
    }
    return name;
  }

  return "";
}

function toTimestamp(value: unknown, fallback = Date.now()): number {
  const n = asNumber(value);
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  return fallback;
}

function isReasoningPart(part: UnknownRecord): boolean {
  const partType = asString(part.type).toLowerCase();
  return (
    partType === "reasoning" ||
    typeof part.reasoning !== "undefined" ||
    typeof part.thought !== "undefined" ||
    typeof part.thinking !== "undefined"
  );
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

function sanitizeReasoningText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isOpaqueIdLike(trimmed)) {
    return "";
  }
  return value;
}

function sanitizeActivityLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isOpaqueIdLike(trimmed)) {
    return "";
  }
  return trimmed.replace(/\s+/g, " ");
}

function joinConversationText(previous: string, incoming: string): string {
  if (!previous) {
    return incoming;
  }
  if (!incoming) {
    return previous;
  }
  if (incoming === previous) {
    return previous;
  }
  if (incoming.startsWith(previous)) {
    return incoming;
  }
  if (previous.endsWith(incoming)) {
    return previous;
  }

  const prevChar = previous[previous.length - 1];
  const nextChar = incoming[0];
  const needsSpace =
    !/\s/.test(prevChar) &&
    !/\s/.test(nextChar) &&
    !/^[,.;:!?)}\]]/.test(incoming) &&
    !/[([{]$/ .test(prevChar);
  return needsSpace ? `${previous} ${incoming}` : `${previous}${incoming}`;
}

function normalizeProgressStatus(value: unknown): "pending" | "done" | "error" {
  const status = asString(value).toLowerCase();
  if (
    status === "done" ||
    status === "completed" ||
    status === "success" ||
    status === "finished" ||
    status === "complete"
  ) {
    return "done";
  }
  if (status === "error" || status === "failed") {
    return "error";
  }
  return "pending";
}

function clampEvents<T>(events: T[], max: number): T[] {
  if (events.length <= max) {
    return events;
  }
  return events.slice(events.length - max);
}

function cloneReference(ref: SubagentReference): SubagentReference {
  return {
    messageID: ref.messageID,
    partID: ref.partID,
    callID: ref.callID,
  };
}

function cloneSummary(summary: SubagentSummary): SubagentSummary {
  return {
    ...summary,
    references: summary.references.map(cloneReference),
  };
}

function cloneDetail(detail: SubagentDetail): SubagentDetail {
  return {
    ...cloneSummary(detail),
    thinkingEvents: detail.thinkingEvents.map((event) => ({ ...event })),
    conversationEvents: detail.conversationEvents.map((event) => ({ ...event })),
    progressEvents: detail.progressEvents.map((event) => ({ ...event })),
    timelineEvents: detail.timelineEvents.map((event) => ({ ...event })),
    tokenUsage: detail.tokenUsage
      ? {
          input: detail.tokenUsage.input,
          output: detail.tokenUsage.output,
          reasoning: detail.tokenUsage.reasoning,
          cache: detail.tokenUsage.cache
            ? {
                read: detail.tokenUsage.cache.read,
                write: detail.tokenUsage.cache.write,
              }
            : undefined,
        }
      : undefined,
  };
}

function compareByStartedAtDesc(a: SubagentSummary, b: SubagentSummary): number {
  const aTime = a.startedAt ?? 0;
  const bTime = b.startedAt ?? 0;
  return bTime - aTime;
}

export class SubagentTracker {
  private activeSessionId: string | null = null;
  private detailsById = new Map<string, SubagentDetail>();
  private idsByParentMessageId = new Map<string, string[]>();
  private pendingSubtasksByParentSessionId = new Map<string, string[]>();
  private latestParentMessageBySessionId = new Map<string, string>();
  private childSessionToSubagentId = new Map<string, string>();
  private childSessionToParentSessionId = new Map<string, string>();

  constructor(
    private getSelectedModel: () => { providerID?: string; modelID?: string } | undefined = () => undefined,
  ) {}

  resetForSession(sessionId: string | null): void {
    this.activeSessionId = sessionId;
    this.detailsById.clear();
    this.idsByParentMessageId.clear();
    this.pendingSubtasksByParentSessionId.clear();
    this.latestParentMessageBySessionId.clear();
    this.childSessionToSubagentId.clear();
    this.childSessionToParentSessionId.clear();
  }

  setActiveSession(sessionId: string | null): void {
    // Memory fix: when switching to a different session, proactively clear all
    // cross-session Maps so stale subagent data from the previous session doesn't
    // accumulate. seedFromMessages() will rebuild from the new session's history.
    if (sessionId !== this.activeSessionId) {
      this.detailsById.clear();
      this.idsByParentMessageId.clear();
      this.pendingSubtasksByParentSessionId.clear();
      this.latestParentMessageBySessionId.clear();
      this.childSessionToSubagentId.clear();
      this.childSessionToParentSessionId.clear();
    }
    this.activeSessionId = sessionId;
  }

  getLatestParentMessageId(parentSessionId: string): string | undefined {
    const id = this.latestParentMessageBySessionId.get(parentSessionId);
    return id || undefined;
  }

  getActiveProcessingSessionIds(): string[] {
    const activeSessionIds = new Set<string>();
    for (const detail of Array.from(this.detailsById.values())) {
      if (detail.status === "pending" || detail.status === "running") {
        if (detail.parentSessionId) {
          activeSessionIds.add(detail.parentSessionId);
        }
      }
    }
    return Array.from(activeSessionIds);
  }

  seedFromMessages(messages: unknown[]): void {
    this.detailsById.clear();
    this.idsByParentMessageId.clear();
    this.pendingSubtasksByParentSessionId.clear();
    this.latestParentMessageBySessionId.clear();
    this.childSessionToSubagentId.clear();
    this.childSessionToParentSessionId.clear();

    for (const rawMessage of messages) {
      const message = asRecord(rawMessage);
      if (!message) {
        continue;
      }
      const info = asRecord(message.info);
      const role = asString(message.role) || asString(info?.role);
      if (role !== "assistant") {
        continue;
      }

      const parentMessageId =
        asString(info?.id) ||
        asString(message.id) ||
        asString(message.messageID);
      if (!parentMessageId) {
        continue;
      }
      const parentSessionId =
        asString(info?.sessionID) ||
        asString(message.sessionID) ||
        this.activeSessionId ||
        "";
      if (!parentSessionId) {
        continue;
      }

      const subagents = Array.isArray(message.subagents)
        ? message.subagents
        : [];
      for (const rawSubagent of subagents) {
        const detail = this.normalizePersistedDetail(
          rawSubagent,
          parentSessionId,
          parentMessageId,
        );
        if (!detail) {
          continue;
        }
        this.upsertDetail(detail);
      }
    }
  }

  consumeStreamEvent(event: unknown): SubagentUpdatePayload | null {
    const evt = asRecord(event);
    if (!evt) {
      return null;
    }
    const eventType = asString(evt.type);
    const properties = asRecord(evt.properties) || {};

    const changedParents = new Set<string>();
    const changedDetails = new Set<string>();

    if (eventType === "message.part.updated") {
      this.handleMessagePartUpdated(properties, changedParents, changedDetails);
    } else if (eventType === "message.updated") {
      this.handleMessageUpdated(properties, changedParents, changedDetails);
    } else if (eventType === "session.created") {
      this.handleSessionCreated(properties, changedParents, changedDetails);
    } else if (eventType === "session.error") {
      this.handleSessionError(properties, changedParents, changedDetails);
    }

    if (changedParents.size === 0 && changedDetails.size === 0) {
      return null;
    }

    return this.buildUpdatePayload(changedParents, changedDetails);
  }

  getSnapshotPayload(): SubagentUpdatePayload {
    const parentKeys = new Set(this.idsByParentMessageId.keys());
    const detailKeys = new Set(this.detailsById.keys());
    return this.buildUpdatePayload(parentKeys, detailKeys);
  }

  getPayloadForParentMessage(parentMessageId: string): SubagentUpdatePayload {
    const ids = this.idsByParentMessageId.get(parentMessageId) || [];
    return this.buildUpdatePayload(new Set([parentMessageId]), new Set(ids));
  }

  async finalizeParentMessage(
    options: FinalizeParentMessageOptions,
  ): Promise<SubagentDetail[]> {
    const { client, parentSessionId, parentMessageId } = options;
    this.activeSessionId = parentSessionId;

    const runIds = [...(this.idsByParentMessageId.get(parentMessageId) || [])];
    if (runIds.length === 0) {
      return [];
    }

    const childrenFn = client.session?.children;
    if (!childrenFn) {
      for (const runId of runIds) {
        const detail = this.detailsById.get(runId);
        if (!detail) {
          continue;
        }
        detail.hydrationUnavailable = true;
      }
      return runIds
        .map((id) => this.detailsById.get(id))
        .filter((item): item is SubagentDetail => !!item)
        .map(cloneDetail);
    }

    try {
      const response = await childrenFn({ sessionID: parentSessionId });
      if (response.error) {
        for (const runId of runIds) {
          const detail = this.detailsById.get(runId);
          if (!detail) {
            continue;
          }
          detail.hydrationUnavailable = true;
        }
      } else {
        const childSessions = Array.isArray(response.data) ? response.data : [];
        for (const childRaw of childSessions) {
          const child = asRecord(childRaw);
          if (!child) {
            continue;
          }
          const childSessionId = asString(child.id);
          const parentId = asString(child.parentID);
          if (!childSessionId || parentId !== parentSessionId) {
            continue;
          }

          const subagentId =
            this.childSessionToSubagentId.get(childSessionId) ||
            this.bindChildSessionToKnownSubtask(
              parentSessionId,
              childSessionId,
            );
          if (!subagentId) {
            continue;
          }

          const detail = this.detailsById.get(subagentId);
          if (!detail) {
            continue;
          }
          const time = asRecord(child.time);
          detail.childSessionId = childSessionId;
          detail.startedAt = detail.startedAt ?? asNumber(time?.created);
          detail.endedAt = detail.endedAt ?? asNumber(time?.updated);
          if (
            typeof detail.startedAt === "number" &&
            typeof detail.endedAt === "number"
          ) {
            detail.durationMs = Math.max(0, detail.endedAt - detail.startedAt);
          }

          await this.hydrateChildSessionMessages(client, detail);
          if (detail.status === "pending" || detail.status === "orphaned") {
            detail.status = "running";
          }
        }
      }
    } catch {
      for (const runId of runIds) {
        const detail = this.detailsById.get(runId);
        if (!detail) {
          continue;
        }
        detail.hydrationUnavailable = true;
      }
    }

    return runIds
      .map((id) => this.detailsById.get(id))
      .filter((item): item is SubagentDetail => !!item)
      .map((detail) => {
        this.recomputeDuration(detail);
        return cloneDetail(detail);
      });
  }

  private normalizePersistedDetail(
    raw: unknown,
    parentSessionId: string,
    parentMessageId: string,
  ): SubagentDetail | null {
    const rec = asRecord(raw);
    if (!rec) {
      return null;
    }

    const id = asString(rec.id);
    if (!id) {
      return null;
    }

    const statusValue = asString(rec.status).toLowerCase();
    const status: SubagentStatus =
      statusValue === "pending" ||
      statusValue === "running" ||
      statusValue === "done" ||
      statusValue === "error" ||
      statusValue === "orphaned"
        ? (statusValue as SubagentStatus)
        : statusValue === "completed" ||
          statusValue === "finished" ||
          statusValue === "success"
          ? "done"
          : statusValue === "failed" ||
              statusValue === "cancelled" ||
              statusValue === "canceled"
            ? "error"
            : "pending";

    const references = Array.isArray(rec.references)
      ? rec.references
          .map((item): SubagentReference | null => {
            const ref = asRecord(item);
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
          .filter((item): item is SubagentReference => item !== null)
      : [];

    const thinkingEvents = Array.isArray(rec.thinkingEvents)
      ? rec.thinkingEvents
          .map((item) => {
            const event = asRecord(item);
            if (!event) {
              return null;
            }
            const text = asString(event.text);
            if (!text) {
              return null;
            }
            return {
              id: asString(event.id) || `thought-${Date.now()}`,
              text,
              createdAt: toTimestamp(event.createdAt),
              messageID: asString(event.messageID) || undefined,
              partID: asString(event.partID) || undefined,
            } as SubagentThinkingEvent;
          })
          .filter((item): item is SubagentThinkingEvent => !!item)
      : [];

    const conversationEvents = Array.isArray(rec.conversationEvents)
      ? rec.conversationEvents
          .map((item) => {
            const event = asRecord(item);
            if (!event) {
              return null;
            }
            const text = sanitizeReasoningText(asString(event.text));
            if (!text) {
              return null;
            }
            const kindRaw = asString(event.kind).toLowerCase();
            const kind: SubagentConversationEvent["kind"] =
              kindRaw === "reasoning" || kindRaw === "step"
                ? (kindRaw as SubagentConversationEvent["kind"])
                : "message";
            return {
              id: asString(event.id) || `conversation-${Date.now()}`,
              role: asString(event.role) || "assistant",
              kind,
              text,
              createdAt: toTimestamp(event.createdAt),
              messageID: asString(event.messageID) || undefined,
              partID: asString(event.partID) || undefined,
            } as SubagentConversationEvent;
          })
          .filter((item): item is SubagentConversationEvent => !!item)
      : [];

    const progressEvents = Array.isArray(rec.progressEvents)
      ? rec.progressEvents
          .map((item) => {
            const event = asRecord(item);
            if (!event) {
              return null;
            }
            const title = asString(event.title);
            if (!title) {
              return null;
            }
            const diffStatsRec = asRecord(event.diffStats);
            const diffStats = diffStatsRec
              ? {
                  added: asNumber(diffStatsRec.added) || 0,
                  deleted: asNumber(diffStatsRec.deleted) || 0,
                }
              : undefined;

            return {
              id: asString(event.id) || `progress-${Date.now()}`,
              title,
              status: normalizeProgressStatus(event.status),
              meta: asString(event.meta) || undefined,
              filePath: asString(event.filePath) || undefined,
              diffStats,
              createdAt: toTimestamp(event.createdAt),
              messageID: asString(event.messageID) || undefined,
              partID: asString(event.partID) || undefined,
              callID: asString(event.callID) || undefined,
            } as SubagentProgressEvent;
          })
          .filter((item): item is SubagentProgressEvent => !!item)
      : [];

    const timelineEvents = Array.isArray(rec.timelineEvents)
      ? rec.timelineEvents
          .map((item) => {
            const event = asRecord(item);
            if (!event) {
              return null;
            }
            const key = asString(event.key);
            const type = asString(event.type);
            const label = asString(event.label);
            if (!key || !type || !label) {
              return null;
            }
            return {
              key,
              type,
              label,
              createdAt: toTimestamp(event.createdAt),
              messageID: asString(event.messageID) || undefined,
              partID: asString(event.partID) || undefined,
              callID: asString(event.callID) || undefined,
            } as SubagentTimelineEvent;
          })
          .filter((item): item is SubagentTimelineEvent => !!item)
      : [];

    const tokenUsage = asRecord(rec.tokenUsage);
    const tokenCache = asRecord(tokenUsage?.cache);

    const detail: SubagentDetail = {
      id,
      parentSessionId: asString(rec.parentSessionId) || parentSessionId,
      parentMessageId: asString(rec.parentMessageId) || parentMessageId,
      childSessionId: asString(rec.childSessionId) || undefined,
      agentId: asString(rec.agentId) || undefined,
      providerID: asString(rec.providerID) || undefined,
      modelID: asString(rec.modelID) || undefined,
      startedAt: asNumber(rec.startedAt),
      endedAt: asNumber(rec.endedAt),
      durationMs: asNumber(rec.durationMs),
      status,
      latestActivity: asString(rec.latestActivity) || "Loaded from history",
      references,
      thinkingEvents,
      conversationEvents,
      progressEvents,
      timelineEvents,
      tokenUsage: tokenUsage
        ? {
            input: asNumber(tokenUsage.input),
            output: asNumber(tokenUsage.output),
            reasoning: asNumber(tokenUsage.reasoning),
            cache: tokenCache
              ? {
                  read: asNumber(tokenCache.read),
                  write: asNumber(tokenCache.write),
                }
              : undefined,
          }
        : undefined,
      errorText: asString(rec.errorText) || undefined,
      hydrationUnavailable: asBoolean(rec.hydrationUnavailable),
    };

    this.recomputeDuration(detail);
    return detail;
  }

  private buildUpdatePayload(
    parentMessageIds: Set<string>,
    detailIds: Set<string>,
  ): SubagentUpdatePayload {
    const summariesByParentMessageId: Record<string, SubagentSummary[]> = {};
    for (const parentMessageId of Array.from(parentMessageIds)) {
      const ids = this.idsByParentMessageId.get(parentMessageId) || [];
      const summaries = ids
        .map((id) => this.detailsById.get(id))
        .filter((item): item is SubagentDetail => !!item)
        .map((detail) => {
          this.recomputeDuration(detail);
          return cloneSummary(detail);
        })
        .sort(compareByStartedAtDesc);
      summariesByParentMessageId[parentMessageId] = summaries;
    }

    const detailsById: Record<string, SubagentDetail> = {};
    for (const detailId of Array.from(detailIds)) {
      const detail = this.detailsById.get(detailId);
      if (!detail) {
        continue;
      }
      this.recomputeDuration(detail);
      detailsById[detailId] = cloneDetail(detail);
    }

    return { summariesByParentMessageId, detailsById };
  }

  private upsertDetail(detail: SubagentDetail): void {
    this.detailsById.set(detail.id, detail);
    this.attachToParentMessage(detail.parentMessageId, detail.id);
    if (detail.childSessionId) {
      this.childSessionToSubagentId.set(detail.childSessionId, detail.id);
      this.childSessionToParentSessionId.set(
        detail.childSessionId,
        detail.parentSessionId,
      );
    }
    this.latestParentMessageBySessionId.set(
      detail.parentSessionId,
      detail.parentMessageId,
    );
  }

  private attachToParentMessage(
    parentMessageId: string,
    subagentId: string,
  ): void {
    const ids = this.idsByParentMessageId.get(parentMessageId) || [];
    if (!ids.includes(subagentId)) {
      ids.push(subagentId);
      this.idsByParentMessageId.set(parentMessageId, ids);
    }
  }

  private makeSubtaskSubagentId(
    sessionId: string,
    messageId: string,
    partId: string,
  ): string {
    return `subtask:${sessionId}:${messageId}:${partId}`;
  }

  private makeTimelineKey(
    eventType: string,
    messageID: string | undefined,
    partID: string | undefined,
    createdAt: number,
  ): string {
    return `${eventType}:${messageID || "-"}:${partID || "-"}:${createdAt}`;
  }

  private addReference(detail: SubagentDetail, ref: SubagentReference): void {
    if (!ref.messageID && !ref.partID && !ref.callID) {
      return;
    }
    const exists = detail.references.some(
      (entry) =>
        entry.messageID === ref.messageID &&
        entry.partID === ref.partID &&
        entry.callID === ref.callID,
    );
    if (!exists) {
      detail.references.push(ref);
    }
  }

  private pushTimeline(
    detail: SubagentDetail,
    event: SubagentTimelineEvent,
  ): void {
    const label = sanitizeActivityLabel(event.label);
    if (!label) {
      return;
    }
    const normalizedEvent: SubagentTimelineEvent = {
      ...event,
      label,
    };
    const previous = detail.timelineEvents[detail.timelineEvents.length - 1];
    if (
      previous &&
      previous.type === normalizedEvent.type &&
      previous.label === normalizedEvent.label
    ) {
      previous.createdAt = Math.max(previous.createdAt, normalizedEvent.createdAt);
      previous.messageID = normalizedEvent.messageID || previous.messageID;
      previous.partID = normalizedEvent.partID || previous.partID;
      previous.callID = normalizedEvent.callID || previous.callID;
      return;
    }
    detail.timelineEvents = clampEvents(
      [...detail.timelineEvents, normalizedEvent],
      MAX_TIMELINE_EVENTS,
    );
  }

  private pushThinking(
    detail: SubagentDetail,
    event: SubagentThinkingEvent,
  ): void {
    detail.thinkingEvents = clampEvents(
      [...detail.thinkingEvents, event],
      MAX_THINKING_EVENTS,
    );
  }

  private pushConversation(
    detail: SubagentDetail,
    event: Omit<SubagentConversationEvent, "id">,
  ): void {
    const text = sanitizeReasoningText(event.text);
    if (!text) {
      return;
    }

    const role = sanitizeActivityLabel(event.role) || "assistant";
    const normalizedEvent: SubagentConversationEvent = {
      ...event,
      role,
      text,
      id: `${event.messageID || "msg"}:${event.kind}:${event.partID || "part"}:${event.createdAt}`,
    };

    for (let index = detail.conversationEvents.length - 1; index >= 0; index -= 1) {
      const existing = detail.conversationEvents[index];
      if (
        existing.role !== normalizedEvent.role ||
        existing.kind !== normalizedEvent.kind
      ) {
        continue;
      }
      if (
        existing.messageID !== normalizedEvent.messageID ||
        existing.partID !== normalizedEvent.partID
      ) {
        continue;
      }
      existing.text = joinConversationText(existing.text, normalizedEvent.text);
      existing.createdAt = Math.max(existing.createdAt, normalizedEvent.createdAt);
      return;
    }

    detail.conversationEvents = clampEvents(
      [...detail.conversationEvents, normalizedEvent],
      MAX_CONVERSATION_EVENTS,
    );
  }

  private pushProgress(
    detail: SubagentDetail,
    event: SubagentProgressEvent,
  ): void {
    const title = sanitizeActivityLabel(event.title);
    if (!title) {
      return;
    }
    const normalizedEvent: SubagentProgressEvent = {
      ...event,
      title,
      meta: sanitizeActivityLabel(event.meta || "") || undefined,
    };
    if (normalizedEvent.callID) {
      const existingIndex = detail.progressEvents.findIndex(
        (entry) => entry.callID === normalizedEvent.callID,
      );
      if (existingIndex >= 0) {
        const existing = detail.progressEvents[existingIndex];
        detail.progressEvents[existingIndex] = {
          ...existing,
          ...normalizedEvent,
          id: existing.id || normalizedEvent.id,
          createdAt: Math.max(existing.createdAt, normalizedEvent.createdAt),
          status:
            normalizedEvent.status === "error"
              ? "error"
              : normalizedEvent.status === "done" || existing.status === "done"
                ? "done"
                : "pending",
          title: normalizedEvent.title || existing.title,
          meta: normalizedEvent.meta || existing.meta,
          filePath: normalizedEvent.filePath || existing.filePath,
        };
        return;
      }
    }
    const previous = detail.progressEvents[detail.progressEvents.length - 1];
    if (
      previous &&
      previous.title === normalizedEvent.title &&
      previous.status === normalizedEvent.status &&
      previous.filePath === normalizedEvent.filePath &&
      previous.meta === normalizedEvent.meta
    ) {
      return;
    }
    detail.progressEvents = clampEvents(
      [...detail.progressEvents, normalizedEvent],
      MAX_PROGRESS_EVENTS,
    );
  }

  private recomputeDuration(detail: SubagentDetail): void {
    if (typeof detail.startedAt !== "number") {
      return;
    }
    if (typeof detail.endedAt === "number") {
      detail.durationMs = Math.max(0, detail.endedAt - detail.startedAt);
      return;
    }
    if (
      detail.status === "running" ||
      detail.status === "pending" ||
      detail.status === "orphaned"
    ) {
      detail.durationMs = Math.max(0, Date.now() - detail.startedAt);
    }
  }

  private handleMessagePartUpdated(
    properties: UnknownRecord,
    changedParents: Set<string>,
    changedDetails: Set<string>,
  ): void {
    const part = asRecord(properties.part);
    if (!part) {
      return;
    }
    const partType = asString(part.type).toLowerCase();
    const sessionId =
      asString(part.sessionID) ||
      asString(part.sessionId) ||
      asString(properties.sessionID) ||
      asString(properties.sessionId);
    const messageId =
      asString(part.messageID) ||
      asString(part.messageId) ||
      asString(properties.messageID) ||
      asString(properties.messageId);
    const partId = asString(part.id) || "part";
    const createdAt = Date.now();

    if (!sessionId || !messageId) {
      return;
    }

    if (
      this.activeSessionId &&
      sessionId !== this.activeSessionId &&
      !this.childSessionToSubagentId.has(sessionId)
    ) {
      return;
    }

    if (
      (partType === "subtask" || partType === "agent") &&
      sessionId === this.activeSessionId
    ) {
      const detailId = this.makeSubtaskSubagentId(sessionId, messageId, partId);
      const existing = this.detailsById.get(detailId);
      const detail: SubagentDetail = existing || {
        id: detailId,
        parentSessionId: sessionId,
        parentMessageId: messageId,
        status: "pending",
        latestActivity:
          partType === "agent" ? "Background agent requested" : "Subagent requested",
        references: [],
        thinkingEvents: [],
        conversationEvents: [],
        progressEvents: [],
        timelineEvents: [],
      };

      detail.agentId =
        asString(part.agent) ||
        asString(part.name) ||
        asString(part.agentId) ||
        asString(part.id) ||
        detail.agentId;
      detail.latestActivity =
        asString(part.description) ||
        asString(part.name) ||
        asString(part.title) ||
        asString(part.meta) ||
        asString(part.prompt) ||
        detail.latestActivity ||
        (partType === "agent" ? "Background agent requested" : "Subagent requested");
      detail.startedAt = detail.startedAt ?? createdAt;
      detail.status = detail.childSessionId ? "running" : "pending";

      this.addReference(detail, {
        messageID: messageId,
        partID: partId,
      });
      this.pushTimeline(detail, {
        key: this.makeTimelineKey(partType, messageId, partId, createdAt),
        type: partType,
        label: detail.latestActivity,
        createdAt,
        messageID: messageId,
        partID: partId,
      });

      const pending =
        this.pendingSubtasksByParentSessionId.get(sessionId) || [];
      if (!detail.childSessionId && !pending.includes(detailId)) {
        pending.push(detailId);
        this.pendingSubtasksByParentSessionId.set(sessionId, pending);
      }
      this.latestParentMessageBySessionId.set(sessionId, messageId);
      this.upsertDetail(detail);

      changedParents.add(messageId);
      changedDetails.add(detailId);
      return;
    }

    const detail = this.resolveDetailForPartEvent(sessionId, messageId);
    if (!detail) {
      return;
    }

    const delta = asString(properties.delta) || asString(part.delta);
    const messageText =
      asString(part.text) ||
      asString(part.content) ||
      (isReasoningPart(part) ? "" : delta);
    const thinkingText = sanitizeReasoningText(
      asString(part.reasoning) ||
        asString(part.thought) ||
        asString(part.thinking) ||
        (isReasoningPart(part) ? delta : ""),
    );
    const role =
      asString(part.role) ||
      asString(properties.role) ||
      asString(part.author) ||
      "assistant";
    const isAssistantRole =
      !role || role.toLowerCase() === "assistant" || role.toLowerCase() === "model";

    if (thinkingText) {
      this.pushThinking(detail, {
        id: `${detail.id}:thought:${createdAt}:${detail.thinkingEvents.length}`,
        text: thinkingText.trim(),
        createdAt,
        messageID: messageId,
        partID: partId,
      });
      if (isAssistantRole) {
        this.pushConversation(detail, {
          role: "assistant",
          kind: "reasoning",
          text: thinkingText.trim(),
          createdAt,
          messageID: messageId,
          partID: partId,
        });
      }
      detail.latestActivity = thinkingText.trim().slice(0, 120);
    }

    const progress = this.extractProgressFromPart(part, properties, createdAt);
    if (progress) {
      this.pushProgress(detail, {
        ...progress,
        messageID: messageId,
        partID: partId,
      });
      if (isAssistantRole) {
        const progressText = [progress.title, progress.meta]
          .filter((value): value is string => Boolean(value))
          .join(" - ");
        this.pushConversation(detail, {
          role: "assistant",
          kind: "step",
          text: progressText,
          createdAt,
          messageID: messageId,
          partID: partId,
        });
      }
      detail.latestActivity = progress.title;
    }
    if (isAssistantRole && messageText.trim()) {
      this.pushConversation(detail, {
        role: "assistant",
        kind: "message",
        text: messageText,
        createdAt,
        messageID: messageId,
        partID: partId,
      });
    }

    const eventLabel = sanitizeActivityLabel(
      progress?.title || thinkingText.trim() || `${partType || "part"} updated`,
    );
    if (eventLabel && !(partType === "text" && !progress && !thinkingText.trim())) {
      this.pushTimeline(detail, {
        key: this.makeTimelineKey(
          partType || "part",
          messageId,
          partId,
          createdAt,
        ),
        type: partType || "part",
        label: eventLabel,
        createdAt,
        messageID: messageId,
        partID: partId,
        callID: asString(part.callID) || undefined,
      });
    }
    this.addReference(detail, {
      messageID: messageId,
      partID: partId,
      callID: asString(part.callID) || undefined,
    });

    if (detail.status === "pending" || detail.status === "orphaned") {
      detail.status = "running";
    }

    this.upsertDetail(detail);
    changedParents.add(detail.parentMessageId);
    changedDetails.add(detail.id);
  }

  private handleMessageUpdated(
    properties: UnknownRecord,
    changedParents: Set<string>,
    changedDetails: Set<string>,
  ): void {
    const info = asRecord(properties.info);
    if (!info) {
      return;
    }
    const sessionId = asString(info.sessionID) || asString(info.sessionId);
    const messageId =
      asString(info.id) || asString(info.messageID) || asString(info.messageId);
    if (!sessionId) {
      return;
    }

    const detailId = this.childSessionToSubagentId.get(sessionId);
    if (!detailId) {
      return;
    }
    const detail = this.detailsById.get(detailId);
    if (!detail) {
      return;
    }

    const createdAt = Date.now();
    const role = asString(info.role).toLowerCase();
    const messageText =
      asString(info.content) || asString(info.text) || asString(properties.content);
    if ((role === "" || role === "assistant" || role === "model") && messageText.trim()) {
      this.pushConversation(detail, {
        role: "assistant",
        kind: "message",
        text: messageText,
        createdAt,
        messageID: messageId || undefined,
      });
    }

    detail.providerID = asString(info.providerID) || detail.providerID;
    detail.modelID = asString(info.modelID) || detail.modelID;

    const tokens = asRecord(info.tokens);
    if (tokens) {
      const cache = asRecord(tokens.cache);
      detail.tokenUsage = {
        input: asNumber(tokens.input),
        output: asNumber(tokens.output),
        reasoning: asNumber(tokens.reasoning),
        cache: cache
          ? {
              read: asNumber(cache.read),
              write: asNumber(cache.write),
            }
          : undefined,
      };
    }

    const time = asRecord(info.time);
    detail.startedAt = detail.startedAt ?? asNumber(time?.created);
    const completed = asNumber(time?.completed);

    const hasFinishFlag =
      typeof info.finish === "string"
        ? Boolean(asString(info.finish))
        : asBoolean(info.finish);
    if (hasFinishFlag || typeof completed === "number") {
      detail.endedAt = completed ?? createdAt;
      if (detail.status !== "error") {
        detail.status = "done";
      }
      detail.latestActivity = "Completed";
      this.ensureAllProgressDone(detail);
    } else if (detail.status === "pending" || detail.status === "orphaned") {
      detail.status = "running";
      detail.latestActivity = "Running";
    }

    const errorText = extractErrorText(info.error);
    if (errorText) {
      detail.status = "error";
      detail.errorText = errorText;
      detail.latestActivity = errorText;
      detail.endedAt = detail.endedAt ?? createdAt;
    }

    this.recomputeDuration(detail);

    const label = detail.latestActivity || "Message updated";
    this.pushTimeline(detail, {
      key: this.makeTimelineKey(
        "message.updated",
        messageId,
        undefined,
        createdAt,
      ),
      type: "message.updated",
      label,
      createdAt,
      messageID: messageId || undefined,
    });
    this.addReference(detail, {
      messageID: messageId || undefined,
    });

    this.upsertDetail(detail);
    changedParents.add(detail.parentMessageId);
    changedDetails.add(detail.id);
  }

  private handleSessionCreated(
    properties: UnknownRecord,
    changedParents: Set<string>,
    changedDetails: Set<string>,
  ): void {
    const info = asRecord(properties.info);
    if (!info) {
      return;
    }

    const parentSessionId = asString(info.parentID) || asString(info.parentId);
    const childSessionId = asString(info.id);
    if (!parentSessionId || !childSessionId) {
      return;
    }

    // Log session creation with all available info
    console.log('===SUBAGENT_SPAWN=== [SESSION_CREATED] Full info object', {
      parentSessionId,
      childSessionId,
      activeSessionId: this.activeSessionId,
      allInfoKeys: info ? Object.keys(info) : [],
      allPropertiesKeys: properties ? Object.keys(properties) : [],
      infoSubset: {
        providerID: info?.providerID,
        modelID: info?.modelID,
        agentId: info?.agentId,
        model: info?.model,
        provider: info?.provider,
        parentID: info?.parentID,
        id: info?.id,
      },
      propertiesSubset: {
        providerID: properties?.providerID,
        modelID: properties?.modelID,
        agentId: properties?.agentId,
        model: properties?.model,
        provider: properties?.provider,
      },
    });

    if (this.activeSessionId && parentSessionId !== this.activeSessionId) {
      return;
    }

    const createdAt = Date.now();
    const pending =
      this.pendingSubtasksByParentSessionId.get(parentSessionId) || [];
    let detailId: string | undefined;
    while (pending.length > 0) {
      const candidate = pending.shift();
      if (!candidate) {
        continue;
      }
      const existing = this.detailsById.get(candidate);
      if (!existing || existing.childSessionId) {
        continue;
      }
      detailId = candidate;
      break;
    }
    this.pendingSubtasksByParentSessionId.set(parentSessionId, pending);

    if (!detailId) {
      const parentMessageId =
        this.latestParentMessageBySessionId.get(parentSessionId) ||
        `orphan-${childSessionId}`;
      detailId = `orphan:${parentSessionId}:${childSessionId}`;

      // Get provider/model from info object or fall back to selected model
      const selectedModel = this.getSelectedModel();
      const providerID = asString(info.providerID) || selectedModel?.providerID || undefined;
      const modelID = asString(info.modelID) || selectedModel?.modelID || undefined;

      console.log('===SUBAGENT_SPAWN=== [TRACKER] Creating orphan subagent', {
        detailId,
        parentSessionId,
        parentMessageId,
        childSessionId,
        providerID,
        modelID,
        agentId: asString(info.agentId),
        selectedModel,
        infoHasProviderID: Boolean(info.providerID),
        infoHasModelID: Boolean(info.modelID),
      });

      const orphanDetail: SubagentDetail = {
        id: detailId,
        parentSessionId,
        parentMessageId,
        childSessionId,
        status: "orphaned",
        latestActivity: "Child session created",
        startedAt: asNumber(asRecord(info.time)?.created) ?? createdAt,
        providerID,
        modelID,
        references: [],
        thinkingEvents: [],
        conversationEvents: [],
        progressEvents: [],
        timelineEvents: [],
      };
      this.pushTimeline(orphanDetail, {
        key: this.makeTimelineKey(
          "session.created",
          undefined,
          undefined,
          createdAt,
        ),
        type: "session.created",
        label: "Child session created",
        createdAt,
      });
      this.upsertDetail(orphanDetail);
      changedParents.add(orphanDetail.parentMessageId);
      changedDetails.add(orphanDetail.id);
      return;
    }

    const detail = this.detailsById.get(detailId);
    if (!detail) {
      return;
    }

    // Get provider/model from info object or fall back to selected model
    const selectedModel = this.getSelectedModel();
    const providerID = detail.providerID || asString(info.providerID) || selectedModel?.providerID || undefined;
    const modelID = detail.modelID || asString(info.modelID) || selectedModel?.modelID || undefined;

    console.log('===SUBAGENT_SPAWN=== [TRACKER] Updating existing subagent', {
      detailId,
      childSessionId,
      existingProviderID: detail.providerID,
      existingModelID: detail.modelID,
      infoProviderID: asString(info.providerID),
      infoModelID: asString(info.modelID),
      selectedModel,
      finalProviderID: providerID,
      finalModelID: modelID,
    });

    detail.childSessionId = childSessionId;
    detail.status = "running";
    detail.startedAt =
      detail.startedAt ?? asNumber(asRecord(info.time)?.created) ?? createdAt;
    detail.latestActivity = "Child session started";
    // Extract provider/model fields from info or existing detail or selected model
    detail.providerID = providerID;
    detail.modelID = modelID;

    console.log('===SUBAGENT_SPAWN=== [TRACKER] After update', {
      detailId,
      finalProviderID: detail.providerID,
      finalModelID: detail.modelID,
    });
    this.pushTimeline(detail, {
      key: this.makeTimelineKey(
        "session.created",
        undefined,
        undefined,
        createdAt,
      ),
      type: "session.created",
      label: "Child session started",
      createdAt,
    });
    this.upsertDetail(detail);
    changedParents.add(detail.parentMessageId);
    changedDetails.add(detail.id);
  }

  private handleSessionError(
    properties: UnknownRecord,
    changedParents: Set<string>,
    changedDetails: Set<string>,
  ): void {
    const sessionId =
      asString(properties.sessionID) || asString(properties.sessionId);
    if (!sessionId) {
      return;
    }
    const detailId = this.childSessionToSubagentId.get(sessionId);
    if (!detailId) {
      return;
    }
    const detail = this.detailsById.get(detailId);
    if (!detail) {
      return;
    }

    const createdAt = Date.now();
    const errorObj = asRecord(properties.error);

    // Enhanced error extraction to get the actual message instead of error name
    let errorText = "Session error";
    if (errorObj) {
      // Try to get the actual error message from different possible locations
      const directMessage = asString(errorObj.message).trim();
      const dataObj = asRecord(errorObj.data);
      const dataMessage = dataObj ? asString(dataObj.message).trim() : "";
      const innerErrorObj = asRecord(errorObj.error);
      const innerMessage = innerErrorObj ? asString(innerErrorObj.message).trim() : "";

      // Check even more nested fields that might contain the actual error
      const causeObj = asRecord(errorObj.cause);
      const causeMessage = causeObj ? asString(causeObj.message).trim() : "";

      const responseObj = asRecord(errorObj.response);
      const responseObjData = responseObj ? asRecord(responseObj.data) : null;
      const responseMessage = responseObjData ? asString(responseObjData.message).trim() : "";

      const bodyObj = asRecord(errorObj.body);
      const bodyMessage = bodyObj ? asString(bodyObj.message).trim() : "";

      // Check if there are details or description fields
      const detailsMessage = asString(errorObj.details).trim();
      const descriptionMessage = asString(errorObj.description).trim();

      // Log all possible error message locations
      const errorContext = {
        hasDirectMessage: !!directMessage,
        hasDataMessage: !!dataMessage,
        hasInnerMessage: !!innerMessage,
        hasCauseMessage: !!causeMessage,
        hasResponseMessage: !!responseMessage,
        hasBodyMessage: !!bodyMessage,
        hasDetailsMessage: !!detailsMessage,
        hasDescriptionMessage: !!descriptionMessage,
        directMessage: directMessage.slice(0, 200),
        dataMessage: dataMessage.slice(0, 200),
        innerMessage: innerMessage.slice(0, 200),
        causeMessage: causeMessage.slice(0, 200),
        responseMessage: responseMessage.slice(0, 200),
        bodyMessage: bodyMessage.slice(0, 200),
        detailsMessage: detailsMessage.slice(0, 200),
        descriptionMessage: descriptionMessage.slice(0, 200),
        errorName: asString(errorObj.name),
        errorCode: asString(errorObj.code),
      };

      // Log the full error extraction context
      console.log('===SUBAGENT_SPAWN=== [ERROR_EXTRACTION] Error extraction context', {
        sessionId,
        detailId,
        errorContext,
        errorKeys: Object.keys(errorObj),
        rawDataKeys: dataObj ? Object.keys(dataObj) : [],
      });

      // Prioritize actual error messages over error names, with expanded fallback chain
      errorText = directMessage ||
                  dataMessage ||
                  responseMessage ||
                  innerMessage ||
                  causeMessage ||
                  bodyMessage ||
                  detailsMessage ||
                  descriptionMessage ||
                  extractErrorText(errorObj) ||
                  "Session error";
    }

    console.log('===SUBAGENT_SPAWN=== [ERROR] Session error received', {
      sessionId,
      detailId,
      errorText,
      detailProviderID: detail.providerID,
      detailModelID: detail.modelID,
      hasError: Boolean(properties.error),
      errorKeys: properties.error ? Object.keys(properties.error) : [],
      rawError: properties.error ? JSON.stringify(properties.error).slice(0, 500) : undefined,
    });

    // If we still have a generic error, try to construct a more informative one
    if (errorText === "Session error" || errorText.toLowerCase().includes("error")) {
      const errorName = asString(errorObj?.name);
      const modelID = detail.modelID || detail.providerID;
      if (errorName && modelID) {
        // Check if this is a model-related error
        if (errorName.toLowerCase().includes("model") || errorName.toLowerCase().includes("provider")) {
          errorText = `Error with model '${modelID}': ${errorName}`;
        }
      }
    }

    detail.status = "error";
    detail.errorText = errorText;
    detail.latestActivity = errorText;
    detail.endedAt = detail.endedAt ?? createdAt;
    this.recomputeDuration(detail);
    this.pushTimeline(detail, {
      key: this.makeTimelineKey(
        "session.error",
        undefined,
        undefined,
        createdAt,
      ),
      type: "session.error",
      label: errorText,
      createdAt,
    });
    this.upsertDetail(detail);

    changedParents.add(detail.parentMessageId);
    changedDetails.add(detail.id);
  }

  private resolveDetailForPartEvent(
    sessionId: string,
    messageId: string,
  ): SubagentDetail | null {
    const detailId = this.childSessionToSubagentId.get(sessionId);
    if (detailId) {
      return this.detailsById.get(detailId) || null;
    }

    const candidateIds = this.idsByParentMessageId.get(messageId) || [];
    for (const candidateId of candidateIds) {
      const detail = this.detailsById.get(candidateId);
      if (!detail) {
        continue;
      }
      if (
        detail.parentSessionId === sessionId ||
        detail.childSessionId === sessionId
      ) {
        return detail;
      }
    }
    return null;
  }

  private extractProgressFromPart(
    part: UnknownRecord,
    properties: UnknownRecord,
    createdAt: number,
  ): Omit<SubagentProgressEvent, "messageID" | "partID"> | null {
    const partType = asString(part.type).toLowerCase();
    const callID = asString(part.callID) || undefined;
    if (partType === "tool") {
      const tool = asString(part.tool) || "tool";
      const state = asRecord(part.state);
      const input = asRecord(state?.input);
      const filePath =
        asString(input?.file) ||
        asString(input?.path) ||
        asString(input?.filename) ||
        asString(part.filePath) ||
        undefined;

      const result = asRecord(state?.result);
      const diffStatsRec = asRecord(result?.diffStats || part.diffStats);
      const diffStats = diffStatsRec
        ? {
            added: asNumber(diffStatsRec.added) || 0,
            deleted: asNumber(diffStatsRec.deleted) || 0,
          }
        : undefined;

      return {
        id: `${asString(part.id) || "tool"}:${createdAt}`,
        title: `Tool: ${tool}`,
        status: normalizeProgressStatus(state?.status || part.status),
        meta: asString(part.meta) || undefined,
        filePath,
        diffStats,
        createdAt,
        callID,
      };
    }

    if (partType === "step-start") {
      return {
        id: `${asString(part.id) || "step-start"}:${createdAt}`,
        title: asString(part.snapshot) || "Step started",
        status: "pending",
        createdAt,
        callID,
      };
    }
    if (partType === "step-finish") {
      const diffStatsRec = asRecord(part.diffStats);
      const diffStats = diffStatsRec
        ? {
            added: asNumber(diffStatsRec.added) || 0,
            deleted: asNumber(diffStatsRec.deleted) || 0,
          }
        : undefined;

      return {
        id: `${asString(part.id) || "step-finish"}:${createdAt}`,
        title:
          asString(part.reason) || asString(part.snapshot) || "Step completed",
        status: "done",
        diffStats,
        createdAt,
        callID,
      };
    }
    if (partType === "patch") {
      const files = Array.isArray(part.files) ? part.files : [];
      const diffStatsRec = asRecord(part.diffStats);
      const diffStats = diffStatsRec
        ? {
            added: asNumber(diffStatsRec.added) || 0,
            deleted: asNumber(diffStatsRec.deleted) || 0,
          }
        : undefined;

      return {
        id: `${asString(part.id) || "patch"}:${createdAt}`,
        title:
          files.length > 0
            ? `Patched ${files.length} file${files.length === 1 ? "" : "s"}`
            : "Patch applied",
        status: "done",
        diffStats,
        createdAt,
        callID,
      };
    }
    if (partType === "subtask") {
      return {
        id: `${asString(part.id) || "subtask"}:${createdAt}`,
        title: asString(part.description) || "Subtask requested",
        status: "pending",
        createdAt,
        callID,
      };
    }
    if (partType === "agent") {
      const name = asString(part.name);
      return {
        id: `${asString(part.id) || "agent"}:${createdAt}`,
        title: name ? `Agent selected: ${name}` : "Agent selected",
        status: "pending",
        createdAt,
        callID,
      };
    }

    const delta = asString(properties.delta);
    if (partType && delta) {
      const deltaLabel = sanitizeActivityLabel(delta);
      if (!deltaLabel) {
        return null;
      }
      return {
        id: `${asString(part.id) || partType}:${createdAt}`,
        title: `${partType}: ${deltaLabel}`,
        status: "pending",
        createdAt,
        callID,
      };
    }
    return null;
  }

  private bindChildSessionToKnownSubtask(
    parentSessionId: string,
    childSessionId: string,
  ): string | undefined {
    if (this.childSessionToSubagentId.has(childSessionId)) {
      return this.childSessionToSubagentId.get(childSessionId);
    }
    const pending =
      this.pendingSubtasksByParentSessionId.get(parentSessionId) || [];
    while (pending.length > 0) {
      const candidate = pending.shift();
      if (!candidate) {
        continue;
      }
      const detail = this.detailsById.get(candidate);
      if (!detail || detail.childSessionId) {
        continue;
      }
      detail.childSessionId = childSessionId;
      detail.status = "running";
      this.childSessionToSubagentId.set(childSessionId, candidate);
      this.childSessionToParentSessionId.set(childSessionId, parentSessionId);
      this.pendingSubtasksByParentSessionId.set(parentSessionId, pending);
      return candidate;
    }
    this.pendingSubtasksByParentSessionId.set(parentSessionId, pending);
    return undefined;
  }

  private async hydrateChildSessionMessages(
    client: FinalizeParentMessageOptions["client"],
    detail: SubagentDetail,
  ): Promise<void> {
    const childSessionId = detail.childSessionId;
    if (!childSessionId) {
      return;
    }
    const messagesFn = client.session?.messages;
    if (!messagesFn) {
      detail.hydrationUnavailable = true;
      return;
    }

    try {
      const response = await messagesFn.call(client.session, {
        sessionID: childSessionId,
      });
      if (response.error || !Array.isArray(response.data)) {
        detail.hydrationUnavailable = true;
        return;
      }

      const assistantInfos = response.data
        .map((msg) => asRecord(asRecord(msg)?.info))
        .filter((info): info is UnknownRecord => !!info)
        .filter((info) => asString(info.role) === "assistant");

      if (assistantInfos.length === 0) {
        return;
      }

      const conversationEvents =
        this.buildConversationEventsFromChildSessionMessages(response.data);
      if (conversationEvents.length > 0) {
        detail.conversationEvents = conversationEvents;
      }

      const latest = assistantInfos[assistantInfos.length - 1];
      detail.providerID = asString(latest.providerID) || detail.providerID;
      detail.modelID = asString(latest.modelID) || detail.modelID;
      const time = asRecord(latest.time);
      detail.startedAt = detail.startedAt ?? asNumber(time?.created);
      detail.endedAt = detail.endedAt ?? asNumber(time?.completed);
      const latestTokens = asRecord(latest.tokens);
      const latestCache = asRecord(latestTokens?.cache);
      detail.tokenUsage = latestTokens
        ? {
            input: asNumber(latestTokens.input),
            output: asNumber(latestTokens.output),
            reasoning: asNumber(latestTokens.reasoning),
            cache: latestCache
              ? {
                  read: asNumber(latestCache.read),
                  write: asNumber(latestCache.write),
                }
              : undefined,
          }
        : detail.tokenUsage;

      const hasFinishFlag =
        typeof latest.finish === "string"
          ? Boolean(asString(latest.finish))
          : asBoolean(latest.finish);
      if (hasFinishFlag || typeof detail.endedAt === "number") {
        if (detail.status !== "error") {
          detail.status = "done";
        }
        detail.latestActivity =
          detail.status === "done" ? "Completed" : detail.latestActivity;
        this.ensureAllProgressDone(detail);
      }
      this.recomputeDuration(detail);
    } catch {
      detail.hydrationUnavailable = true;
    }
  }

  private ensureAllProgressDone(detail: SubagentDetail): void {
    if (!detail.progressEvents) {
      return;
    }
    for (const event of detail.progressEvents) {
      if (event.status === "pending") {
        event.status = "done";
      }
    }
  }

  private buildConversationEventsFromChildSessionMessages(
    messagesRaw: unknown[],
  ): SubagentConversationEvent[] {
    const events: SubagentConversationEvent[] = [];

    const append = (
      role: string,
      kind: SubagentConversationEvent["kind"],
      textRaw: string,
      createdAt: number,
      messageID?: string,
      partID?: string,
    ) => {
      const text = sanitizeReasoningText(textRaw);
      if (!text) {
        return;
      }
      const previous = events[events.length - 1];
      if (
        previous &&
        previous.role === role &&
        previous.kind === kind &&
        previous.text === text
      ) {
        previous.createdAt = Math.max(previous.createdAt, createdAt);
        previous.messageID = previous.messageID || messageID;
        previous.partID = previous.partID || partID;
        return;
      }
      events.push({
        id: `${messageID || "msg"}:${kind}:${events.length}`,
        role: role || "assistant",
        kind,
        text,
        createdAt,
        messageID,
        partID,
      });
    };

    for (const rawMessage of messagesRaw) {
      const message = asRecord(rawMessage);
      if (!message) {
        continue;
      }
      const info = asRecord(message.info);
      const role = asString(info?.role) || asString(message.role) || "assistant";
      const messageID =
        asString(info?.id) || asString(message.id) || asString(message.messageID) || undefined;
      const infoTime = asRecord(info?.time);
      const msgTime = asRecord(message.time);
      const createdAt = toTimestamp(
        asNumber(infoTime?.created) ??
          asNumber(infoTime?.updated) ??
          asNumber(msgTime?.created) ??
          asNumber(msgTime?.updated) ??
          asNumber(message.createdAt),
      );

      const content = this.extractPrimaryMessageText(message);
      if (content) {
        append(role, "message", content, createdAt, messageID);
      }

      const reasoningEvents = Array.isArray(message.reasoningEvents)
        ? message.reasoningEvents
        : [];
      for (let index = 0; index < reasoningEvents.length; index += 1) {
        const rawEvent = asRecord(reasoningEvents[index]);
        if (!rawEvent) {
          continue;
        }
        const text = asString(rawEvent.text);
        if (!text) {
          continue;
        }
        append(
          role,
          "reasoning",
          text,
          toTimestamp(asNumber(rawEvent.createdAt), createdAt),
          messageID,
          asString(rawEvent.partID) || undefined,
        );
      }

      const parts = Array.isArray(message.parts) ? message.parts : [];
      for (const rawPart of parts) {
        const part = asRecord(rawPart);
        if (!part || !isReasoningPart(part)) {
          continue;
        }
        const partText =
          asString(part.text) ||
          asString(part.reasoning) ||
          asString(part.thinking) ||
          asString(part.thought) ||
          "";
        append(
          role,
          "reasoning",
          partText,
          toTimestamp(asNumber(part.createdAt), createdAt),
          messageID,
          asString(part.id) || asString(part.partID) || undefined,
        );
      }

      const steps = Array.isArray(message.steps) ? message.steps : [];
      for (const rawStep of steps) {
        const step = asRecord(rawStep);
        if (!step) {
          continue;
        }
        const title = sanitizeActivityLabel(asString(step.title));
        const meta = sanitizeActivityLabel(asString(step.meta));
        const status = sanitizeActivityLabel(asString(step.status));
        const text = [title, meta, status].filter(Boolean).join(" - ");
        if (!text) {
          continue;
        }
        append(
          role,
          "step",
          text,
          toTimestamp(asNumber(step.createdAt), createdAt),
          messageID,
          asString(step.partID) || undefined,
        );
      }
    }

    return clampEvents(events, MAX_CONVERSATION_EVENTS);
  }

  private extractPrimaryMessageText(message: UnknownRecord): string {
    const content = asString(message.content).trim();
    if (content) {
      return content;
    }

    const text = asString(message.text).trim();
    if (text) {
      return text;
    }

    const parts = Array.isArray(message.parts) ? message.parts : [];
    const chunks: string[] = [];
    for (const rawPart of parts) {
      const part = asRecord(rawPart);
      if (!part || isReasoningPart(part)) {
        continue;
      }
      const chunk = asString(part.text) || asString(part.content) || "";
      if (chunk.trim()) {
        chunks.push(chunk.trim());
      }
    }
    return chunks.join("\n").trim();
  }
}
