/**
 * Message Stream Service - Server-Sent Events (SSE) Streaming
 *
 * Manages real-time streaming of events from the OpenCode server using
 * a fetch-based Server-Sent Events implementation.
 *
 * **Architecture Overview:**
 * - Connects to `/event` endpoint on the OpenCode server
 * - Parses SSE protocol (text/event-stream format)
 * - Dispatches events to all subscribed callbacks
 * - Handles auto-reconnect on connection loss
 * - Manages subscriber lifecycle (start/stop based on subscriptions)
 *
 * **Why Fetch-Based SSE Instead of EventSource?**
 * The native browser `EventSource` API has limitations:
 * - No support for custom headers (needed for authentication)
 * - Limited control over request options
 * - No POST method support (some servers require it)
 *
 * **Our Implementation:**
 * - Uses `fetch()` API with AbortController for cancellation
 * - Manual SSE protocol parsing (handles "data:" lines)
 * - Buffer management for incomplete chunks
 * - TextDecoder for binary stream decoding
 *
 * **SSE Protocol Handling:**
 * Server sends events in this format:
 * ```
 * data: {"type":"message.part.updated","properties":{...}}
 * data: {"type":"message.updated","properties":{...}}
 * ```
 *
 * We parse the "data:" prefix and JSON-parse the content.
 *
 * **Buffer Management:**
 * Chunks may split in the middle of a line. We buffer incomplete
 * lines until the next chunk arrives.
 *
 * Example:
 * ```
 * Chunk 1: "data: {\"t"
 * Chunk 2: "ype\":\"msg\"}\n"
 * → Buffer: "data: {\"type\":\"msg\"}\n"
 * → Parse: {type: "msg"}
 * ```
 *
 * **Auto-Reconnect Strategy:**
 * - If connection fails: Wait 5 seconds, then retry
 * - Only reconnects if there are active subscribers
 * - Prevents reconnection loops when no one is listening
 *
 * **Subscriber Pattern:**
 * - Service starts listening when first subscriber joins
 * - Service stops listening when last subscriber leaves
 * - Efficient resource management (no unused connections)
 *
 * @module MessageStreamService
 * @see OpencodeServerManager for server connection management
 * @see ChatViewProvider for event consumption
 */

import { OpencodeServerManager } from './OpencodeServerManager';
import { createLogger } from '../utils/Logger';
import { LoggingCategories } from '../utils/LoggingSchema';
import * as vscode from "vscode";

/**
 * Represents a server-sent event from the OpenCode server.
 *
 * **Event Types:**
 * - `message.part.updated`: Partial message content during streaming
 * - `message.updated`: Complete message finished streaming
 * - `permission.updated`: Permission request from AI
 * - `session.error`: Session-level error
 *
 * @interface
 * @property {string} type - The event type identifier
 * @property {Record<string, unknown>} [properties] - Event-specific data
 */
export interface StreamEvent {
  /** Event type identifier (e.g., "message.part.updated") */
  type: string;
  /** Optional event-specific properties/metadata */
  properties?: Record<string, unknown>;
}

/**
 * Callback function type for receiving stream events.
 *
 * Subscribers provide this function to receive events as they arrive.
 *
 * @param event - The stream event received from the server
 *
 * @example
 * ```typescript
 * const callback: StreamCallback = (event) => {
 *   console.log('Received event:', event.type, event.properties);
 * };
 * ```
 */
export type StreamCallback = (event: StreamEvent) => void;

/**
 * Manages real-time Server-Sent Events streaming from the OpenCode server.
 *
 * This service provides a subscription-based interface for receiving
 * real-time updates from the server during AI response generation.
 *
 * **Usage Pattern:**
 * ```typescript
 * const service = new MessageStreamService(serverManager);
 *
 * // Subscribe to events
 * const unsubscribe = service.subscribe((event) => {
 *   console.log('Event:', event.type, event.properties);
 * });
 *
 * // Later: Unsubscribe when done
 * unsubscribe();
 * ```
 *
 * **Lifecycle Management:**
 * - Service starts SSE connection when first subscriber joins
 * - Service stops SSE connection when last subscriber leaves
 * - Automatic reconnection on connection loss (5-second delay)
 * - Clean shutdown via dispose()
 *
 * **Thread Safety:**
 * This class is not thread-safe. All methods should be called from the
 * main VSCode extension host thread.
 *
 * **Memory Management:**
 * - Call unsubscribe() returned by subscribe() when done
 * - Call dispose() when shutting down to clean up resources
 * - Aborts fetch requests properly to prevent memory leaks
 *
 * @see StreamEvent for event structure
 * @see StreamCallback for subscription interface
 */
