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
    /** Show copyable raw SDK hydration and live-event payloads. */
    showSdkEventDebug: false,
  },
};

/**
 * Type-safe config accessor
 */
export type Config = typeof config;
