/**
 * Simple logger for webview React components
 * Sends logs to extension for centralized logging
 */

import { config } from "../../config";
import vscode from "./vscode";

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class WebviewLogger {
  private logLevel: LogLevel = 'warn';
  private sessionId: string | null = null;
  private showLogger: boolean = false;
  private showBrowserConsoleOverride: boolean | null = null;
  private readonly lastPerformanceLogAt = new Map<string, number>();

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  setShowLogger(enabled: boolean): void {
    this.showLogger = enabled;
  }

  setShowBrowserConsole(enabled: boolean): void {
    this.showBrowserConsoleOverride = enabled;
  }

  streamPerformance(metric: string, context: Record<string, unknown> = {}): void {
    const durationMs = context.durationMs;
    // Do not emit routine stream/scroll telemetry. A blocked frame is still
    // reported for diagnosis, but successful batches create no IPC or logs.
    if (typeof durationMs !== "number" || durationMs < 16) {
      return;
    }
    const now = performance.now();
    const previous = this.lastPerformanceLogAt.get(metric) ?? -Infinity;
    // Instrumentation must not become a stream-event bottleneck itself.
    // Crossing webview IPC to report a metric has its own serialization and
    // host logging cost. One summary per two seconds is enough to diagnose a
    // sustained stall without turning instrumentation into stream traffic.
    if (now - previous < 2_000) {
      return;
    }
    this.lastPerformanceLogAt.set(metric, now);
    const payload = {
      ...context,
      metric,
      timestamp: Date.now(),
      source: "webview",
      sessionId: this.sessionId,
    };
    if (this.showBrowserConsoleOverride ?? config.debug.showBrowserConsole) {
      console.debug("[WebView][STREAM-PERF]", payload);
    }
    try {
      vscode.postMessage({
        type: "webviewLog",
        level: "info",
        message: `[STREAM-PERF] ${metric}`,
        context: payload,
      });
    } catch {
      // Best-effort diagnostics only.
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.showLogger) {
      return false;
    }

    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  wouldLog(level: LogLevel): boolean {
    return this.shouldLog(level);
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

// Singleton instance
const logger = new WebviewLogger();

export default logger;
