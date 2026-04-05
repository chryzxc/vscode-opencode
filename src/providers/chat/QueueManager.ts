/**
 * QueueManager Module
 *
 * Prompt queue CRUD, execution lifecycle, and dispatch scheduling.
 *
 * Extracted from ChatViewProvider.ts (~300 lines)
 */

import { LoggingCategories } from "../../utils/LoggingSchema";
import type { QueuedPrompt } from "./types";

export class QueueManager {
  private queue: QueuedPrompt[] = [];
  private isExecuting = false;

  constructor(
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
  ) {
    this.handleSendMessage = async () => {};
    this.handleStopRequest = () => {};
    this.getCurrentSessionId = () => undefined;
    this.postMessage = () => {};
  }

  private handleSendMessage: (
    text: string,
    files?: string[],
    contexts?: any[],
    images?: any[],
    agent?: string,
    isRetry?: boolean,
    recoveredContext?: any,
    retryWithoutStructuredOutput?: boolean,
    structuredFallbackReason?: string,
    userFacingText?: string,
  ) => Promise<void>;
  private handleStopRequest: () => void;
  private getCurrentSessionId: () => string | undefined;
  private postMessage: (msg: any) => void;

  setHandleSendMessage(
    fn: (
      text: string,
      files?: string[],
      contexts?: any[],
      images?: any[],
      agent?: string,
      isRetry?: boolean,
      recoveredContext?: any,
      retryWithoutStructuredOutput?: boolean,
      structuredFallbackReason?: string,
      userFacingText?: string,
    ) => Promise<void>,
  ): void {
    this.handleSendMessage = fn;
  }

  setHandleStopRequest(fn: () => void): void {
    this.handleStopRequest = fn;
  }

  setGetCurrentSessionId(fn: () => string | undefined): void {
    this.getCurrentSessionId = fn;
  }

  setPostMessage(fn: (msg: any) => void): void {
    this.postMessage = fn;
  }

  /**
   * Add prompt to queue with logging
   */
  addToQueue(prompt: QueuedPrompt): void {
    const correlationId = this.logger.startFeatureFlow('add-to-queue', {
      promptId: prompt.id,
      sessionId: prompt.sessionId,
    });

    this.queue.push(prompt);

    this.logger.logStateChange(
      'queue-size',
      this.queue.length - 1,
      this.queue.length,
      'add-to-queue'
    );

    this.logger.info( 'Prompt added to queue', {
      correlationId,
      promptId: prompt.id,
      queuePosition: this.queue.length,
      text: prompt.text.slice(0, 100),
    });

    this.logger.endFeatureFlow(correlationId, {
      success: true,
      queueSize: this.queue.length,
    });
  }

  /**
   * Add prompt to queue and optionally prioritize it to the front.
   */
  enqueuePrompt(prompt: QueuedPrompt, atFront = false): void {
    if (atFront) {
      const correlationId = this.logger.startFeatureFlow('add-to-queue-front', {
        promptId: prompt.id,
        sessionId: prompt.sessionId,
      });

      this.queue.unshift(prompt);
      this.logger.logStateChange(
        'queue-size',
        this.queue.length - 1,
        this.queue.length,
        'add-to-queue-front'
      );
      this.logger.info( 'Prompt prioritized in queue', {
        correlationId,
        promptId: prompt.id,
        queuePosition: 1,
        text: prompt.text.slice(0, 100),
      });
      this.logger.endFeatureFlow(correlationId, {
        success: true,
        queueSize: this.queue.length,
      });
      return;
    }

    this.addToQueue(prompt);
  }

