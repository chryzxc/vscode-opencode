/**
 * OpenCode Logger Utility
 *
 * Provides structured, leveled logging for the OpenCode VS Code extension.
 * Supports multiple log levels, context metadata, and multiple output destinations.
 *
 * **Features:**
 * - Log levels: error, warn, info, debug
 * - Structured JSON logging for easy parsing
 * - Context-aware logging with metadata
 * - Console and file output support
 * - File rotation to prevent disk bloat
 * - Configurable via VSCode settings
 *
 * **Log Format:**
 * ```json
 * {
 *   "timestamp": "2026-02-26T14:50:00.000Z",
 *   "level": "info",
 *   "category": "ServerManager",
 *   "message": "Server starting",
 *   "context": { "port": 4097 }
 * }
 * ```
 *
 * @module Logger
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Log level severity enumeration.
 * Higher levels include all lower levels.
 */
export enum LogLevel {
  /** Errors that prevent functionality */
  ERROR = 0,
  /** Warning messages for potential issues */
  WARN = 1,
  /** Informational messages about normal operation */
  INFO = 2,
  /** Detailed debugging information */
  DEBUG = 3,
}

/**
 * Log entry structure for structured logging.
 */
interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: string;
  /** Category/source of the log */
  category: string;
  /** Main log message */
  message: string;
  /** Optional context/metadata */
  context?: Record<string, unknown>;
  /** Optional error object */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger configuration options.
 */
interface LoggerConfig {
  /** Minimum log level to output */
  minLevel: LogLevel;
  /** Enable console output */
  enableConsole: boolean;
  /** Enable file output */
  enableFile: boolean;
  /** Log file path */
  logFilePath: string;
  /** Maximum log file size in bytes (default: 5MB) */
  maxFileSize: number;
  /** Maximum number of backup files to keep (default: 3) */
  maxFiles: number;
}

/**
 * Singleton logger instance for the extension.
 */
