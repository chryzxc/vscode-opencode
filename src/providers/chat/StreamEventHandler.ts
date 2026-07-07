/**
 * StreamEventHandler Module
 *
 * The entire streamService.subscribe(...) callback body — token tracking,
 * subagent updates, todo persistence, event enrichment, and stream forwarding.
 *
 * Extracted from ChatViewProvider.ts (~350 lines)
 */

import type { StructuredOutputProcessor } from "./StructuredOutputProcessor";
import type { SubagentPersistence } from "./SubagentPersistence";
import type { CompactionManager } from "./CompactionManager";
import type { DiagnosticsLogger } from "./DiagnosticsLogger";
import type { GeminiTokenUsageTracker } from "../../services/GeminiTokenUsageTracker";
import type { SessionService } from "../../services/SessionService";
import type { SubagentTracker } from "../../services/SubagentTracker";
import { LoggingCategories } from "../../utils/LoggingSchema";

export class StreamEventHandler {
  private awaitingInteractiveAnswer = false;
  private streamStartTime?: number;
  private eventCount = 0;
  private lastEventTime?: number;

  constructor(
    private structuredOutputProcessor: StructuredOutputProcessor,
    private subagentPersistence: SubagentPersistence,
    private compactionManager: CompactionManager,
    private diagnosticsLogger: DiagnosticsLogger,
    private geminiTokenTracker: GeminiTokenUsageTracker,
    private sessionService: SessionService,
    private subagentTracker: SubagentTracker,
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

    const eventType = typeof event?.type === "string"
      ? event.type
      : typeof event?.event === "string"
        ? event.event
        : typeof event?.kind === "string"
          ? event.kind
          : "unknown";

    // Only log important events, not every text chunk
    const shouldLog = !eventType.includes("message.part") ||
                       eventType === "message.completed" ||
                       eventType === "session.completed" ||
                       eventType === "session.created";

    const enrichedEvent = this.structuredOutputProcessor.enrichStreamEvent(event);

    this.diagnosticsLogger.logStreamEventDiagnostics(event, enrichedEvent);

    const properties = enrichedEvent?.properties || event?.properties || {};
    const info = properties?.info || {};
    const sessionId =
      enrichedEvent?.sessionId ||
      event?.sessionId ||
      properties?.sessionId ||
      info?.sessionId ||
      this.getCurrentSessionId();

    if (shouldLog) {
      this.logger.debug("[SOURCE] stream event received", {
        sessionId: this.getCurrentSessionId(),
        eventType,
        eventKeys: event && typeof event === "object" ? Object.keys(event) : [],
      });

      if (shouldLog) {
        this.logger.debug("Received stream event", {
          type: eventType,
          eventType,
        });

        // Log detailed info for session.created events to check for provider/model data
        if (eventType === "session.created") {
          this.logger.debug('===SUBAGENT_SPAWN=== [SESSION_CREATED] Stream event received', {
            hasInfo: Boolean(info && typeof info === 'object'),
            infoKeys: info ? Object.keys(info) : [],
            hasProviderID: Boolean(info?.providerID),
            hasModelID: Boolean(info?.modelID),
            providerID: info?.providerID,
            modelID: info?.modelID,
            agentId: info?.agentId,
            sessionId: sessionId,
          });
        }
      }
    }

    // Handle compaction status
    if (event?.type === "message.completed" && properties?.compaction) {
      this.compactionManager.forwardCompactionStatusFromStreamEvent(properties.compaction);
    }

    // Handle subagent updates
    if (properties?.subagentsDelta || enrichedEvent?.structured?.subagentsDelta) {
      const subagentUpdate = properties?.subagentsDelta || enrichedEvent?.structured?.subagentsDelta;

      // Log the raw subagent data from the stream
      this.logger.debug('[SUBAGENT][STREAM] Raw subagent data received', {
        hasSummaries: Boolean(subagentUpdate?.summariesByParentMessageId || subagentUpdate?.subagentsByParentMessageId),
        hasDetails: Boolean(subagentUpdate?.detailsById || subagentUpdate?.subagentDetailsById),
      });

      // Log provider/model field presence in stream data
      if (subagentUpdate?.detailsById || subagentUpdate?.subagentDetailsById) {
        const detailsById = subagentUpdate.detailsById || subagentUpdate.subagentDetailsById;
        const detailIds = Object.keys(detailsById);
        this.logger.debug('===SUBAGENT_SPAWN=== [STREAM] Subagent update received', {
          detailCount: detailIds.length,
          detailIds: detailIds,
        });
        for (const detailId of detailIds.slice(0, 3)) {
          const detail = detailsById[detailId];
          this.logger.debug('===SUBAGENT_SPAWN=== [STREAM] Detail data', {
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

      await this.subagentPersistence.persistSubagentUpdateSnapshot(
        subagentUpdate,
        this.getCurrentSessionId(),
        // sessionService and postMessage will be provided by shell
        {} as any,
        this.postMessage,
      );
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

    this.postMessage({
      type: "streamEvent",
      event: enrichedEvent || event,
      sessionId,
    });

    if (sessionId) {
      void this.sessionService.appendRawSdkEventPayload(
        sessionId,
        rawEvent ? { ...(rawEvent as Record<string, unknown>), sessionId } : { ...event, sessionId },
      );
    }
  }

  /**
   * Start stream with logging
   */
  startStream(sessionId: string, messageId: string): void {
    this.streamStartTime = Date.now();
    this.eventCount = 0;
    this.lastEventTime = Date.now();

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
    this.lastEventTime = undefined;
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