export class MessageStreamService {
  private static readonly HEARTBEAT_EVENT_TYPES = new Set([
    "server.heartbeat",
  ]);

  /** AbortController for cancelling fetch requests (clean shutdown) */
  private abortController: AbortController | null = null;

  /** Set of active subscriber callbacks (auto-starts/stops connection) */
  private callbacks: Set<StreamCallback> = new Set();

  /** Reconnect timer (prevents stacked retries after repeated failures) */
  private reconnectTimer: NodeJS.Timeout | null = null;

  /** Structured logger */
  private logger = createLogger(LoggingCategories.STREAM_HANDLER);

  /**
   * Dedupes mirrored events when both /event and /global/event are active.
   * Stores source metadata so we only collapse cross-stream mirrors and keep
   * same-stream incremental updates.
   */
  private recentEventSignatures: Map<
    string,
    { timestamp: number; source?: string }
  > = new Map();

  private isHeartbeatEvent(eventType: unknown): boolean {
    return (
      typeof eventType === "string" &&
      MessageStreamService.HEARTBEAT_EVENT_TYPES.has(eventType)
    );
  }

  private shouldVerboseStreamDebug(): boolean {
    const level = vscode.workspace
      .getConfiguration("opencode.logging")
      .get<string>("level", "info");
    return typeof level === "string" && level.toLowerCase() === "debug";
  }

