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
  /** AbortController for cancelling fetch requests (clean shutdown) */
  private abortController: AbortController | null = null;

  /** Set of active subscriber callbacks (auto-starts/stops connection) */
  private callbacks: Set<StreamCallback> = new Set();

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
  constructor(private serverManager: OpencodeServerManager) {}

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
    const port = this.serverManager.getPort();
    if (!port) {
      throw new Error("Server not running");
    }

    // Close existing connection if any
    this.stopListening();

    this.abortController = new AbortController();
    const eventUrl = `http://localhost:${port}/event`;
    const startTime = Date.now();

    console.log(
      `[MessageStreamService] Starting fetch-based SSE listener: ${eventUrl}`,
    );

    try {
      const response = await fetch(eventUrl, {
        signal: this.abortController.signal,
        headers: {
          Accept: "text/event-stream",
        },
      });

      console.log(
        `[MessageStreamService] Response received in ${Date.now() - startTime}ms`,
      );

      if (!response.ok) {
        throw new Error(`SSE fetch failed with status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is null");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let firstChunkLogged = false;

      while (true) {
        const { done, value } = await reader.read();

        if (!firstChunkLogged && value) {
          console.log(
            `[MessageStreamService] First chunk received in ${Date.now() - startTime}ms`,
          );
          firstChunkLogged = true;
        }

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.substring(6));
              this.notifyCallbacks(data);
            } catch (error) {
              console.error(
                "[MessageStreamService] Failed to parse event:",
                error,
              );
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("[MessageStreamService] Listening aborted");
        return;
      }

      console.error("[MessageStreamService] SSE stream error:", error);
      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (this.callbacks.size > 0) {
          this.startListening().catch(console.error);
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
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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
      this.startListening().catch(console.error);
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
  private notifyCallbacks(event: StreamEvent): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        // Log but don't throw - one bad callback shouldn't break everything
        console.error("Callback error:", error);
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
}