  /**
   * Execute queue with logging
   */
  async executeQueue(
    executePrompt: (prompt: QueuedPrompt) => Promise<void>
  ): Promise<void> {
    if (this.queue.length === 0) {
      this.logger.debug( 'Execute queue called with empty queue', {
        queueSize: 0,
      });
      return;
    }

    if (this.isExecuting) {
      this.logger.warn( 'Queue already executing', {
        queueSize: this.queue.length,
      });
      return;
    }

    const correlationId = this.logger.startFeatureFlow('execute-queue', {
      queueSize: this.queue.length,
    });
    const startTime = Date.now();

    this.logger.logStateChange('queue-executing', false, true, 'execute-queue-start');
    this.isExecuting = true;

    try {
      this.logger.info( 'Starting queue execution', {
        correlationId,
        promptCount: this.queue.length,
      });

      let completedCount = 0;
      let failedCount = 0;

      for (const prompt of this.queue) {
        this.logger.featureStep(correlationId, 'execute-prompt', {
          promptId: prompt.id,
          position: completedCount + 1,
          total: this.queue.length,
        });

        try {
          await executePrompt(prompt);
          completedCount++;

          this.logger.info( 'Prompt executed successfully', {
            correlationId,
            promptId: prompt.id,
            position: completedCount,
          });
        } catch (error) {
          failedCount++;

          this.logger.error(
            LoggingCategories.QUEUE_MANAGER,
            'Prompt execution failed',
            {
              correlationId,
              promptId: prompt.id,
              position: completedCount + 1,
              text: prompt.text.slice(0, 100),
            },
            error as Error
          );
        }
      }

      const duration = Date.now() - startTime;

      this.logger.performance('execute-queue', duration, {
        totalPrompts: this.queue.length,
        completedPrompts: completedCount,
        failedPrompts: failedCount,
      });

      this.logger.info( 'Queue execution completed', {
        correlationId,
        totalPrompts: this.queue.length,
        completedCount,
        failedCount,
        duration,
      });

      this.queue = [];

      this.logger.endFeatureFlow(correlationId, {
        success: true,
        completedCount,
        failedCount,
        duration,
      });
    } catch (error) {
      this.logger.error(
        LoggingCategories.QUEUE_MANAGER,
        'Queue execution failed',
        { correlationId },
        error as Error
      );

      this.logger.endFeatureFlow(correlationId, {
        success: false,
        error: String(error),
      });
      throw error;
    } finally {
      this.isExecuting = false;
      this.logger.logStateChange('queue-executing', true, false, 'execute-queue-end');
    }
  }

  /**
   * Clear queue with logging
   */
  clearQueue(): void {
    const correlationId = this.logger.startFeatureFlow('clear-queue', {
      currentSize: this.queue.length,
    });

    const previousSize = this.queue.length;

    this.logger.logStateChange('queue-size', previousSize, 0, 'clear-queue');
    this.logger.logStateChange('queue', this.queue, [], 'clear-queue');

    this.queue = [];

    this.logger.info( 'Queue cleared', {
      correlationId,
      previousSize,
      cleared: true,
    });

    this.logger.endFeatureFlow(correlationId, {
      success: true,
      itemsCleared: previousSize,
    });
  }

  /**
   * Get queue state
   */
  getQueueState(): { size: number; isExecuting: boolean; prompts: Array<{ id: string; text: string }> } {
    return {
      size: this.queue.length,
      isExecuting: this.isExecuting,
      prompts: this.queue.map(p => ({ id: p.id, text: p.text.slice(0, 50) })),
    };
  }