  private asPreview(value: unknown, max = 240): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    if (value.length <= max) {
      return value;
    }
    return `${value.slice(0, max)}...`;
  }

  private extractEventTypeHints(rawEvent: unknown): string[] {
    const hints = new Set<string>();
    const seen = new WeakSet<object>();

    const visit = (value: unknown, depth = 0) => {
      if (depth > 4) {
        return;
      }
      const rec = this.asRecord(value);
      if (!rec) {
        return;
      }
      if (seen.has(rec)) {
        return;
      }
      seen.add(rec);

      if (typeof rec.type === "string" && rec.type.trim()) {
        hints.add(rec.type.trim());
      }
      if (typeof rec.event === "string" && rec.event.trim()) {
        hints.add(rec.event.trim());
      }

      visit(rec.payload, depth + 1);
      visit(rec.data, depth + 1);
      visit(rec.properties, depth + 1);
    };

    visit(rawEvent);
    return [...hints];
  }

  /**
   * Creates a new message stream service instance.
   *
   * **Initialization:**
   * Service does NOT start listening immediately.
   * Connection starts when first subscriber subscribes.
   *
   * **Dependency:**
   * Requires OpencodeServerManager to get server port.
   *
   * @param serverManager - Server manager for port access
   */
  constructor(private serverManager: OpencodeServerManager) { }

  /**
   * Starts listening to server events via SSE.
   *
   * **Connection Flow:**
   * 1. Get server port from server manager
   * 2. Stop any existing connection (cleanup)
   * 3. Create AbortController for this connection
   * 4. Fetch from `/event` endpoint with Accept: text/event-stream
   * 5. Read response body as stream
   * 6. Parse SSE protocol and dispatch events
   *
   * **SSE Protocol Parsing:**
   * ```
   * 1. Decode chunk using TextDecoder
   * 2. Append to buffer (handles split chunks)
   * 3. Split by newlines
   * 4. Keep last incomplete line in buffer
   * 5. Parse lines starting with "data: "
   * 6. JSON-parse content and dispatch to callbacks
   * ```
   *
   * **Buffer Management:**
   * Network chunks may not align with line boundaries.
   * We buffer incomplete lines and process when next chunk arrives.
   *
   * **Error Handling:**
   * - AbortError: User stopped listening (normal, not logged as error)
   * - Network errors: Logged, auto-reconnect after 5 seconds
   * - JSON parse errors: Logged, invalid events skipped
   *
   * **Auto-Reconnect:**
   * If connection fails and there are active subscribers,
   * automatically reconnects after 5 seconds.
   *
   * @throws {Error} If server is not running (port is 0)
   * @returns Promise that resolves when connection ends or rejects on error
   *
   * @example
   * ```typescript
   * await service.startListening();
   * // Service is now receiving and dispatching events
   * ```
   *
   * @see stopListening for stopping the connection
   * @see subscribe for automatic start/stop management
   */
  async startListening(): Promise<void> {
    this.clearReconnectTimer();
    this.recentEventSignatures.clear();

    // Close existing connection if any
    this.stopListening();

    this.abortController = new AbortController();
    const abortSignal = this.abortController.signal;
    const startTime = Date.now();

    this.logger.info("Starting SDK-based SSE listener");

    try {
      const client = await this.serverManager.ensureRunning();
      const workspaceDirectory =
        vscode.workspace.workspaceFolders?.[0]?.uri.scheme === "file"
          ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
              .replace(/\\/g, "/")
              .replace(/\/+$/, "")
          : undefined;
      if (workspaceDirectory) {
        this.logger.debug("Workspace directory for stream filtering", {
          workspaceDirectory,
        });
      }
      const eventSubscribeOptions = workspaceDirectory
        ? {
          query: { directory: workspaceDirectory },
          onSseEvent: (sseEvent: unknown) => {
            const rec = this.asRecord(sseEvent);
            const data = rec?.data;
            const eventHints = this.extractEventTypeHints(data);
            const eventType = eventHints[0];
            if (!this.isHeartbeatEvent(eventType) && this.shouldVerboseStreamDebug()) {
              this.logger.debug("/event SSE frame", {
                eventType: eventType || "unknown",
                eventName:
                  typeof rec?.event === "string" ? rec.event : undefined,
                lastEventId:
                  typeof rec?.id === "string" ? rec.id : undefined,
                preview: this.asPreview(
                  typeof data === "string"
                    ? data
                    : JSON.stringify(this.sanitizeForLogging(data)),
                ),
              });
            }
          },
          onSseError: (error: unknown) => {
            this.logger.error("/event SSE callback error", {}, error as Error);
          },
        }
        : {
          onSseEvent: (sseEvent: unknown) => {
            const rec = this.asRecord(sseEvent);
            const data = rec?.data;
            const eventHints = this.extractEventTypeHints(data);
            const eventType = eventHints[0];
            if (!this.isHeartbeatEvent(eventType) && this.shouldVerboseStreamDebug()) {
              this.logger.debug("/event SSE frame", {
                eventType: eventType || "unknown",
                eventName:
                  typeof rec?.event === "string" ? rec.event : undefined,
                lastEventId:
                  typeof rec?.id === "string" ? rec.id : undefined,
                preview: this.asPreview(
                  typeof data === "string"
                    ? data
                    : JSON.stringify(this.sanitizeForLogging(data)),
                ),
              });
            }
          },
          onSseError: (error: unknown) => {
            this.logger.error("/event SSE callback error", {}, error as Error);
          },
        };
      this.logger.info("Subscribing to /event", {
        directory: workspaceDirectory,
      });
      let events;
      try {
        events = await client.event.subscribe(eventSubscribeOptions);
      } catch (subscribeError) {
        // if (!workspaceDirectory) {
        //   throw subscribeError;
        // }
        // console.warn(
        //   "[MessageStreamService] Scoped /event subscription failed, retrying without directory query:",
        //   subscribeError,
        // );
        // events = await client.event.subscribe({
        //   onSseEvent: (sseEvent: unknown) => {
        //     const rec = this.asRecord(sseEvent);
        //     const data = rec?.data;
        //     const eventHints = this.extractEventTypeHints(data);
        //     const eventType = eventHints[0];
        //     if (!this.isHeartbeatEvent(eventType)) {
        //       console.log("[MessageStreamService] /event SSE frame", {
        //         eventType: eventType || "unknown",
        //         eventName: typeof rec?.event === "string" ? rec.event : undefined,
        //         lastEventId: typeof rec?.id === "string" ? rec.id : undefined,
        //         preview: this.asPreview(
        //           typeof data === "string"
        //             ? data
        //             : JSON.stringify(this.sanitizeForLogging(data)),
        //         ),
        //       });
        //     }
        //   },
        //   onSseError: (error: unknown) => {
        //     console.error("[MessageStreamService] /event SSE callback error:", error);
        //   },
        // });
      }

      this.logger.performance("Connection established", Date.now() - startTime, {
        endpoint: "/event",
      });

      const streamTasks: Array<Promise<void>> = [
        this.consumeEventStream(
          events.stream,
          "/event",
          abortSignal,
          workspaceDirectory,
          startTime,
        ),
      ];
      if (client.global && typeof client.global.event === "function") {
        try {
          this.logger.info("Subscribing to /global/event (fallback channel)");
          const globalEvents = await client.global.event({
            onSseEvent: (sseEvent: unknown) => {
              const rec = this.asRecord(sseEvent);
              const data = rec?.data;
              const eventHints = this.extractEventTypeHints(data);
              const eventType = eventHints[0];
              if (!this.isHeartbeatEvent(eventType) && this.shouldVerboseStreamDebug()) {
                this.logger.debug("/global/event SSE frame", {
                  eventType: eventType || "unknown",
                  eventName:
                    typeof rec?.event === "string" ? rec.event : undefined,
                  lastEventId:
                    typeof rec?.id === "string" ? rec.id : undefined,
                  preview: this.asPreview(
                    typeof data === "string"
                      ? data
                      : JSON.stringify(this.sanitizeForLogging(data)),
                  ),
                });
              }
            },
            onSseError: (error: unknown) => {
              this.logger.error("/global/event SSE callback error", {}, error as Error);
            },
          });
          streamTasks.push(
            this.consumeEventStream(
              globalEvents.stream,
              "/global/event",
              abortSignal,
              workspaceDirectory,
              startTime,
            ),
          );
        } catch (globalEventError) {
          this.logger.warn("Failed to subscribe to /global/event fallback", {
            error: globalEventError instanceof Error ? globalEventError.message : String(globalEventError),
          });
        }
      }

      const streamResults = await Promise.allSettled(streamTasks);
      const rejectedStream = streamResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (rejectedStream && !abortSignal.aborted) {
        throw rejectedStream.reason;
      }
    } catch (error: any) {
      if (error.name === "AbortError" || abortSignal.aborted) {
        this.logger.info("Listening aborted");
        return;
      }

      this.logger.error("SSE stream error", {}, error);
      // Auto-reconnect after 5 seconds
      if (this.reconnectTimer) {
        return;
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.callbacks.size > 0) {
          this.startListening().catch((err) => {
            this.logger.error("Auto-reconnect failed", {}, err as Error);
          });
        }
      }, 5000);
    }
  }

  /**
   * Stops listening to server events.
   *
   * **Behavior:**
   * - Aborts the fetch request via AbortController
   * - Clears the abort controller reference
   * - Does NOT clear callbacks (subscribers remain)
   *
   * **Effect on Subscribers:**
   * Subscribers will stop receiving events but remain registered.
   * They will automatically start receiving events again if
   * `startListening()` is called (or via `subscribe()` auto-start).
   *
   * **When to Call:**
   * - Called automatically when last subscriber unsubscribes
   * - Can be called manually to pause event delivery
   * - Called in `dispose()` for cleanup
   *
   * **AbortController Usage:**
   * Using AbortController ensures the fetch request is properly
   * cancelled and resources are released immediately.
   *
   * @example
   * ```typescript
   * service.stopListening();
   * // Connection is closed, subscribers remain registered
   * ```
   *
   * @see startListening for the corresponding start method
   * @see dispose for complete cleanup
   */
  stopListening(): void {
    this.clearReconnectTimer();
    this.recentEventSignatures.clear();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async consumeEventStream(
    stream: AsyncIterable<unknown>,
    source: string,
    abortSignal: AbortSignal,
    workspaceDirectory: string | undefined,
    startTime: number,
  ): Promise<void> {
    let firstChunkLogged = false;
    const verboseDebug = this.shouldVerboseStreamDebug();

    for await (const rawEvent of stream) {
      if (abortSignal.aborted) {
        if (verboseDebug) {
          this.logger.debug(`${source} listener aborted via signal`);
        }
        break;
      }

      if (!firstChunkLogged && verboseDebug) {
        this.logger.performance(`First event (${source}) received`, Date.now() - startTime);
        firstChunkLogged = true;
      }

      try {
        const normalizedEvent = this.normalizeIncomingEvent(rawEvent);
        if (!normalizedEvent) {
          const eventTypeHints = this.extractEventTypeHints(rawEvent);
          this.logger.warn("Skipping unknown event shape", {
            source,
            eventTypeHints,
            rawEvent: verboseDebug
              ? this.sanitizeForLogging(rawEvent)
              : undefined,
          });
          continue;
        }

        if (!this.isHeartbeatEvent(normalizedEvent.type) && verboseDebug) {
          const properties = this.asRecord(normalizedEvent.properties);
          const part = this.asRecord(properties?.part);
          const info = this.asRecord(properties?.info);
          this.logger.debug("Incoming stream event", {
            source,
            type: normalizedEvent.type,
            directory:
              typeof (normalizedEvent as Record<string, unknown>).directory ===
                "string"
                ? (normalizedEvent as Record<string, unknown>).directory
                : undefined,
            sessionID:
              (typeof properties?.sessionID === "string" &&
                properties.sessionID) ||
              (typeof properties?.sessionId === "string" &&
                properties.sessionId) ||
              (typeof part?.sessionID === "string" && part.sessionID) ||
              (typeof part?.sessionId === "string" && part.sessionId) ||
              (typeof info?.sessionID === "string" && info.sessionID) ||
              (typeof info?.sessionId === "string" && info.sessionId) ||
              undefined,
            messageID:
              (typeof properties?.messageID === "string" &&
                properties.messageID) ||
              (typeof properties?.messageId === "string" &&
                properties.messageId) ||
              (typeof part?.messageID === "string" && part.messageID) ||
              (typeof part?.messageId === "string" && part.messageId) ||
              (typeof info?.id === "string" && info.id) ||
              undefined,
            partType:
              typeof part?.type === "string" ? part.type : undefined,
          });
        }

        if (
          !this.isEventInWorkspaceDirectory(normalizedEvent, workspaceDirectory)
        ) {
          const eventDirectory =
            typeof (normalizedEvent as Record<string, unknown>).directory ===
              "string"
              ? ((normalizedEvent as Record<string, unknown>).directory as string)
              : undefined;
          if (verboseDebug) {
            this.logger.debug("Ignoring event due to directory mismatch", {
              source,
              type: normalizedEvent.type,
              eventDirectory,
              workspaceDirectory,
            });
          }
          continue;
        }

        const eventWithSource = {
          ...normalizedEvent,
          source,
        } as StreamEvent;

        if (this.isDuplicateEvent(eventWithSource)) {
          if (!this.isHeartbeatEvent(eventWithSource.type) && verboseDebug) {
            this.logger.debug("Dropped duplicate event", {
              source,
              type: eventWithSource.type,
            });
          }
          continue;
        }

        this.notifyCallbacks(eventWithSource);
      } catch (error) {
        this.logger.error("Failed to process event", { source }, error as Error);
      }
    }
  }

  /**
   * Subscribes to stream events with automatic lifecycle management.
   *
   * **Auto-Start Behavior:**
   * If this is the first subscriber, automatically starts
   * the SSE connection. No need to manually call `startListening()`.
   *
   * **Auto-Stop Behavior:**
   * When the unsubscribe function is called and there are no
   * more subscribers, automatically stops the SSE connection.
   *
   * **Return Value:**
   * Returns an unsubscribe function that removes the subscription.
   * Call this function when you no longer want to receive events.
   *
   * **Usage Pattern:**
   * ```typescript
   * const unsubscribe = service.subscribe((event) => {
   *   console.log('Got event:', event);
   * });
   *
   * // Later: Stop receiving events
   * unsubscribe();
   * ```
   *
   * **Callback Error Handling:**
   * If a callback throws an error, it's caught and logged but
   * doesn't affect other subscribers. The subscription remains active.
   *
   * **Multiple Subscriptions:**
   * You can subscribe multiple times with different callbacks.
   * All callbacks will receive every event.
   *
   * @param callback - Function to call for each stream event
   * @returns Unsubscribe function to remove the subscription
   *
   * @example
   * ```typescript
   * // Subscribe multiple handlers
   * const unsub1 = service.subscribe((event) => {
   *   if (event.type === 'message.updated') {
   *     console.log('Message complete!');
   *   }
   * });
   *
   * const unsub2 = service.subscribe((event) => {
   *   console.log('All events:', event);
   * });
   *
   * // Later: clean up
   * unsub1();
   * unsub2();
   * ```
   *
   * @see notifyCallbacks for event dispatch logic
   */
  subscribe(callback: StreamCallback): () => void {
    this.callbacks.add(callback);

    // Start listening if this is the first subscriber
    if (this.callbacks.size === 1) {
      this.startListening().catch((error) => this.logger.error("Failed to start listening", {}, error as Error));
    }

    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);

      // Stop listening if no more subscribers
      if (this.callbacks.size === 0) {
        this.stopListening();
      }
    };
  }

  /**
   * Notifies all registered callbacks of a new event.
   *
   * This is an internal method called by `startListening()` when
   * a new event is received from the server.
   *
   * **Dispatch Behavior:**
   * - Iterates through all registered callbacks
   * - Calls each callback with the event
   * - Catches and logs errors from individual callbacks
   * - Continues notifying remaining callbacks even if one fails
   *
   * **Error Handling:**
   * If a callback throws an error:
   * - Error is caught and logged to console
   * - Other callbacks still receive the event
   * - The problematic callback remains subscribed
   *
   * This "fail-safe" behavior ensures one buggy subscriber
   * doesn't break event delivery for other subscribers.
   *
   * **Performance:**
   * Uses forEach which is slightly slower than for loop but
   * more readable. Performance is acceptable for typical
   * event rates (few events per second).
   *
   * @param event - The stream event to dispatch to all subscribers
   *
   * @private
   *
   * @see subscribe for adding callbacks
   * @see startListening for where events come from
   */
  /**
   * Sanitizes an object for logging by removing circular references, methods, and limiting depth.
   * Only includes primitive fields and nested objects/arrays.
   */
  private sanitizeForLogging(
    value: unknown,
    depth = 0,
    seen = new WeakSet<object>(),
    maxDepth = 4
  ): unknown {
    // Handle primitives
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (depth >= maxDepth) {
        return `[Array(${value.length})]`;
      }
      return value.map((item) => this.sanitizeForLogging(item, depth + 1, seen, maxDepth));
    }

    // Handle objects
    if (typeof value === "object") {
      // Check for circular references
      if (seen.has(value as object)) {
        return "[Circular]";
      }
      seen.add(value as object);

      // Limit depth
      if (depth >= maxDepth) {
        return "[Object]";
      }

      const result: Record<string, unknown> = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          // Skip methods and private properties
          if (typeof (value as Record<string, unknown>)[key] === "function") {
            continue;
          }
          if (key.startsWith("_")) {
            continue;
          }
          result[key] = this.sanitizeForLogging((value as Record<string, unknown>)[key], depth + 1, seen, maxDepth);
        }
      }
      return result;
    }

    return String(value);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }

  private normalizeDirectory(value: string): string {
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  private isEventInWorkspaceDirectory(
    event: StreamEvent,
    workspaceDirectory: string | undefined,
  ): boolean {
    if (!workspaceDirectory) {
      return true;
    }

    const eventDirectory =
      typeof (event as Record<string, unknown>).directory === "string"
        ? ((event as Record<string, unknown>).directory as string)
        : undefined;

    if (!eventDirectory) {
      return true;
    }

    return (
      this.normalizeDirectory(eventDirectory) ===
      this.normalizeDirectory(workspaceDirectory)
    );
  }

  private getEventSignature(event: StreamEvent): string {
    const properties = this.asRecord(event.properties) ?? {};
    const part = this.asRecord(properties.part);
    const info = this.asRecord(properties.info);

    return JSON.stringify({
      type: event.type,
      messageID:
        (typeof properties.messageID === "string" && properties.messageID) ||
        (typeof info?.id === "string" && info.id) ||
        undefined,
      partID: typeof part?.id === "string" ? part.id : undefined,
      partType: typeof part?.type === "string" ? part.type : undefined,
      delta:
        (typeof part?.delta === "string" && part.delta) ||
        (typeof properties.delta === "string" && properties.delta) ||
        undefined,
      text:
        (typeof part?.text === "string" && part.text) ||
        (typeof properties.text === "string" && properties.text) ||
        undefined,
      directory:
        typeof (event as Record<string, unknown>).directory === "string"
          ? (event as Record<string, unknown>).directory
          : undefined,
    });
  }

  private isDuplicateEvent(event: StreamEvent): boolean {
    const now = Date.now();
    const signature = this.getEventSignature(event);
    const duplicateWindowMs = 350;
    const staleEntryWindowMs = 10_000;
    const source =
      typeof (event as Record<string, unknown>).source === "string"
        ? ((event as Record<string, unknown>).source as string)
        : undefined;

    const previousSeen = this.recentEventSignatures.get(signature);
    this.recentEventSignatures.set(signature, { timestamp: now, source });

    if (this.recentEventSignatures.size > 500) {
      for (const [existingSignature, timestamp] of this.recentEventSignatures) {
        if (now - timestamp.timestamp > staleEntryWindowMs) {
          this.recentEventSignatures.delete(existingSignature);
        }
      }
    }

    if (
      !previousSeen ||
      typeof previousSeen.timestamp !== "number" ||
      now - previousSeen.timestamp > duplicateWindowMs
    ) {
      return false;
    }

    if (!source || !previousSeen.source) {
      return true;
    }

    return previousSeen.source !== source;
  }

  /**
   * SDK event.subscribe() may emit either:
   * - Event: { type, properties }
   * - GlobalEvent: { directory, payload: { type, properties } }
   * Normalize both to the Event shape expected by downstream handlers.
   */
  private normalizeIncomingEvent(rawEvent: unknown): StreamEvent | null {
    const eventRecord = this.asRecord(rawEvent);
    if (!eventRecord) {
      return null;
    }

    if (typeof eventRecord.type === "string") {
      return eventRecord as StreamEvent;
    }

    const payload = this.asRecord(eventRecord.payload);
    if (payload && typeof payload.type === "string") {
      const normalizedFromPayload: Record<string, unknown> = { ...payload };
      if (
        typeof eventRecord.directory === "string" &&
        typeof normalizedFromPayload.directory === "undefined"
      ) {
        normalizedFromPayload.directory = eventRecord.directory;
      }
      return normalizedFromPayload as StreamEvent;
    }

    const data = this.asRecord(eventRecord.data);
    if (data && typeof data.type === "string") {
      const normalizedFromData: Record<string, unknown> = { ...data };
      if (
        typeof eventRecord.directory === "string" &&
        typeof normalizedFromData.directory === "undefined"
      ) {
        normalizedFromData.directory = eventRecord.directory;
      }
      return normalizedFromData as StreamEvent;
    }

    const nestedPayload = this.asRecord(payload?.payload);
    if (nestedPayload && typeof nestedPayload.type === "string") {
      const normalizedFromNestedPayload: Record<string, unknown> = {
        ...nestedPayload,
      };
      if (
        typeof eventRecord.directory === "string" &&
        typeof normalizedFromNestedPayload.directory === "undefined"
      ) {
        normalizedFromNestedPayload.directory = eventRecord.directory;
      }
      return normalizedFromNestedPayload as StreamEvent;
    }

    const nestedData = this.asRecord(payload?.data);
    if (nestedData && typeof nestedData.type === "string") {
      const normalizedFromNestedData: Record<string, unknown> = {
        ...nestedData,
      };
      if (
        typeof eventRecord.directory === "string" &&
        typeof normalizedFromNestedData.directory === "undefined"
      ) {
        normalizedFromNestedData.directory = eventRecord.directory;
      }
      return normalizedFromNestedData as StreamEvent;
    }

    if (!payload || typeof payload.type !== "string") {
      return null;
    }

    const normalized: Record<string, unknown> = { ...payload };
    if (
      typeof eventRecord.directory === "string" &&
      typeof normalized.directory === "undefined"
    ) {
      normalized.directory = eventRecord.directory;
    }

    return normalized as StreamEvent;
  }

  private notifyCallbacks(event: StreamEvent): void {
    if (this.shouldVerboseStreamDebug()) {
      // Log all stream event properties for debugging
      const sanitizedProperties = this.sanitizeForLogging(event.properties);

      // Extract commonly interesting fields for clearer logging
      const properties = (event.properties as Record<string, unknown>) || {};
      const part = (properties.part as Record<string, unknown>) || {};
      const info = (properties.info as Record<string, unknown>) || {};

      // Build enriched log context with message content prominently displayed
      const logContext: Record<string, unknown> = {
        eventType: event.type,
      };
      const streamSource =
        typeof (event as Record<string, unknown>).source === "string"
          ? ((event as Record<string, unknown>).source as string)
          : undefined;
      if (streamSource) {
        logContext.source = streamSource;
      }
      const directory =
        typeof (event as Record<string, unknown>).directory === "string"
          ? ((event as Record<string, unknown>).directory as string)
          : undefined;
      if (directory) {
        logContext.directory = directory;
      }

      // Helper function to extract text content from a value
      const extractText = (value: unknown): string | undefined => {
        if (typeof value === "string") {
          return value;
        }
        if (Array.isArray(value)) {
          return value.map((v) => (typeof v === "string" ? v : "")).join("");
        }
        return undefined;
      };

      // Check ALL possible locations for AI message content
      // Priority order: delta (streaming), then text, then content, then output/answer/response

      // 1. Check part level fields (most common for message.part.updated)
      const partDelta = extractText(part.delta);
      const partText = extractText(part.text);
      const partContent = extractText(part.content);
      const partValue = extractText(part.value);
      const partOutput = extractText(part.output);
      const partAnswer = extractText(part.answer);
      const partResponse = extractText(part.response);
      const partMessage = extractText(part.message);

      // 2. Check properties level fields
      const propDelta = extractText(properties.delta);
      const propText = extractText(properties.text);
      const propContent = extractText(properties.content);
      const propValue = extractText(properties.value);
      const propOutput = extractText(properties.output);
      const propAnswer = extractText(properties.answer);
      const propResponse = extractText(properties.response);
      const propMessage = extractText(properties.message);

      // Add the first non-empty message content we find
      const messageContent =
        partDelta ||
        partText ||
        partContent ||
        partValue ||
        partOutput ||
        partAnswer ||
        partResponse ||
        partMessage ||
        propDelta ||
        propText ||
        propContent ||
        propValue ||
        propOutput ||
        propAnswer ||
        propResponse ||
        propMessage;

      if (messageContent) {
        logContext.aiMessage = messageContent;
      }

      // Add reasoning/thinking content if present.
      // SDK ReasoningPart uses { type: "reasoning", text: "..." }.
      if (part.reasoning) {
        logContext.reasoning = extractText(part.reasoning);
      }
      if (part.thought) {
        logContext.thought = extractText(part.thought);
      }
      if (part.thinking) {
        logContext.thinking = extractText(part.thinking);
      }
      const partType =
        typeof part.type === "string" ? part.type.toLowerCase() : "";
      if (
        partType === "reasoning" &&
        !logContext.reasoning &&
        !logContext.thinking &&
        !logContext.thought
      ) {
        const reasoningText =
          partText || partDelta || extractText(properties.delta) || propText;
        if (reasoningText) {
          logContext.reasoning = reasoningText;
        }
      }

      // Add part type
      if (part.type) {
        logContext.partType = part.type;
      }

      // Add message completion info
      if (event.type === "message.updated") {
        logContext.messageComplete = true;
        if (info.agent) logContext.agent = info.agent;
        if (info.duration) logContext.duration = info.duration;
        if (info.tokens) logContext.tokens = info.tokens;
        if (info.modelID) logContext.modelID = info.modelID;
        if (info.providerID) logContext.providerID = info.providerID;
      }

      // Add error info
      if (event.type === "session.error" || event.type === "error") {
        logContext.hasError = true;
        if (properties.error)
          logContext.errorMessage = extractText(properties.error);
      }

      // Include all other properties for complete debugging
      logContext.allProperties = sanitizedProperties;

      // Log the event with enriched context - AI message now prominently displayed
      this.logger.debug(`Stream Event: ${event.type}`, logContext);
    }

    this.callbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        // Log but don't throw - one bad callback shouldn't break everything
        this.logger.error("Callback error in subscriber", {}, error as Error);
      }
    });
  }

  /**
   * Disposes of the stream service and cleans up resources.
   *
   * **Cleanup Actions:**
   * 1. Stops the SSE connection (aborts fetch request)
   * 2. Clears all subscriber callbacks
   *
   * **Effect on Subscribers:**
   * All subscriptions are effectively cancelled. Subscribers
   * will stop receiving events immediately and cannot be
   * reactivated (would need to subscribe again after disposal).
   *
   * **When to Call:**
   * - During extension deactivation
   * - When shutting down the chat view
   * - When completely done with streaming
   *
   * **Disposal Pattern:**
   * After calling dispose(), the service should not be used again.
   * Create a new instance if you need streaming functionality later.
   *
   * **Thread Safety:**
   * This method is safe to call multiple times (idempotent).
   * Subsequent calls after the first will have no effect.
   *
   * @example
   * ```typescript
   * // During extension shutdown
   * service.dispose();
   * // Service is now cleaned up and cannot be reused
   * ```
   *
   * @see stopListening for stopping connection without clearing callbacks
   */
  dispose(): void {
    this.stopListening();
    this.callbacks.clear();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
