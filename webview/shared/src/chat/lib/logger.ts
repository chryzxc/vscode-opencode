/**
 * Simple logger for webview React components
 * Sends logs to extension for centralized logging
 */

import { config } from "../../config";
import vscode from "./vscode";

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class WebviewLogger {
  private logLevel: LogLevel = 'info';

  private shouldLog(level: LogLevel): boolean {
    if (config.debug.disableLogs) {
      return false;
    }

    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Log to browser console
    switch (level) {
      case 'debug':
        console.debug(`[WebView] ${message}`, context);
        break;
      case 'info':
        console.info(`[WebView] ${message}`, context);
        break;
      case 'warn':
        console.warn(`[WebView] ${message}`, context);
        break;
      case 'error':
        console.error(`[WebView] ${message}`, context);
        break;
    }

    // Send to extension for centralized logging
    try {
      vscode.postMessage({
        type: 'webviewLog',
        level,
        message,
        context: {
          ...context,
          timestamp: Date.now(),
          source: 'webview-react',
        },
      });
    } catch (error) {
      // Silently fail - extension might not be ready
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }
}

// Singleton instance
const logger = new WebviewLogger();

export default logger;
