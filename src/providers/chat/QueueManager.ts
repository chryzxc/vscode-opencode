/**
 * QueueManager Module
 *
 * Prompt queue CRUD, execution lifecycle, and dispatch scheduling.
 *
 * Extracted from ChatViewProvider.ts (~300 lines)
 */

import type { QueuedPrompt, PromptDispatchMode } from "./types";

export class QueueManager {
  private queueBySessionId = new Map<string, QueuedPrompt[]>();
  private queueItemSequence = 0;
  private executingQueueSessionIds = new Set<string>();

  constructor(
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
  ) {
    this.handleSendMessage = async () => { };
    this.handleStopRequest = async () => { };
    this.postMessage = () => { };
    this.getCurrentSessionId = () => undefined;
  }

  private handleSendMessage: (...args: any[]) => Promise<void>;
  private handleStopRequest: (sessionId?: string) => Promise<void>;
  private postMessage: (msg: any) => void;
  private getCurrentSessionId: () => string | undefined;

  setHandleSendMessage(fn: (...args: any[]) => Promise<void>): void {
    this.handleSendMessage = fn;
  }

  setHandleStopRequest(fn: (sessionId?: string) => Promise<void>): void {
    this.handleStopRequest = fn;
  }

  setPostMessage(fn: (msg: any) => void): void {
    this.postMessage = fn;
  }

  setGetCurrentSessionId(fn: () => string | undefined): void {
    this.getCurrentSessionId = fn;
  }

  /**
   * Get session queue
   */
  getSessionQueue(sessionId: string): QueuedPrompt[] {
    return this.queueBySessionId.get(sessionId) || [];
  }

  /**
   * Set session queue
   */
  setSessionQueue(sessionId: string, queue: QueuedPrompt[]): void {
    this.queueBySessionId.set(sessionId, queue);
  }

  /**
   * Create queued prompt
   */
  createQueuedPrompt(
    sessionId: string,
    text: string,
    dispatchMode: PromptDispatchMode,
    options?: {
      userFacingText?: string;
      files?: string[];
      contexts?: any[];
      images?: any[];
      agent?: string;
    },
  ): QueuedPrompt {
    this.queueItemSequence += 1;
    return {
      id: `q-${Date.now()}-${this.queueItemSequence}`,
      sessionId,
      createdAt: Date.now(),
      text,
      userFacingText: options?.userFacingText,
      files: options?.files,
      contexts: options?.contexts,
      images: options?.images,
      agent: options?.agent,
    };
  }

  /**
   * Resolve queue session ID
   */
  resolveQueueSessionId(
    explicitSessionId: string | undefined,
    currentSessionId: string | undefined,
  ): string | undefined {
    return explicitSessionId || currentSessionId;
  }

  /**
   * Enqueue prompt
   */
  async enqueuePrompt(prompt: QueuedPrompt): Promise<void> {
    const { sessionId } = prompt;
    const queue = this.getSessionQueue(sessionId);
    queue.push(prompt);
    this.setSessionQueue(sessionId, queue);
    await this.sendQueueUpdate(sessionId);
  }

  /**
   * Take queued prompt
   */
  takeQueuedPrompt(sessionId: string): QueuedPrompt | undefined {
    const queue = this.getSessionQueue(sessionId);
    if (queue.length === 0) {
      return undefined;
    }
    const [prompt, ...remaining] = queue;
    this.setSessionQueue(sessionId, remaining);
    return prompt;
  }

  /**
   * Dispatch interactive response
   */
  async dispatchInteractiveResponse(response: any): Promise<void> {
    // Send the interactive response back to the webview
    this.postMessage({
      type: "interactiveResponse",
      response,
    });
  }

