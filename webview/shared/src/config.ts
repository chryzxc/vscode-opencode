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
     * Show browser console output (console.log, console.warn, etc.)
     * When disabled, all console/terminal/browser logging output is suppressed
     * @default true
     */
    showBrowserConsole: true,
    /**
     * Show pre-render debug panel showing data fed into the AI response card
     * (helps debug reasoning leaks into response content)
     * @default false
     */
    showPreRenderDebug: false,
    /**
     * Show raw SDK event payload debug panel before the AI response block
     * (captures raw stream events during streaming, or rawResponse for completed messages)
     * @default false
     */
    showSdkDebug: false,
    /**
     * Show interactive events debug panel inside the AI response block
     * (displays raw interactiveEvents data used for question popovers, confirmations, etc.)
     * @default false
     */
    showInteractiveEventsDebug: false,
    showCentralizedDebug: true,
  },
};

/**
 * Type-safe config accessor
 */
export type Config = typeof config;