class Logger {
  private config: LoggerConfig;
  private logBuffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private context: vscode.ExtensionContext | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.startFlushTimer();
  }

  setExtensionContext(context: vscode.ExtensionContext): void {
    this.context = context;
    this.reloadConfig();
  }

  /**
   * Loads logger configuration from VSCode settings.
   */
  private loadConfig(): LoggerConfig {
    const config = vscode.workspace.getConfiguration("opencode.logging");

    const levelStr = config.get<string>("level", "info");
    const minLevel = this.parseLogLevel(levelStr);

    const enableConsole = config.get<boolean>("enableConsole", true);
    const enableFile = config.get<boolean>("enableFile", false);

    let logDir: string;
    if (this.context) {
      logDir = path.join(this.context.globalStorageUri.fsPath, "logs");
    } else {
      logDir = path.join(process.cwd(), "logs");
    }

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFilePath = path.join(logDir, "opencode.log");

    return {
      minLevel,
      enableConsole,
      enableFile,
      logFilePath,
      maxFileSize: config.get<number>("maxFileSize", 5 * 1024 * 1024), // 5MB
      maxFiles: config.get<number>("maxFiles", 3),
    };
  }

  /**
   * Parses log level string to LogLevel enum.
   */
  private parseLogLevel(levelStr: string): LogLevel {
    switch (levelStr.toLowerCase()) {
      case "error":
        return LogLevel.ERROR;
      case "warn":
      case "warning":
        return LogLevel.WARN;
      case "debug":
        return LogLevel.DEBUG;
      case "info":
      default:
        return LogLevel.INFO;
    }
  }

  /**
   * Formats a log entry as JSON string.
   */
  private formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  /**
   * Outputs a log entry to configured destinations.
   */
  private output(entry: LogEntry): void {
    // Check if we should log this level
    const level = this.parseLogLevel(entry.level);
    if (level > this.config.minLevel) {
      return;
    }

    const formatted = this.formatEntry(entry);

    // Console output (with pretty formatting for readability)
    if (this.config.enableConsole) {
      this.outputToConsole(entry);
    }

    // File output (buffered for performance)
    if (this.config.enableFile) {
      this.logBuffer.push(formatted + "\n");
    }
  }

  /**
   * Outputs to console with pretty formatting.
   */
  private outputToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.category}]`;
    const message = entry.message;
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    const errorStr = entry.error ? `\n  Error: ${entry.error.message}` : "";

    switch (entry.level) {
      case "error":
        console.error(`${prefix}${message}${contextStr}${errorStr}`);
        break;
      case "warn":
        console.warn(`${prefix}${message}${contextStr}`);
        break;
      case "debug":
        console.log(`${prefix}${message}${contextStr}`);
        break;
      case "info":
      default:
        console.log(`${prefix}${message}${contextStr}`);
        break;
    }
  }

  /**
   * Starts periodic flush timer for buffered logs.
   */
  private startFlushTimer(): void {
    // Flush every 5 seconds or when buffer reaches 100 entries
    this.flushTimer = setInterval(() => {
      if (this.logBuffer.length > 0) {
        this.flush();
      }
    }, 5000);
  }

  /**
   * Flushes buffered logs to file.
   */
  private async flush(): Promise<void> {
    if (this.isFlushing || this.logBuffer.length === 0) {
      return;
    }

    this.isFlushing = true;

    try {
      // Check file size and rotate if needed
      await this.rotateIfNeeded();

      // Write buffered logs
      const logsToWrite = this.logBuffer.join("");
      this.logBuffer = [];

      await fs.promises.appendFile(this.config.logFilePath, logsToWrite);
    } catch (error) {
      // If file logging fails, just log to console and clear buffer
      console.error("Failed to write logs to file:", error);
      this.logBuffer = [];
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Rotates log file if it exceeds max size.
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await fs.promises.stat(this.config.logFilePath);

      if (stats.size >= this.config.maxFileSize) {
        // Rotate existing logs
        for (let i = this.config.maxFiles - 1; i >= 1; i--) {
          const oldPath = `${this.config.logFilePath}.${i}`;
          const newPath = `${this.config.logFilePath}.${i + 1}`;

          if (fs.existsSync(oldPath)) {
            if (i === this.config.maxFiles - 1) {
              // Delete oldest backup
              await fs.promises.unlink(oldPath);
            } else {
              // Shift backup
              await fs.promises.rename(oldPath, newPath);
            }
          }
        }

        // Move current log to .1
        await fs.promises.rename(
          this.config.logFilePath,
          `${this.config.logFilePath}.1`,
        );
      }
    } catch (error) {
      // File doesn't exist yet or other error - ignore
      if (
        error instanceof Error &&
        !error.message.includes("ENOENT")
      ) {
        console.error("Log rotation error:", error);
      }
    }
  }

  /**
   * Logs a message at the specified level.
   */
  private log(
    level: string,
    category: string,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      context,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    this.output(entry);
  }

  /**
   * Logs an error message.
   */
  error(
    category: string,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    this.log("error", category, message, context, error);
  }

  /**
   * Logs a warning message.
   */
  warn(
    category: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.log("warn", category, message, context);
  }

  /**
   * Logs an informational message.
   */
  info(
    category: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.log("info", category, message, context);
  }

  /**
   * Logs a debug message.
   */
  debug(
    category: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.log("debug", category, message, context);
  }

  /**
   * Logs an AI request (user prompt sent to AI).
   */
  aiRequest(
    category: string,
    sessionId: string,
    modelId: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.info(
      category,
      "AI Request Sent",
      {
        ...context,
        sessionId,
        modelId,
        messageLength: message.length,
        hasImages: context?.images ? true : false,
        hasFiles: context?.files ? true : false,
      },
    );
  }

  /**
   * Logs an AI response received.
   */
  aiResponse(
    category: string,
    sessionId: string,
    responseTime: number,
    responseLength: number,
    context?: Record<string, unknown>,
  ): void {
    this.info(
      category,
      "AI Response Received",
      {
        ...context,
        sessionId,
        responseTimeSeconds: responseTime.toFixed(2),
        responseLength,
      },
    );
  }

  /**
   * Logs an AI streaming event.
   */
  aiStreamEvent(
    category: string,
    sessionId: string,
    eventType: string,
    context?: Record<string, unknown>,
  ): void {
    this.debug(category, "AI Stream Event", {
      ...context,
      sessionId,
      eventType,
    });
  }

  /**
   * Logs token usage.
   */
  tokenUsage(
    category: string,
    providerId: string,
    inputTokens: number,
    outputTokens: number,
    context?: Record<string, unknown>,
  ): void {
    this.info(category, "Token Usage", {
      ...context,
      providerId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
  }

  /**
   * Logs a server lifecycle event.
   */
  serverEvent(
    category: string,
    event: "start" | "stop" | "restart" | "error" | "connect" | "disconnect",
    context?: Record<string, unknown>,
  ): void {
    this.info(category, `Server ${event}`, context);
  }

  /**
   * Logs a session lifecycle event.
   */
  sessionEvent(
    category: string,
    event: "create" | "load" | "switch" | "delete" | "persist" | "rename",
    sessionId: string,
    context?: Record<string, unknown>,
  ): void {
    this.info(category, `Session ${event}`, {
      ...context,
      sessionId,
    });
  }

  /**
   * Reloads configuration (call when settings change).
   */
  reloadConfig(): void {
    this.config = this.loadConfig();
    this.info("Logger", "Configuration reloaded", {
      minLevel: LogLevel[this.config.minLevel],
      enableConsole: this.config.enableConsole,
      enableFile: this.config.enableFile,
    });
  }

  /**
   * Disposes of logger resources.
   */
  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining logs
    await this.flush();
  }
}

// Export singleton instance
export const logger = new Logger();

/**
 * Active feature flow tracking
 */
interface ActiveFeatureFlow {
  featureName: string;
  correlationId: string;
  startTime: number;
  metadata: Record<string, unknown>;
}

/**
 * Completed feature flow with duration and result
 */
interface CompletedFeatureFlow extends ActiveFeatureFlow {
  duration: number;
  result?: Record<string, unknown>;
}

/**
 * Creates a category-scoped logger for convenience.
 * Usage:
 * ```typescript
 * const log = createLogger("ChatViewProvider");
 * log.info("Message sent");
 * log.error("Failed to send", { messageId }, error);
 * ```
 */
export function createLogger(category: string) {
  const activeFlows = new Map<string, ActiveFeatureFlow>();

  const generateCorrelationId = (): string => {
    return `${category}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  };

  return {
    // Existing methods
    error: (message: string, context?: Record<string, unknown>, error?: Error) =>
      logger.error(category, message, context, error),
    warn: (message: string, context?: Record<string, unknown>) =>
      logger.warn(category, message, context),
    info: (message: string, context?: Record<string, unknown>) =>
      logger.info(category, message, context),
    debug: (message: string, context?: Record<string, unknown>) =>
      logger.debug(category, message, context),
    aiRequest: (sessionId: string, modelId: string, message: string, context?: Record<string, unknown>) =>
      logger.aiRequest(category, sessionId, modelId, message, context),
    aiResponse: (sessionId: string, responseTime: number, responseLength: number, context?: Record<string, unknown>) =>
      logger.aiResponse(category, sessionId, responseTime, responseLength, context),
    aiStreamEvent: (sessionId: string, eventType: string, context?: Record<string, unknown>) =>
      logger.aiStreamEvent(category, sessionId, eventType, context),
    tokenUsage: (providerId: string, inputTokens: number, outputTokens: number, context?: Record<string, unknown>) =>
      logger.tokenUsage(category, providerId, inputTokens, outputTokens, context),
    serverEvent: (event: "start" | "stop" | "restart" | "error" | "connect" | "disconnect", context?: Record<string, unknown>) =>
      logger.serverEvent(category, event, context),
    sessionEvent: (event: "create" | "load" | "switch" | "delete" | "persist" | "rename", sessionId: string, context?: Record<string, unknown>) =>
      logger.sessionEvent(category, event, sessionId, context),

    // New feature flow methods
    startFeatureFlow: (featureName: string, metadata?: Record<string, unknown>): string => {
      const correlationId = generateCorrelationId();
      const flow: ActiveFeatureFlow = {
        featureName,
        correlationId,
        startTime: Date.now(),
        metadata: metadata || {},
      };
      activeFlows.set(correlationId, flow);

      logger.info(category, `Feature started: ${featureName}`, {
        correlationId,
        featureName,
        ...metadata,
      });

      return correlationId;
    },

    endFeatureFlow: (correlationId: string, result?: Record<string, unknown>): CompletedFeatureFlow | undefined => {
      const flow = activeFlows.get(correlationId);
      if (!flow) {
        logger.warn(category, `Feature flow not found: ${correlationId}`, { correlationId });
        return undefined;
      }

      const duration = Date.now() - flow.startTime;
      activeFlows.delete(correlationId);

      logger.info(category, `Feature ended: ${flow.featureName}`, {
        correlationId,
        featureName: flow.featureName,
        duration,
        result,
        ...flow.metadata,
      });

      return { ...flow, duration, ...result };
    },

    getActiveFeatureFlow: (correlationId?: string): ActiveFeatureFlow | undefined => {
      if (correlationId) {
        return activeFlows.get(correlationId);
      }
      // Return most recent flow if no ID provided
      const entries = Array.from(activeFlows.entries());
      if (entries.length === 0) return undefined;
      return entries[entries.length - 1][1];
    },

    featureStep: (correlationId: string, stepName: string, context?: Record<string, unknown>): void => {
      const flow = activeFlows.get(correlationId);
      if (!flow) {
        logger.warn(category, `Feature flow not found for step: ${correlationId}`, {
          correlationId,
          stepName,
        });
        return;
      }

      logger.info(category, `Feature step: ${stepName}`, {
        correlationId,
        featureName: flow.featureName,
        stepName,
        ...context,
      });
    },

    logStateChange: <T>(stateKey: string, oldValue: T, newValue: T, changedBy: string): void => {
      logger.info(category, `State changed: ${stateKey}`, {
        stateKey,
        oldValue,
        newValue,
        changedBy,
        timestamp: new Date().toISOString(),
      });
    },

    logUIInteraction: (component: string, action: string, element?: string, payload?: Record<string, unknown>): void => {
      logger.debug(category, `UI interaction: ${action}`, {
        component,
        action,
        element,
        payload,
        userInitiated: true,
        timestamp: new Date().toISOString(),
      });
    },

    performance: (operation: string, duration: number, metadata?: Record<string, unknown>): void => {
      const performanceContext = {
        operation,
        duration,
        ...metadata,
      };

      logger.info(category, `Performance: ${operation}`, performanceContext);

      // Log warning if operation took too long (> 3 seconds)
      if (duration > 3000) {
        logger.warn(category, `Slow operation detected: ${operation}`, performanceContext);
      }
    },
  };
}