  /**
   * Schedule prompt dispatch
   */
  // PROMPT-OWNERSHIP: This method orchestrates prompt execution flow and must run sequentially per session
  async schedulePromptDispatch(
    mode: PromptDispatchMode,
    payload: {
      sessionId?: string;
      text?: string;
      files?: string[];
      contexts?: any[];
      images?: any[];
      agent?: string;
    },
  ): Promise<void> {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return;
    }
    const sessionId = this.resolveQueueSessionId(payload.sessionId, this.getCurrentSessionId());
    if (!sessionId) {
      return;
    }
    const prompt = this.createQueuedPrompt(sessionId, text, mode, {
      files: payload.files,
      contexts: payload.contexts,
      images: payload.images,
      agent: payload.agent,
    });
    // Always enqueue first to ensure reliability and persistence
    await this.enqueuePrompt(prompt);
    // Then trigger the drain loop (which handles its own locking)
    if (mode !== "queue") {
      await this.maybeAutoDrainQueue(sessionId);
    }
  }

  /**
   * Handle dispatch queued item
   */
  async handleDispatchQueuedItem(
    dispatchMode: "queue" | "send-now" | "steer",
    sessionId: string,
    id: string,
    index?: number,
  ): Promise<void> {
    const queue = this.getSessionQueue(sessionId);
    const prompt = queue.find((p) => p.id === id);
    if (prompt) {
      // Remove from queue
      const filtered = queue.filter((p) => p.id !== id);
      this.setSessionQueue(sessionId, filtered);

      // Dispatch: enqueue and drain directly
      await this.enqueuePrompt(prompt);
      await this.maybeAutoDrainQueue(sessionId);
    }
  }

  /**
   * Handle remove from queue
   */
  async handleRemoveFromQueue(message: { id: string }): Promise<void> {
    for (const [sessionId, queue] of this.queueBySessionId.entries()) {
      const filtered = queue.filter((p) => p.id !== message.id);
      if (filtered.length !== queue.length) {
        this.setSessionQueue(sessionId, filtered);
        await this.sendQueueUpdate(sessionId);
        return;
      }
    }
  }

  /**
   * Handle clear queue
   */
  async handleClearQueue(message: { sessionId: string }): Promise<void> {
    const { sessionId } = message;
    this.setSessionQueue(sessionId, []);
    await this.sendQueueUpdate(sessionId);
  }

  /**
   * Handle execute queue
   */
  async handleExecuteQueue(message: { sessionId: string }): Promise<void> {
    const { sessionId } = message;
    if (this.executingQueueSessionIds.has(sessionId)) {
      return;
    }

    this.executingQueueSessionIds.add(sessionId);
    this.postMessage({
      type: "queueExecutionStarted",
      sessionId,
    });

    try {
      while (true) {
        const prompt = this.takeQueuedPrompt(sessionId);
        if (!prompt) {
          break;
        }

        await this.handleSendMessage(
          prompt.text,
          sessionId,
          {
            files: prompt.files,
            contexts: prompt.contexts,
            images: prompt.images,
          },
          prompt.agent,
        );
      }
    } finally {
      this.executingQueueSessionIds.delete(sessionId);
      await this.sendQueueUpdate(sessionId);
    }
  }

  /**
   * Maybe auto drain queue
   */
  async maybeAutoDrainQueue(sessionId: string): Promise<void> {
    if (this.executingQueueSessionIds.has(sessionId)) {
      return;
    }

    this.executingQueueSessionIds.add(sessionId);
    this.postMessage({
      type: "queueExecutionStarted",
      sessionId,
    });

    try {
      while (true) {
        const prompt = this.takeQueuedPrompt(sessionId);
        if (!prompt) {
          break;
        }

        await this.handleSendMessage(
          prompt.text,
          sessionId,
          {
            files: prompt.files,
            contexts: prompt.contexts,
            images: prompt.images,
          },
          prompt.agent,
        );
      }
    } finally {
      this.executingQueueSessionIds.delete(sessionId);
      await this.sendQueueUpdate(sessionId);
    }
  }

  /**
   * Send queue update
   */
  async sendQueueUpdate(sessionId: string): Promise<void> {
    const queue = this.getSessionQueue(sessionId);
    this.postMessage({
      type: "queueUpdate",
      sessionId,
      queue,
    });
  }
}
