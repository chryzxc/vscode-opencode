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
import * as os from "os";

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
 * Console output format modes
 */
export enum ConsoleOutputMode {
  /** Pretty formatted text with colors and symbols */
  PRETTY = "pretty",
  /** Structured JSON format for parsing */
  JSON = "json",
  /** Both pretty and JSON output (dual mode) */
  HYBRID = "hybrid",
}

/**
 * ANSI color codes for terminal output
 */
const ANSI_COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightYellow: "\x1b[93m",
  brightGreen: "\x1b[92m",
  brightBlue: "\x1b[94m",
} as const;

/**
 * Log level symbols for visual scanning
 */
const LOG_SYMBOLS = {
  error: "❌",
  warn: "⚠️",
  info: "ℹ️",
  debug: "🔍",
} as const;

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
  /** Console output format mode */
  consoleOutputMode: ConsoleOutputMode;
  /** Enable colored output for pretty mode */
  enableColors: boolean;
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
    let enableFile = config.get<boolean>("enableFile", false);

    const consoleOutputModeStr = config.get<string>("consoleOutputMode", "pretty");
    const consoleOutputMode = this.parseConsoleOutputMode(consoleOutputModeStr);
    
    const enableColors = config.get<boolean>("enableColors", true);

    let logDir: string;
    if (this.context) {
      logDir = path.join(this.context.globalStorageUri.fsPath, "logs");
    } else {
      // Fallback to home directory logs if context not available yet
      // This avoids trying to create /logs at filesystem root
      logDir = path.join(os.homedir(), ".opencode", "logs");
    }

    // Only create directory if file logging is enabled
    if (enableFile && !fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (error) {
        console.warn(`Failed to create log directory ${logDir}:`, error);
        // Disable file logging if directory creation fails
        enableFile = false;
      }
    }
    const logFilePath = path.join(logDir, "opencode.log");

    return {
      minLevel,
      enableConsole,
      enableFile,
      logFilePath,
      maxFileSize: config.get<number>("maxFileSize", 5 * 1024 * 1024), // 5MB
      maxFiles: config.get<number>("maxFiles", 3),
      consoleOutputMode,
      enableColors,
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
   * Parses console output mode string to ConsoleOutputMode enum.
   */
  private parseConsoleOutputMode(modeStr: string): ConsoleOutputMode {
    switch (modeStr.toLowerCase()) {
      case "json":
        return ConsoleOutputMode.JSON;
      case "hybrid":
        return ConsoleOutputMode.HYBRID;
      case "pretty":
      default:
        return ConsoleOutputMode.PRETTY;
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

    // Console output (with configured format mode)
    if (this.config.enableConsole) {
      this.outputToConsole(entry, formatted);
    }

    // File output (buffered for performance, always JSON)
    if (this.config.enableFile) {
      this.logBuffer.push(formatted + "\n");
    }
  }

  /**
   * Applies color to text if colors are enabled.
   */
  private colorize(text: string, color: keyof typeof ANSI_COLORS): string {
    if (!this.config.enableColors) {
      return text;
    }
    return `${ANSI_COLORS[color]}${text}${ANSI_COLORS.reset}`;
  }

  /**
   * Formats a timestamp for display.
   */
  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    // Use HH:MM:SS format for recent logs, include date for older logs
    if (diffMs < 86400000) { // Less than 24 hours
      return date.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        fractionalSecondDigits: 3
      } as Intl.DateTimeFormatOptions);
    }
    return date.toISOString();
  }

  /**
   * Outputs to console with configurable formatting (pretty/JSON/hybrid).
   */
  private outputToConsole(entry: LogEntry, formattedJson: string): void {
    const timestamp = this.formatTimestamp(entry.timestamp);
    const level = entry.level.toUpperCase();
    const category = entry.category;
    const message = entry.message;
    const context = entry.context;
    const error = entry.error;

    // In JSON or Hybrid mode, output the JSON line
    if (this.config.consoleOutputMode === ConsoleOutputMode.JSON || 
        this.config.consoleOutputMode === ConsoleOutputMode.HYBRID) {
      console.log(formattedJson);
    }

    // In Pretty or Hybrid mode, output the formatted line
    if (this.config.consoleOutputMode === ConsoleOutputMode.PRETTY || 
        this.config.consoleOutputMode === ConsoleOutputMode.HYBRID) {
      
      const symbol = LOG_SYMBOLS[entry.level as keyof typeof LOG_SYMBOLS] || '';
      const levelColor = this.getLevelColor(entry.level);
      
      // Build components with optional colors
      const timestampStr = this.config.enableColors 
        ? this.colorize(`[${timestamp}]`, 'gray')
        : `[${timestamp}]`;
      
      const symbolStr = this.config.enableColors ? symbol : '';
      const levelStr = this.config.enableColors
        ? this.colorize(level, levelColor)
        : level;
      
      const categoryStr = this.config.enableColors
        ? this.colorize(category, 'blue')
        : category;

      const prefix = `${timestampStr} ${symbolStr} [${levelStr}] [${categoryStr}]`;
      
      // Format context if present
      let contextStr = '';
      if (context && Object.keys(context).length > 0) {
        contextStr = this.config.enableColors
          ? ' ' + this.colorize(JSON.stringify(context), 'gray')
          : ' ' + JSON.stringify(context);
      }

      // Format error if present
      let errorStr = '';
      if (error) {
        errorStr = this.config.enableColors
          ? `\n  ${this.colorize('Error:', 'brightRed')} ${error.message}`
          : `\n  Error: ${error.message}`;
        
        if (error.stack) {
          const stackLines = error.stack.split('\n').slice(0, 3);
          errorStr += this.config.enableColors
            ? '\n  ' + this.colorize(stackLines.join('\n  '), 'gray')
            : '\n  ' + stackLines.join('\n  ');
        }
      }

      // Output to appropriate console method
      const fullMessage = `${prefix} ${message}${contextStr}${errorStr}`;
      
      switch (entry.level) {
        case 'error':
          console.error(fullMessage);
          break;
        case 'warn':
          console.warn(fullMessage);
          break;
        case 'debug':
        case 'info':
        default:
          console.log(fullMessage);
          break;
      }
    }
  }

  /**
   * Gets the appropriate color for a log level.
   */
  private getLevelColor(level: string): keyof typeof ANSI_COLORS {
    switch (level) {
      case 'error':
        return 'brightRed';
      case 'warn':
        return 'brightYellow';
      case 'info':
        return 'brightGreen';
      case 'debug':
        return 'brightBlue';
      default:
        return 'blue';
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
    event: "create" | "load" | "switch" | "delete" | "persist" | "rename" | "restore" | "merge",
    sessionId: string,
    context?: Record<string, unknown>,
  ): void {
    this.info(category, `Session ${event}`, {
      ...context,
      sessionId,
    });
  }

  /**
   * Logs a connection/stream lifecycle event with state transition.
   */
  connectionEvent(
    category: string,
    event: "connecting" | "connected" | "disconnected" | "reconnecting" | "subscribed" | "unsubscribed" | "disposed",
    context?: Record<string, unknown>,
  ): void {
    this.info(category, `Connection ${event}`, {
      ...context,
      connectionEvent: event,
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
      consoleOutputMode: this.config.consoleOutputMode,
      enableColors: this.config.enableColors,
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
    sessionEvent: (event: "create" | "load" | "switch" | "delete" | "persist" | "rename" | "restore" | "merge", sessionId: string, context?: Record<string, unknown>) =>
      logger.sessionEvent(category, event, sessionId, context),
    connectionEvent: (event: "connecting" | "connected" | "disconnected" | "reconnecting" | "subscribed" | "unsubscribed" | "disposed", context?: Record<string, unknown>) =>
      logger.connectionEvent(category, event, context),

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
