import { OpencodeServerManager } from './OpencodeServerManager';

export interface StreamEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export type StreamCallback = (event: StreamEvent) => void;

export class MessageStreamService {
  private eventSource: EventSource | null = null;
  private callbacks: Set<StreamCallback> = new Set();

  constructor(private serverManager: OpencodeServerManager) {}

  /**
   * Starts listening to server events
   */
  async startListening(): Promise<void> {
    const port = this.serverManager.getPort();
    if (!port) {
      throw new Error('Server not running');
    }

    // Close existing connection if any
    this.stopListening();

    const eventUrl = `http://localhost:${port}/event`;
    this.eventSource = new EventSource(eventUrl);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.notifyCallbacks(data);
      } catch (error) {
        console.error('Failed to parse event:', error);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (this.callbacks.size > 0) {
          this.startListening().catch(console.error);
        }
      }, 5000);
    };
  }

  /**
   * Stops listening to server events
   */
  stopListening(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
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
        console.error('Callback error:', error);
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