  /**
   * Handle dispatch queued item
   */
  async handleDispatchQueuedItem(
    mode: string,
    sessionId: string | undefined,
    id?: string,
    index?: number,
  ): Promise<void> {
    const flow = this.logger.startFeatureFlow('DispatchQueuedItem', { mode, sessionId, id, index });
    const currentSessionId = this.getCurrentSessionId();
    const finalSessionId = sessionId || currentSessionId;

    if (!finalSessionId) {
      this.logger.warn( 'No session ID for queued item', { id, index });
      this.logger.endFeatureFlow(flow, { status: 'failed', reason: 'No session ID' });
      return;
    }

    this.logger.featureStep(flow, 'dispatching_item', { id, index });

    if (id) {
      // Add specific queued item by ID
      const prompt = this.queue.find(p => p.id === id);
      if (prompt) {
        prompt.sessionId = finalSessionId;
        this.logger.featureStep(flow, 'sending_message_by_id', { id });
        await this.handleSendMessage(
          prompt.text,
          prompt.files,
          prompt.contexts,
          prompt.images,
          prompt.agent,
          false,
          undefined,
          false,
          undefined,
          prompt.userFacingText,
        );
        this.logger.endFeatureFlow(flow, { status: 'completed', id });
      } else {
        this.logger.warn( 'Queued item not found', { id });
        this.logger.endFeatureFlow(flow, { status: 'failed', reason: 'Item not found', id });
      }
    } else if (index !== undefined && index >= 0 && index < this.queue.length) {
      // Add by index
      const prompt = this.queue[index];
      prompt.sessionId = finalSessionId;
      this.logger.featureStep(flow, 'sending_message_by_index', { index });
      await this.handleSendMessage(
        prompt.text,
        prompt.files,
        prompt.contexts,
        prompt.images,
        prompt.agent,
        false,
        undefined,
        false,
        undefined,
        prompt.userFacingText,
      );
      this.logger.endFeatureFlow(flow, { status: 'completed', index });
    } else {
      this.logger.endFeatureFlow(flow, { status: 'failed', reason: 'Invalid index or ID', index, id });
    }
  }

  /**
   * Handle remove from queue
   */
  async handleRemoveFromQueue(payload: { id: string }): Promise<void> {
    const { id } = payload;
    const index = this.queue.findIndex(p => p.id === id);

    if (index !== -1) {
      const correlationId = this.logger.startFeatureFlow('remove-from-queue', {
        promptId: id,
        queuePosition: index + 1,
      });

      this.queue.splice(index, 1);

      this.logger.logStateChange(
        'queue-size',
        this.queue.length + 1,
        this.queue.length,
        'remove-from-queue'
      );

      this.logger.info( 'Prompt removed from queue', {
        correlationId,
        promptId: id,
        queueSize: this.queue.length,
      });

      this.logger.endFeatureFlow(correlationId, {
        success: true,
        queueSize: this.queue.length,
      });
    }
  }

  /**
   * Handle clear queue
   */
  async handleClearQueue(payload: { sessionId: string }): Promise<void> {
    const flow = this.logger.startFeatureFlow('ClearQueue', { sessionId: payload.sessionId });
    const previousSize = this.queue.length;

    this.clearQueue();
    this.sendQueueUpdate(payload.sessionId);

    this.logger.info( 'Queue cleared', {
      sessionId: payload.sessionId,
      previousSize,
      newSize: 0,
    });
    this.logger.endFeatureFlow(flow, { status: 'completed', previousSize });
  }

  /**
   * Send queue update to webview
   */
  sendQueueUpdate(sessionId: string): void {
    this.postMessage({
      type: 'queueUpdate',
      sessionId,
      queue: this.getQueueState(),
    });
  }

  /**
   * Handle execute queue
   */
  async handleExecuteQueue(payload: { sessionId: string }): Promise<void> {
    const flow = this.logger.startFeatureFlow('ExecuteQueue', { sessionId: payload.sessionId });
    const { sessionId } = payload;

    if (this.queue.length === 0) {
      this.logger.debug( 'Execute queue called with empty queue', {
        queueSize: 0,
      });
      this.logger.endFeatureFlow(flow, 'skipped', { reason: 'Empty queue' });
      return;
    }

    const queueSize = this.queue.length;
    this.logger.featureStep(flow, 'executing_queue', { queueSize, sessionId });

    // Update session IDs for all prompts
    for (const prompt of this.queue) {
      prompt.sessionId = sessionId;
    }

    // Execute queue
    await this.executeQueue(async (prompt) => {
      await this.handleSendMessage(
        prompt.text,
        prompt.files,
        prompt.contexts,
        prompt.images,
        prompt.agent,
        false,
        undefined,
        false,
        undefined,
        prompt.userFacingText,
      );
    });

    this.logger.info( 'Queue execution completed', {
      sessionId,
      itemsExecuted: queueSize,
    });
    this.logger.endFeatureFlow(flow, { status: 'completed', itemsExecuted: queueSize });

    // Send update after execution
    this.sendQueueUpdate(sessionId);
  }
}
