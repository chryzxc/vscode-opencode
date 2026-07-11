/**
 * StreamEventHandler Module
 *
 * The entire streamService.subscribe(...) callback body — token tracking,
 * subagent updates, todo persistence, event enrichment, and stream forwarding.
 *
 * Extracted from ChatViewProvider.ts (~350 lines)
 */

import type { StructuredOutputProcessor } from "./StructuredOutputProcessor";
import type { CompactionManager } from "./CompactionManager";
import type { DiagnosticsLogger } from "./DiagnosticsLogger";
import type { GeminiTokenUsageTracker } from "../../services/GeminiTokenUsageTracker";
import type { SessionService } from "../../services/SessionService";

type PendingStreamEvent = {
  enrichedEvent: any;
  event: any;
  sessionId: string | undefined;
};

export class StreamEventHandler {
  private streamStartTime?: number;
  private eventCount = 0;
  private pendingEvents: PendingStreamEvent[] = [];
  private flushRafId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private structuredOutputProcessor: StructuredOutputProcessor,
    private compactionManager: CompactionManager,
    private diagnosticsLogger: DiagnosticsLogger,
    private geminiTokenTracker: GeminiTokenUsageTracker,
    private sessionService: SessionService,
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
  ) {
    this.postMessage = () => {};
    this.getCurrentSessionId = () => undefined;
  }

  private postMessage: (msg: any) => void;
  private getCurrentSessionId: () => string | undefined;

  setPostMessage(fn: (msg: any) => void): void {
    this.postMessage = fn;
  }

  setGetCurrentSessionId(fn: () => string | undefined): void {
    this.getCurrentSessionId = fn;
  }

  /**
   * Handle stream event
   */
  async handleStreamEvent(event: any, rawEvent?: unknown): Promise<void> {
    if (!event) return;

    const eventType = this.getEventType(event);
    const shouldLog = this.shouldLogEvent(eventType);
    const enrichedEvent = this.structuredOutputProcessor.enrichStreamEvent(event);
    const properties = this.getEventProperties(enrichedEvent, event);
    const info = properties?.info || {};
    const sessionId = this.resolveEventSessionId(enrichedEvent, event, properties, info);

    this.diagnosticsLogger.logStreamEventDiagnostics(event, enrichedEvent);
    this.eventCount += 1;

    if (shouldLog) {
      this.logStreamEventReceived(event, eventType, info, sessionId);
    }

    // Handle compaction status
    if (eventType === "message.completed" && properties?.compaction) {
      this.compactionManager.forwardCompactionStatusFromStreamEvent(properties.compaction);
    }

    // Handle subagent updates
    const subagentUpdate = this.getSubagentUpdate(properties, enrichedEvent);
    if (subagentUpdate) {
      this.logSubagentUpdate(subagentUpdate);
      const targetSessionId = sessionId ?? this.getCurrentSessionId();
      if (targetSessionId) {
        await this.sessionService.persistCentralizedSubagentProjection(
          targetSessionId,
          subagentUpdate,
        );
      }
    }

    // Track token usage
    if (properties?.usage) {
      const providerId = info?.providerID || info?.providerId || "unknown";
      const modelId = info?.modelID || info?.modelId || "unknown";
      const model = `${providerId}/${modelId}`;
      this.geminiTokenTracker.recordUsage(model, properties.usage);
    }

    // Forward to webview
    if (shouldLog) {
      this.logger.debug("[PRE-RENDER] stream event forwarded", {
        sessionId,
        eventType,
        hasStructuredOutput: Boolean(enrichedEvent?.structuredOutput),
        hasProperties: Boolean(enrichedEvent?.properties),
      });
    }

    // Buffer event for batched delivery. During active streaming this
    // coalesces high-frequency text chunks (30-60/sec) into ~1 postMessage
    // per animation frame, preventing the VS Code webview IPC boundary from
    // becoming a scroll-jank bottleneck.
    this.pendingEvents.push({ enrichedEvent, event, sessionId });

    if (this.isTerminalEvent(eventType)) {
      this.flushPendingEvents();
    } else if (this.flushRafId === null) {
      this.flushRafId = setTimeout(() => this.flushPendingEvents(), 16);
    }

    this.persistRawSdkEventPayload(sessionId, event, rawEvent);
  }

  private getEventType(event: any): string {
    if (typeof event?.type === "string") return event.type;
    if (typeof event?.event === "string") return event.event;
    if (typeof event?.kind === "string") return event.kind;
    return "unknown";
  }

  private shouldLogEvent(eventType: string): boolean {
    return (
      !eventType.includes("message.part") ||
      eventType === "message.completed" ||
      eventType === "session.completed" ||
      eventType === "session.created"
    );
  }

  private getEventProperties(enrichedEvent: any, event: any): Record<string, any> {
    return enrichedEvent?.properties || event?.properties || {};
  }

  private resolveEventSessionId(
    enrichedEvent: any,
    event: any,
    properties: Record<string, any>,
    info: Record<string, any>,
  ): string | undefined {
    return (
      enrichedEvent?.sessionId ||
      enrichedEvent?.sessionID ||
      event?.sessionId ||
      event?.sessionID ||
      properties?.sessionId ||
      properties?.sessionID ||
      info?.sessionId ||
      info?.sessionID ||
      this.getCurrentSessionId()
    );
  }

  private logStreamEventReceived(
    event: any,
    eventType: string,
    info: Record<string, any>,
    sessionId: string | undefined,
  ): void {
    this.logger.debug("[SOURCE] stream event received", {
      sessionId: this.getCurrentSessionId(),
      eventType,
      eventKeys: event && typeof event === "object" ? Object.keys(event) : [],
    });

    this.logger.debug("Received stream event", {
      type: eventType,
      eventType,
    });

    if (eventType !== "session.created") {
      return;
    }

    this.logger.debug("===SUBAGENT_SPAWN=== [SESSION_CREATED] Stream event received", {
      hasInfo: Boolean(info && typeof info === "object"),
      infoKeys: info ? Object.keys(info) : [],
      hasProviderID: Boolean(info?.providerID),
      hasModelID: Boolean(info?.modelID),
      providerID: info?.providerID,
      modelID: info?.modelID,
      agentId: info?.agentId,
      sessionId,
    });
  }

  private getSubagentUpdate(properties: Record<string, any>, enrichedEvent: any): any {
    return properties?.subagentsDelta || enrichedEvent?.structured?.subagentsDelta;
  }

  private logSubagentUpdate(subagentUpdate: any): void {
    this.logger.debug("[SUBAGENT][STREAM] Raw subagent data received", {
      hasSummaries: Boolean(subagentUpdate?.summariesByParentMessageId || subagentUpdate?.subagentsByParentMessageId),
      hasDetails: Boolean(subagentUpdate?.detailsById || subagentUpdate?.subagentDetailsById),
    });

    const detailsById = subagentUpdate?.detailsById || subagentUpdate?.subagentDetailsById;
    if (!detailsById) {
      return;
    }

    const detailIds = Object.keys(detailsById);
    this.logger.debug("===SUBAGENT_SPAWN=== [STREAM] Subagent update received", {
      detailCount: detailIds.length,
      detailIds,
    });

    for (const detailId of detailIds.slice(0, 3)) {
      const detail = detailsById[detailId];
      this.logger.debug("===SUBAGENT_SPAWN=== [STREAM] Detail data", {
        detailId,
        hasProviderID: Boolean(detail?.providerID),
        hasModelID: Boolean(detail?.modelID),
        providerID: detail?.providerID,
        modelID: detail?.modelID,
        status: detail?.status,
        agentId: detail?.agentId,
      });
    }
  }

  private isTerminalEvent(eventType: string): boolean {
    return (
      eventType === "message.completed" ||
      eventType === "session.completed" ||
      eventType === "message.error"
    );
  }

  private persistRawSdkEventPayload(
    sessionId: string | undefined,
    event: any,
    rawEvent?: unknown,
  ): void {
    if (!sessionId) {
      return;
    }

    const payload =
      rawEvent && typeof rawEvent === "object"
        ? { ...(rawEvent as Record<string, unknown>), sessionId }
        : { ...event, sessionId };
    void this.sessionService.appendRawSdkEventPayload(sessionId, payload);
  }

  private flushPendingEvents(): void {
    if (this.flushRafId !== null) {
      clearTimeout(this.flushRafId);
      this.flushRafId = null;
    }

    const batch = this.pendingEvents;
    if (batch.length === 0) return;
    this.pendingEvents = [];

    if (batch.length === 1) {
      const { enrichedEvent, event, sessionId } = batch[0];
      this.postMessage({
        type: "streamEvent",
        event: enrichedEvent || event,
        sessionId,
      });
    } else {
      this.postMessage({
        type: "streamEventBatch",
        events: batch.map(({ enrichedEvent, event, sessionId }) => ({
          event: enrichedEvent || event,
          sessionId,
        })),
      });
    }
  }

  /**
   * Start stream with logging
   */
  startStream(sessionId: string, messageId: string): void {
    this.streamStartTime = Date.now();
    this.eventCount = 0;
    this.pendingEvents = [];
    if (this.flushRafId !== null) {
      clearTimeout(this.flushRafId);
      this.flushRafId = null;
    }

    const correlationId = this.logger.startFeatureFlow('ai-stream', {
      sessionId,
      messageId,
    });

    this.logger.debug( 'AI stream started', {
      correlationId,
      sessionId,
      messageId,
    });
  }

  /**
   * End stream with logging
   */
  endStream(sessionId: string, messageId: string, success: boolean): void {
    this.flushPendingEvents();
    if (!this.streamStartTime) {
      this.logger.warn( 'Stream ended but never started', {
        sessionId,
        messageId,
      });
      return;
    }

    const duration = Date.now() - this.streamStartTime;
    const flow = this.logger.getActiveFeatureFlow();

    this.logger.performance('ai-stream', duration, {
      sessionId,
      messageId,
      eventCount: this.eventCount,
      success,
      eventsPerSecond: (this.eventCount / (duration / 1000)).toFixed(2),
    });

    if (flow) {
      this.logger.endFeatureFlow(flow.correlationId, {
        success,
        duration,
        eventCount: this.eventCount,
      });
    }

    this.logger.debug( 'AI stream ended', {
      sessionId,
      messageId,
      duration,
      eventCount: this.eventCount,
      success,
    });

    void this.sessionService.flushRawSdkEventPayloads(sessionId);

    // Reset state
    this.streamStartTime = undefined;
    this.eventCount = 0;
  }

  /**
   * Log structured output processing
   */
  logStructuredOutputProcessing(
    sessionId: string,
    messageId: string,
    structured: any,
  ): void {
    this.logger.debug( 'Structured output processed', {
      sessionId,
      messageId,
      responseType: structured.responseType,
      hasProgressUpdates: structured.progressUpdates?.length > 0,
      hasInteractiveEvents: structured.interactiveEvents?.length > 0,
      hasPlan: !!structured.plan,
    });
  }
}
