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

export class StreamEventHandler {
  private awaitingInteractiveAnswer = false;

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
      this.geminiTokenTracker.recordUsage(
        providerId,
        modelId,
        properties.usage,
      );
    }

    // Forward to webview
    this.postMessage({
      type: "streamEvent",
      event: enrichedEvent || event,
      sessionId,
    });
  }
}
