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
  async handleStreamEvent(event: any): Promise<void> {
    if (!event) return;

    this.logger.info("[SOURCE] stream event received", {
      sessionId: this.getCurrentSessionId(),
      eventType:
        typeof event?.type === "string"
          ? event.type
          : typeof event?.event === "string"
            ? event.event
            : typeof event?.kind === "string"
              ? event.kind
              : "unknown",
      eventKeys: event && typeof event === "object" ? Object.keys(event) : [],
    });
    // Removed full payload logging to reduce verbosity
    // Event type and metadata logged above via diagnostics

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

    // Handle compaction status
    if (event?.type === "message.completed" && properties?.compaction) {
      this.compactionManager.forwardCompactionStatusFromStreamEvent(properties.compaction);
    }

    // Handle subagent updates
    if (properties?.subagentsDelta || enrichedEvent?.structured?.subagentsDelta) {
      const subagentUpdate = properties?.subagentsDelta || enrichedEvent?.structured?.subagentsDelta;
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
    this.logger.info("[PRE-RENDER] stream event forwarded", {
      sessionId,
      eventType:
        typeof enrichedEvent?.type === "string"
          ? enrichedEvent.type
          : typeof event?.type === "string"
            ? event.type
            : "unknown",
      hasStructuredOutput: Boolean(enrichedEvent?.structuredOutput),
      hasProperties: Boolean(enrichedEvent?.properties),
    });
    // Removed full payload logging to reduce verbosity
    // Event summary logged above

    this.postMessage({
      type: "streamEvent",
      event: enrichedEvent || event,
      sessionId,
    });
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

    this.logger.info( 'AI stream started', {
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

    this.logger.info( 'AI stream ended', {
      sessionId,
      messageId,
      duration,
      eventCount: this.eventCount,
      success,
    });

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
    this.logger.info( 'Structured output processed', {
      sessionId,
      messageId,
      responseType: structured.responseType,
      hasProgressUpdates: structured.progressUpdates?.length > 0,
      hasInteractiveEvents: structured.interactiveEvents?.length > 0,
      hasPlan: !!structured.plan,
    });
  }
}
