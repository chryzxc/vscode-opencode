/**
 * Centralized configuration for the webview application
 */

export const config = {
  /**
   * Debug configuration
   */
  debug: {
    /**
     * Show raw response debug information in chat messages
     * @default false
     */
    showRawResponse: true,
  },
} as const;

/**
 * Type-safe config accessor
 */
export type Config = typeof config;
