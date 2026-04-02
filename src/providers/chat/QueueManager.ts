/**
 * QueueManager Module
 *
 * Prompt queue CRUD, execution lifecycle, and dispatch scheduling.
 *
 * Extracted from ChatViewProvider.ts (~300 lines)
 */

import { LoggingCategories } from "../../utils/LoggingSchema";
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
    const correlationId = this.logger.startFeatureFlow('enqueue-prompt', {
      promptId: prompt.id,
      sessionId: prompt.sessionId,
    });

    const { sessionId } = prompt;
    const previousQueue = this.getSessionQueue(sessionId);
    const previousSize = previousQueue.length;

    const queue = this.getSessionQueue(sessionId);
    queue.push(prompt);
    this.setSessionQueue(sessionId, queue);

    this.logger.logStateChange(
      `queue-size-${sessionId}`,
      previousSize,
      queue.length,
      'enqueue-prompt'
    );

    this.logger.info('Prompt enqueued', {
      correlationId,
      promptId: prompt.id,
      sessionId,
      queuePosition: queue.length,
      text: prompt.text.slice(0, 100),
      dispatchMode: prompt.agent || 'default',
    });

    await this.sendQueueUpdate(sessionId);

    this.logger.endFeatureFlow(correlationId, {
      success: true,
      queueSize: queue.length,
    });
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
      this.logger.debug( 'Schedule prompt dispatch skipped: empty text', {
        mode,
      });
      return;
    }

    const sessionId = this.resolveQueueSessionId(payload.sessionId, this.getCurrentSessionId());
    if (!sessionId) {
      this.logger.warn( 'Schedule prompt dispatch failed: no session ID', {
        mode,
        textLength: text.length,
      });
      return;
    }

    const correlationId = this.logger.startFeatureFlow('schedule-prompt-dispatch', {
      mode,
      sessionId,
      textLength: text.length,
      hasFiles: !!payload.files?.length,
      hasImages: !!payload.images?.length,
      agent: payload.agent,
    });

    const prompt = this.createQueuedPrompt(sessionId, text, mode, {
      files: payload.files,
      contexts: payload.contexts,
      images: payload.images,
      agent: payload.agent,
    });

    this.logger.info('Prompt dispatch scheduled', {
      correlationId,
      promptId: prompt.id,
      mode,
      sessionId,
      textLength: text.length,
    });

    // Always enqueue first to ensure reliability and persistence
    await this.enqueuePrompt(prompt);

    // Then trigger the drain loop (which handles its own locking)
    if (mode !== "queue") {
      this.logger.featureStep(correlationId, 'auto-drain-triggered', {
        mode,
        sessionId,
      });
      await this.maybeAutoDrainQueue(sessionId);
    } else {
      this.logger.featureStep(correlationId, 'queued-only', {
        mode,
        sessionId,
      });
    }

    this.logger.endFeatureFlow(correlationId, {
      success: true,
      mode,
      promptId: prompt.id,
    });
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
    const correlationId = this.logger.startFeatureFlow('dispatch-queued-item', {
      dispatchMode,
      sessionId,
      promptId: id,
      index,
    });

    const queue = this.getSessionQueue(sessionId);
    const prompt = queue.find((p) => p.id === id);

    if (!prompt) {
      this.logger.warn( 'Queued item not found for dispatch', {
        sessionId,
        promptId: id,
        dispatchMode,
      });
      this.logger.endFeatureFlow(correlationId, {
        success: false,
        error: 'Prompt not found',
      });
      return;
    }

    const previousSize = queue.length;

    // Remove from queue
    const filtered = queue.filter((p) => p.id !== id);
    this.setSessionQueue(sessionId, filtered);

    this.logger.logStateChange(
      `queue-size-${sessionId}`,
      previousSize,
      filtered.length,
      'dispatch-queued-item'
    );

    this.logger.info('Queued item dispatched', {
      correlationId,
      sessionId,
      promptId: id,
      dispatchMode,
      previousSize,
      newSize: filtered.length,
    });

    // Dispatch: enqueue and drain directly
    await this.enqueuePrompt(prompt);
    await this.maybeAutoDrainQueue(sessionId);

    this.logger.endFeatureFlow(correlationId, {
      success: true,
      dispatchMode,
      promptId: id,
    });
  }

  /**
   * Handle remove from queue
   */
  async handleRemoveFromQueue(message: { id: string }): Promise<void> {
    for (const [sessionId, queue] of this.queueBySessionId.entries()) {
      const previousSize = queue.length;
      const filtered = queue.filter((p) => p.id !== message.id);
      if (filtered.length !== queue.length) {
        this.setSessionQueue(sessionId, filtered);

        this.logger.logStateChange(
          `queue-size-${sessionId}`,
          previousSize,
          filtered.length,
          'remove-from-queue'
        );

        this.logger.info( 'Prompt removed from queue', {
          sessionId,
          promptId: message.id,
          previousSize,
          newSize: filtered.length,
        });

        await this.sendQueueUpdate(sessionId);
        return;
      }
    }

    this.logger.warn('Prompt not found for removal', {
      promptId: message.id,
    });
  }

  /**
   * Handle clear queue
   */
  async handleClearQueue(message: { sessionId: string }): Promise<void> {
    const { sessionId } = message;
    const previousQueue = this.getSessionQueue(sessionId);
    const previousSize = previousQueue.length;

    this.logger.logStateChange(
      `queue-size-${sessionId}`,
      previousSize,
      0,
      'clear-queue'
    );

    this.logger.logStateChange(
      `queue-${sessionId}`,
      previousQueue.map(p => ({ id: p.id, text: p.text.slice(0, 50) })),
      [],
      'clear-queue'
    );

    this.setSessionQueue(sessionId, []);

    this.logger.info('Queue cleared', {
      sessionId,
      previousSize,
      cleared: true,
    });

    await this.sendQueueUpdate(sessionId);
  }

  /**
   * Handle execute queue
   */
  async handleExecuteQueue(message: { sessionId: string }): Promise<void> {
    const { sessionId } = message;
    if (this.executingQueueSessionIds.has(sessionId)) {
      this.logger.warn( 'Queue already executing', {
        sessionId,
      });
      return;
    }

    const correlationId = this.logger.startFeatureFlow('execute-queue', {
      sessionId,
    });
    const startTime = Date.now();

    const previousQueue = this.getSessionQueue(sessionId);
    const previousSize = previousQueue.length;

    this.executingQueueSessionIds.add(sessionId);

    this.logger.logStateChange(
      `queue-executing-${sessionId}`,
      false,
      true,
      'execute-queue-start'
    );

    this.postMessage({
      type: "queueExecutionStarted",
      sessionId,
    });

    this.logger.info('Queue execution started', {
      correlationId,
      sessionId,
      promptCount: previousSize,
    });

    try {
      let completedCount = 0;
      let failedCount = 0;

      while (true) {
        const prompt = this.takeQueuedPrompt(sessionId);
        if (!prompt) {
          break;
        }

        this.logger.featureStep(correlationId, 'execute-prompt', {
          promptId: prompt.id,
          position: completedCount + 1,
          total: previousSize,
        });

        try {
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
          completedCount++;

          this.logger.info( 'Prompt executed successfully', {
            correlationId,
            promptId: prompt.id,
            position: completedCount,
            sessionId,
          });
        } catch (error) {
          failedCount++;

          this.logger.error(
            'Prompt execution failed',
            {
              correlationId,
              promptId: prompt.id,
              position: completedCount + 1,
              sessionId,
              text: prompt.text.slice(0, 100),
            },
            error as Error
          );
        }
      }

      const duration = Date.now() - startTime;

      this.logger.performance('execute-queue', duration, {
        sessionId,
        totalPrompts: previousSize,
        completedPrompts: completedCount,
        failedPrompts: failedCount,
      });

      this.logger.info( 'Queue execution completed', {
        correlationId,
        sessionId,
        totalPrompts: previousSize,
        completedCount,
        failedCount,
        duration,
      });

      this.logger.endFeatureFlow(correlationId, {
        success: true,
        completedCount,
        failedCount,
        duration,
      });
    } catch (error) {
      this.logger.error(
        'Queue execution failed',
        { correlationId, sessionId },
        error as Error
      );

      this.logger.endFeatureFlow(correlationId, {
        success: false,
        error: String(error),
      });
      throw error;
    } finally {
      this.executingQueueSessionIds.delete(sessionId);

      this.logger.logStateChange(
        `queue-executing-${sessionId}`,
        true,
        false,
        'execute-queue-end'
      );

      await this.sendQueueUpdate(sessionId);
    }
  }

  /**
   * Maybe auto drain queue
   */
  async maybeAutoDrainQueue(sessionId: string): Promise<void> {
    if (this.executingQueueSessionIds.has(sessionId)) {
      this.logger.debug( 'Queue already draining', {
        sessionId,
      });
      return;
    }

    const correlationId = this.logger.startFeatureFlow('auto-drain-queue', {
      sessionId,
    });
    const startTime = Date.now();

    const previousQueue = this.getSessionQueue(sessionId);
    const previousSize = previousQueue.length;

    this.executingQueueSessionIds.add(sessionId);

    this.logger.logStateChange(
      `queue-executing-${sessionId}`,
      false,
      true,
      'auto-drain-start'
    );

    this.postMessage({
      type: "queueExecutionStarted",
      sessionId,
    });

    this.logger.info('Auto-drain queue started', {
      correlationId,
      sessionId,
      promptCount: previousSize,
    });

    try {
      let completedCount = 0;
      let failedCount = 0;

      while (true) {
        const prompt = this.takeQueuedPrompt(sessionId);
        if (!prompt) {
          break;
        }

        this.logger.featureStep(correlationId, 'drain-prompt', {
          promptId: prompt.id,
          position: completedCount + 1,
          total: previousSize,
        });

        try {
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
          completedCount++;
        } catch (error) {
          failedCount++;

          this.logger.error(
            'Auto-drain prompt execution failed',
            {
              correlationId,
              promptId: prompt.id,
              position: completedCount + 1,
              sessionId,
            },
            error as Error
          );
        }
      }

      const duration = Date.now() - startTime;

      this.logger.performance('auto-drain-queue', duration, {
        sessionId,
        totalPrompts: previousSize,
        completedPrompts: completedCount,
        failedPrompts: failedCount,
      });

      this.logger.info( 'Auto-drain queue completed', {
        correlationId,
        sessionId,
        totalPrompts: previousSize,
        completedCount,
        failedCount,
        duration,
      });

      this.logger.endFeatureFlow(correlationId, {
        success: true,
        completedCount,
        failedCount,
        duration,
      });
    } catch (error) {
      this.logger.error(
        'Auto-drain queue failed',
        { correlationId, sessionId },
        error as Error
      );

      this.logger.endFeatureFlow(correlationId, {
        success: false,
        error: String(error),
      });
    } finally {
      this.executingQueueSessionIds.delete(sessionId);

      this.logger.logStateChange(
        `queue-executing-${sessionId}`,
        true,
        false,
        'auto-drain-end'
      );

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
