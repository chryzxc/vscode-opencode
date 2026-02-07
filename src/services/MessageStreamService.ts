import { OpencodeServerManager } from './OpencodeServerManager';

export interface StreamEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export type StreamCallback = (event: StreamEvent) => void;

export class MessageStreamService {
  private abortController: AbortController | null = null;
  private callbacks: Set<StreamCallback> = new Set();

  constructor(private serverManager: OpencodeServerManager) {}

  /**
   * Starts listening to server events
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
   * Stops listening to server events
   */
  stopListening(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Subscribes to stream events
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
   * Notifies all callbacks
   */
  private notifyCallbacks(event: StreamEvent): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error("Callback error:", error);
      }
    });
  }

  /**
   * Disposes the service
   */
  dispose(): void {
    this.stopListening();
    this.callbacks.clear();
  }
}
