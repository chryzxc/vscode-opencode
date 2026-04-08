import type { DisplayError } from './types';

/**
 * Logger interface for ErrorBuilder
 */
export interface Logger {
  error: (message: string, context?: Record<string, unknown>, error?: Error) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  debug: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * ErrorBuilder extracts and normalizes errors from message objects
 *
 * This utility provides a unified way to extract error information from
 * various message formats and convert them into DisplayError objects for
 * consistent error display in the UI.
 */
export class ErrorBuilder {
  private logger: Logger;
  private isLikelyInteractiveAwaitTimeoutError: (message: string) => boolean;

  constructor(
    logger: Logger,
    isLikelyInteractiveAwaitTimeoutError: (message: string) => boolean
  ) {
    this.logger = logger;
    this.isLikelyInteractiveAwaitTimeoutError = isLikelyInteractiveAwaitTimeoutError;
  }

  /**
   * Extract and normalize error from message object
   */
  extractError(message: any): DisplayError | null {
    if (!message || typeof message !== 'object') {
      return null;
    }

    // Try API error first (highest priority)
    const apiError = this.extractApiError(message);
    if (apiError) {
      return apiError;
    }

    // Try timeout error
    const timeoutError = this.extractTimeoutError(message);
    if (timeoutError) {
      return timeoutError;
    }

    // Try structured output error
    const structuredOutputError = this.extractStructuredOutputError(message);
    if (structuredOutputError) {
      return structuredOutputError;
    }

    return null;
  }

  /**
   * Extract API error from message.info.error.data.message
   */
  private extractApiError(message: any): DisplayError | null {
    const apiErrorMessage = message?.info?.error?.data?.message;

    if (typeof apiErrorMessage === 'string' && apiErrorMessage.trim().length > 0) {
      return {
        type: 'api_error',
        message: apiErrorMessage.trim(),
        originalError: apiErrorMessage,
        canRetry: true,
        metadata: {
          errorName: message?.info?.error?.name,
          statusCode: message?.info?.error?.data?.statusCode,
        },
      };
    }

    return null;
  }

  /**
   * Extract timeout error using existing timeout detection logic
   */
  private extractTimeoutError(message: any): DisplayError | null {
    // Check message.error and message.info.error for timeout indicators
    const errorMessage = message?.error || message?.info?.error?.data?.message || '';

    if (typeof errorMessage === 'string' &&
        this.isLikelyInteractiveAwaitTimeoutError(errorMessage)) {
      return {
        type: 'timeout',
        message: 'Request timed out. Please retry.',
        originalError: errorMessage,
        canRetry: true,
      };
    }

    return null;
  }

  /**
   * Extract structured output error
   */
  private extractStructuredOutputError(message: any): DisplayError | null {
    // This is handled by existing logic in ChatViewProvider
    // We return null here to let the existing incompatible model checks handle it
    return null;
  }
}
