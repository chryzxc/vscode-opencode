/**
 * Simple logger for webview React components
 * Sends logs to extension for centralized logging
 */

import { config } from "../../config";
import vscode from "./vscode";

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class WebviewLogger {
  private logLevel: LogLevel = 'info';
  private sessionId: string | null = null;
  private showLoggerOverride: boolean | null = null;
  private showBrowserConsoleOverride: boolean | null = null;

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  setShowLogger(enabled: boolean): void {
    this.showLoggerOverride = enabled;
  }

  setShowBrowserConsole(enabled: boolean): void {
    this.showBrowserConsoleOverride = enabled;
  }

  private shouldLog(level: LogLevel): boolean {
    const enabled = this.showLoggerOverride ?? config.debug.showLogger;
    if (!enabled) {
      return false;
    }

    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Log to browser console with consistent prefix
    const showConsole = this.showBrowserConsoleOverride ?? config.debug.showBrowserConsole;
    if (showConsole) {
      const prefix = `[WebView][${level.toUpperCase()}]`;
      switch (level) {
        case 'debug':
          console.debug(prefix, message, context);
          break;
        case 'info':
          console.info(prefix, message, context);
          break;
        case 'warn':
          console.warn(prefix, message, context);
          break;
        case 'error':
          console.error(prefix, message, context);
          break;
      }
    }

    // Send to extension for centralized logging
    try {
      vscode.postMessage({
        type: 'webviewLog',
        level,
        message,
        context: {
          ...context,
          sessionId: this.sessionId,
          timestamp: Date.now(),
          source: 'webview',
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

export function getGlobalShowBrowserConsole(): boolean {
  return config.debug.showBrowserConsole;
}

// Singleton instance
const logger = new WebviewLogger();

export default logger;
