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
     * @default true
     */
    showRawResponse: false,
    /**
     * Disable webview logger output and extension forwarding
     * @default false
     */
    disableLogs: true,
    /**
     * Show pre-render debug panel showing data fed into the AI response card
     * (helps debug reasoning leaks into response content)
     * @default false
     */
    showPreRenderDebug: false,
  },
} as const;

/**
 * Type-safe config accessor
 */
export type Config = typeof config;
