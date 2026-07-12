/**
 * Centralized configuration for the webview application
 */

export const config = {
  /**
   * Debug configuration
   */
  debug: {
    /**
     * Show browser console output (console.log, console.warn, etc.)
     * When disabled, all console/terminal/browser logging output is suppressed
     * @default true
     */
    showBrowserConsole: false,
    // This panel serializes the full raw/live event tapes. Keep it opt-in so
    // its diagnostic rendering never competes with the streaming UI.
    showCentralizedDebug: false,
  },
};

/**
 * Type-safe config accessor
 */
export type Config = typeof config;
